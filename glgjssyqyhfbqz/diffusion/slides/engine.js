/* ==========================================================================
   Diffusion deck — slide engine
   - One deck, two cuts: data-tier="core" (45-min + 90-min) / "full" (90-min only)
   - Toggle with  V  or the chip in the top-right, or open with ?v=45 / ?v=90
   - O overview · P presenter window · N notes · F fullscreen · B black · T light/dark theme · ? help
   ========================================================================== */
(function () {
  'use strict';
  const W = 1920, H = 1080;
  const qs = new URLSearchParams(location.search);
  const EMBED = qs.has('embed');
  const PRESENTER = qs.has('presenter');
  const CH_NAMES = {
    0: 'Primer', 1: 'Origins', 2: 'Beating GANs', 3: 'Text-to-image', 4: 'Control',
    5: 'Architectures & objectives', 6: '1000 steps → 1', 7: 'Video I', 8: 'Video II · world models',
    9: 'LLM fusion · RL', 10: 'Trends'
  };
  const CH_COLORS = {
    0: '#7dd3fc', 1: '#a78bfa', 2: '#f472b6', 3: '#fb923c', 4: '#facc15', 5: '#4ade80',
    6: '#22d3ee', 7: '#60a5fa', 8: '#818cf8', 9: '#f87171', 10: '#e2e8f0'
  };
  const CH_COLORS_LIGHT = {   // same hues as the [data-chapter] light table in engine.css
    0: '#0284c7', 1: '#7c3aed', 2: '#db2777', 3: '#ea580c', 4: '#a16207', 5: '#16a34a',
    6: '#0891b2', 7: '#2563eb', 8: '#4f46e5', 9: '#dc2626', 10: '#334155'
  };
  // theme: ?theme=light|dark, else the last choice, else light (most paper figures are white)
  let theme = /^(light|dark)$/.test(qs.get('theme')) ? qs.get('theme') : localStorage.getItem('diffdeck-theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;

  let mode = qs.get('v') === '45' ? 45 : qs.get('v') === '90' ? 90 : (+localStorage.getItem('diffdeck-mode') === 45 ? 45 : 90);
  const stage = document.getElementById('stage');
  const slides = Array.from(stage.querySelectorAll(':scope > section.slide'));
  let cur = -1, frag = 0, presenterWin = null;

  // ---------------------------------------------------------------- helpers
  const inMode = s => mode === 90 || s.dataset.tier === 'core';
  const visible = () => slides.filter(inMode);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const fragsOf = s => {
    if (!s.__frags) {
      const f = Array.from(s.querySelectorAll('.frag'));
      f.forEach((x, i) => { x.__order = x.dataset.frag != null ? +x.dataset.frag : i + 1; });
      // group by order value so that several elements can share a step
      // an animation can request extra click-steps with data-steps="N" (its frag(k) is called with k = 1..N)
      const extra = Math.max(0, ...Array.from(s.querySelectorAll('[data-steps]')).map(x => +x.dataset.steps || 0));
      const orders = Array.from(new Set(f.map(x => x.__order).concat(Array.from({ length: extra }, (_, i) => i + 1)))).sort((a, b) => a - b);
      s.__frags = orders.map(o => f.filter(x => x.__order === o));
    }
    return s.__frags;
  };
  const minutesOf = s => {
    if (mode === 45 && s.dataset.min45 != null) return +s.dataset.min45;
    return +(s.dataset.min || 1);
  };

  // ---------------------------------------------------------------- setup
  slides.forEach((s, i) => {
    if (!s.id) s.id = 's' + (i + 1);
    if (!s.dataset.tier) s.dataset.tier = 'full';
    // footer with the paper citation
    const foot = el('footer', 'foot');
    const cite = el('div', 'cite');
    const paper = s.dataset.paper || '';
    if (paper) {
      cite.appendChild(el('span', 'lbl', s.dataset.paperLabel || (paper.includes(' | ') ? 'PAPERS' : 'PAPER')));
      const txt = el('span', 'txt');
      paper.split(' | ').forEach((p, k) => {
        if (k) txt.appendChild(el('span', 'sep', '·'));
        txt.appendChild(document.createTextNode(p.trim()));
      });
      txt.title = paper;
      cite.appendChild(txt);
    }
    foot.appendChild(cite);
    const meta = el('div', 'meta');
    const ch = s.dataset.chapter;
    // data-chapter-label overrides the name (the opening slides sit in chapter 0 but are not the primer)
    meta.appendChild(el('span', 'chap', s.dataset.chapterLabel != null ? s.dataset.chapterLabel : ch != null && CH_NAMES[ch] ? (ch > 0 && ch < 10 ? 'Ch ' + ch + ' · ' : '') + CH_NAMES[ch] : ''));
    meta.appendChild(el('span', 'tierdot'));
    meta.appendChild(el('span', 'num', ''));
    foot.appendChild(meta);
    if (!s.classList.contains('nofoot')) s.appendChild(foot);
    // videos: defer loading
    s.querySelectorAll('video').forEach(v => {
      v.muted = !v.hasAttribute('data-sound');
      v.playsInline = true;
      if (!v.hasAttribute('controls') && !v.hasAttribute('data-noloop')) v.loop = true;
      v.preload = 'none';
    });
    // zoomable images
    s.querySelectorAll('img.zoomable').forEach(img => img.addEventListener('click', e => {
      e.stopPropagation(); lightbox(img.src);
    }));
  });

  // chrome
  const viewport = document.getElementById('viewport');
  const rail = el('div'); rail.id = 'rail'; stage.appendChild(rail);
  const grain = el('div'); grain.id = 'grain'; stage.appendChild(grain);
  const chip = el('div', '', '<span class="m45">45′ CORE</span><span class="m90">90′ FULL</span>'); chip.id = 'modechip';
  chip.title = 'Toggle 45-min / 90-min cut (V)';
  stage.appendChild(chip);
  const toast = el('div'); toast.id = 'toast'; stage.appendChild(toast);
  const black = el('div'); black.id = 'blackout'; stage.appendChild(black);
  const notesbox = el('div'); notesbox.id = 'notesbox'; stage.appendChild(notesbox);
  const lb = el('div', '', '<img alt="">'); lb.id = 'lightbox'; document.body.appendChild(lb);
  lb.addEventListener('click', () => lb.classList.remove('on'));
  function lightbox(src) { lb.querySelector('img').src = src; lb.classList.add('on'); }
  const help = el('div', '', `<div class="box">
    <div><kbd>→</kbd><kbd>Space</kbd> next &nbsp; <kbd>←</kbd> previous</div>
    <div><kbd>V</kbd> toggle 45-min core ⇄ 90-min full cut</div>
    <div><kbd>O</kbd> overview / slide sorter &nbsp; <kbd>Esc</kbd> close</div>
    <div><kbd>P</kbd> presenter window (notes, timer, next slide)</div>
    <div><kbd>N</kbd> show notes on this screen</div>
    <div><kbd>F</kbd> fullscreen &nbsp; <kbd>B</kbd> black screen</div>
    <div><kbd>T</kbd> light ⇄ dark theme</div>
    <div><kbd>12</kbd><kbd>Enter</kbd> jump to slide 12 &nbsp; <kbd>Home</kbd>/<kbd>End</kbd></div>
    <div style="margin-top:10px;color:#7f8596">URL: index.html?v=45 opens the 45-min cut directly</div></div>`);
  help.id = 'help'; document.body.appendChild(help);
  help.addEventListener('click', () => help.classList.remove('on'));
  const overview = el('div'); overview.id = 'overview'; document.body.appendChild(overview);
  if (EMBED) document.body.classList.add('embed');

  // ---------------------------------------------------------------- scaling
  function fit() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    window.__deckScale = s;
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------------------------------------------------------------- media + anims
  function loadMedia(s) {
    if (s.__loaded) return;
    s.__loaded = true;
    s.querySelectorAll('video[data-src]').forEach(v => { v.src = v.dataset.src; v.preload = 'auto'; });
    s.querySelectorAll('video[src]').forEach(v => { v.preload = 'auto'; });
  }
  function startSlide(s) {
    if (!EMBED) s.querySelectorAll('video').forEach(v => {
      if (v.hasAttribute('data-manual')) return;
      try { v.currentTime = 0; } catch (e) {}
      const p = v.play(); if (p && p.catch) p.catch(() => {});
    });
    s.querySelectorAll('[data-anim]').forEach(a => {
      const name = a.dataset.anim;
      const A = window.ANIMS && window.ANIMS[name];
      if (!A) { console.warn('unknown anim', name); return; }
      if (!a.__inst) {
        let params = {};
        try { params = a.dataset.params ? JSON.parse(a.dataset.params) : {}; } catch (e) { console.error('bad params on', a, e); }
        try { a.__inst = A(a, params) || {}; } catch (e) { console.error('anim init failed', name, e); a.__inst = {}; }
      }
      try { a.__inst.start && a.__inst.start(); } catch (e) { console.error(e); }
    });
  }
  function stopSlide(s) {
    s.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} });
    s.querySelectorAll('[data-anim]').forEach(a => { try { a.__inst && a.__inst.stop && a.__inst.stop(); } catch (e) { console.error(e); } });
  }
  function applyFrag(s, k) {
    const groups = fragsOf(s);
    groups.forEach((g, i) => g.forEach(x => {
      x.classList.toggle('vis', i < k);
      x.classList.toggle('past', i < k - 1);
    }));
    s.querySelectorAll('[data-anim]').forEach(a => { try { a.__inst && a.__inst.frag && a.__inst.frag(k); } catch (e) {} });
    s.dispatchEvent(new CustomEvent('frag', { detail: { k } }));
  }

  // ---------------------------------------------------------------- navigation
  function go(i, k, opts) {
    opts = opts || {};
    i = Math.max(0, Math.min(slides.length - 1, i));
    const s = slides[i];
    const changed = i !== cur;
    if (changed && cur >= 0) {
      const old = slides[cur];
      stopSlide(old);
      old.classList.remove('active');
    }
    const nf = fragsOf(s).length;
    frag = k === 'end' ? nf : Math.max(0, Math.min(nf, k || 0));
    cur = i;
    // neighbours get display so transitions + media preload work
    const vis = visible(); const vi = vis.indexOf(s);
    const near = new Set([s, vis[vi - 1], vis[vi + 1]].filter(Boolean));
    slides.forEach(x => x.classList.toggle('near', near.has(x)));
    near.forEach(loadMedia);
    near.forEach(fitFoot);
    s.classList.add('active');
    if (changed) startSlide(s);
    applyFrag(s, frag);
    updateChrome();
    if (!opts.noHash) {
      const h = '#' + s.id + (frag ? '/' + frag : '');
      if (location.hash !== h) history.replaceState(null, '', h);
    }
    if (!EMBED) localStorage.setItem('diffdeck-pos', s.id);
    broadcast();
  }
  // long citations: shrink, compact, then wrap to 2 (at most 3) lines, so the reference is always readable (never ellipsised).
  // Compact renderings (full text stays in the hover title):
  //   c1  titles → their short name ("DPM-Solver: A Fast ODE…" → "DPM-Solver", "(Imagen)" alias kept)
  //   c2  + titles without a short name cut to 4 words…, author lists "A, B, C" → "A et al."
  //   c3  + titles dropped unless their short name is ≤ 4 words  →  "Authors. Venue Year · arXiv id"
  //   c4  + arXiv ids / URLs dropped (7–9-paper summary slides)  →  "Song et al. DDIM. ICLR 2021"
  // (data-paper titles carry an alias, "Denoising Diffusion Implicit Models (DDIM)", so compacted papers stay distinct)
  function auEnd(p) {
    // "Authors. Title. Venue · id" — the author block ends at the first ". " not after "al" or a single initial
    const re = /\.\s/g; let m;
    while ((m = re.exec(p))) {
      const before = p.slice(0, m.index), after = p.slice(m.index + 2);
      if (/\b[A-Z]$/.test(before) || (/\bal$/.test(before) && after[0] === '(')) continue;   // initial, or "et al. (Lab)."
      return m.index;
    }
    return -1;
  }
  function splitCite(p) {
    const a = auEnd(p);
    if (a < 0) return null;
    const rest = p.slice(a + 2), b = rest.lastIndexOf('. ');
    if (b < 0) return null;
    return { au: p.slice(0, a), ti: rest.slice(0, b), ve: rest.slice(b + 2) };
  }
  function shortName(ti) {
    const alias = ti.match(/\(([^()]{2,40})\)\s*$/);   // an alias needs a capital or digit: "(DDPM)", "(ADM, AdaGN)", not "(blog)"
    if (alias && /[A-Z0-9]/.test(alias[1])) return alias[1];
    const c = ti.indexOf(': ');
    if (c > 0 && ti.slice(0, c).split(/\s+/).length <= 5) return ti.slice(0, c);
    return ti.split(/\s+/).length <= 4 ? ti : null;   // a short title is its own short name ("Consistency Models")
  }
  const isRef = x => /^arXiv:|\.(com|org|io|ai|net|dev)(\/|$)/.test(x);
  const dropRefs = v => v.split(' · ').filter(x => !isRef(x)).join(' · ') || v;
  function compactCite(p, lvl) {
    if (!lvl) return p;
    const c = splitCite(p); if (!c) return lvl >= 4 ? dropRefs(p) : p;
    let { au, ti, ve } = c; const nm = shortName(ti);
    if (lvl >= 2) {
      const tag = au.match(/\s*\(([^()]*)\)\s*$/); const core = tag ? au.slice(0, tag.index) : au;
      const names = core.replace(/\s+et al\.?$/, '').split(',').map(x => x.trim()).filter(Boolean);
      if (/,/.test(core)) au = (names.length === 2 && !/et al\.?$/.test(core) ? names.join(' & ') : names[0] + ' et al.') + (tag ? ' (' + tag[1] + ')' : '');
    }
    if (lvl === 1) ti = nm || ti;
    else if (lvl === 2) { const w = ti.split(/\s+/); ti = nm || (w.length > 5 ? w.slice(0, 4).join(' ') + '…' : ti); }
    else ti = nm && nm.split(/\s+/).length <= 4 ? nm : '';
    if (ti && ti === nm && nm.split(/\s+/).length <= 3) ti = ti.replace(/ /g, '\u00a0');   // "Flow Matching" never wraps
    if (lvl >= 4) ve = dropRefs(ve);
    au = au.replace(/\.$/, '');
    return au + '. ' + (ti ? ti + (ti.endsWith('…') ? ' ' : '. ') : '') + ve;
  }
  // when a citation wraps, URLs / arXiv ids / "Venue 2023" and short names of ≤3 words never break mid-token; "Lipman et al.", "no paper" and
  // "Song & Ermon" stay together, as does an author block of ≤45 chars ("Rombach, Blattmann, Lorenz, Esser & Ommer");
  // an arXiv id / URL / "no paper" stays with its venue or date ("ICML 2022 · arXiv:2112.10741"), a bare year with its title ("LongLive. 2025"),
  // a hyphenated word or date never breaks at its hyphens ("SDXL-Lightning", "2025-03-25"), a short citation (≤3-word title, ≤80 chars) never breaks at all,
  // and a line never starts with the in-citation "·" (it ends the previous line instead)
  const NOBR = /(\b[\w.-]+\.(?:com|org|io|ai|net|dev)\/\S*|arXiv:\S+|\b[A-Z][\w-]*\s(?:19|20)\d\d\b|\b\w[\w.]*(?:-\w[\w.]*)+\+*)/;
  // strictness 2 = all of the above; 1 lets a short citation break; 0 also lets an id / bare year leave its venue / title.
  // The looser tiers are tried before the next compaction level: a kept reference beats a pretty break.
  const glue = (x, strict) => (strict ? x.replace(/\. ((?:19|20)\d\d)(?= ·|$)/g, '.\u00a0$1')
    .replace(/ · (?=arXiv:|no paper|[\w.-]+\.(?:com|org|io|ai|net|dev)\/)/g, '\u00a0·\u00a0') : x).replace(/ · /g, '\u00a0· ')
    .replace(/ et al\./g, '\u00a0et\u00a0al.').replace(/\bno paper\b/g, 'no\u00a0paper').replace(/ & /g, '\u00a0& ');
  function appendCite(t, str, strict) {
    const a = auEnd(str), c = strict > 1 && a > 0 && a <= 45 && splitCite(str);
    if (c && c.ti.split(/\s+/).length <= 3 && str.length <= 80) { const n = el('span', 'nobr'); n.textContent = str; t.appendChild(n); return; }
    if (a > 0 && a <= 45) str = str.slice(0, a).replace(/ /g, '\u00a0') + str.slice(a);
    glue(str, strict).split(NOBR).forEach((x, k) => {
      if (!x) return;
      if (k % 2) { const n = el('span', 'nobr'); n.textContent = x; t.appendChild(n); } else t.appendChild(document.createTextNode(x));
    });
  }
  function renderCite(t, lvl, strict) {
    if (t.__lvl === lvl && t.__strict === strict) return;
    t.__lvl = lvl; t.__strict = strict; t.textContent = '';
    t.__parts.forEach((p, k) => {
      if (k) { t.appendChild(el('span', 'sep', '·')); t.appendChild(document.createTextNode('\u200b')); }   // a wrapped line may start at a new paper
      appendCite(t, compactCite(p, lvl), strict);
    });
  }
  function fitFoot(s) {
    fitCredits(s);
    const t = s.querySelector(':scope > footer.foot .cite .txt');
    if (!t || t.__fit || !t.offsetWidth) return;
    t.__fit = true;
    if (!t.__parts) t.__parts = (t.title || '').split(' | ').map(x => x.trim());
    const over = () => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1;
    const cls = c => { t.classList.remove('f1', 'f2', 'f3'); if (c) t.classList.add(c); };
    // one readable line beats two; two lines at 13.5px beat three at 12.5px — so short names come before wrapping
    const steps = [[0, ''], [0, 'f1'], [1, 'f1'], [0, 'f2'], [1, 'f2'], [2, 'f2'], [3, 'f2'], [4, 'f2'], [3, 'f3'], [4, 'f3']];
    for (const [lvl, c] of steps) for (const strict of c === 'f1' || !c ? [2] : [2, 1, 0]) {   // one line: nothing to break
      renderCite(t, lvl, strict); cls(c); if (!over()) return;
    }
  }
  // credits: (1) never ellipsise the wording — wrap to a second line instead;
  // (2) in a captioned figure, sit 10px above the media's real bottom edge (caption may be 1–2 lines),
  //     unless the author positioned the credit inline or chose a corner/.below class
  function fitCredits(s) {
    s.querySelectorAll('.credit').forEach(cr => {
      if (cr.__fit || !cr.offsetWidth) return;
      const fig = cr.parentElement;
      if (fig && fig.tagName === 'FIGURE' && !cr.matches('.tl,.tr,.below') && (cr.__auto || !(cr.style.top || cr.style.bottom))) {
        let cap = null, media = null;
        for (const ch of fig.children) {
          if (ch === cr) break;
          if (ch.classList.contains('cap')) cap = ch;
          else if (!media && ch.matches('img,video,canvas,.media,.compare,.anim')) media = ch;
        }
        if (cap && media) {
          if (!media.offsetHeight) return;   // not laid out yet (media still loading): retry later
          // object-fit: contain letterboxes the picture inside its content box: anchor to the drawn picture, not the box
          const box = media.offsetTop + media.offsetHeight;
          let mb = box;
          const nw = media.naturalWidth || media.videoWidth, nh = media.naturalHeight || media.videoHeight;
          const cs = getComputedStyle(media), pad = k => parseFloat(cs['padding' + k]) || 0;
          const pt = pad('Top'), pb = pad('Bottom');
          if (nw && nh && cs.objectFit === 'contain') {
            const cw = media.offsetWidth - pad('Left') - pad('Right'), chh = media.offsetHeight - pt - pb;
            const dh = Math.min(chh, cw * nh / nw), free = chh - dh;
            const py = (cs.objectPosition || '').split(' ')[1] || '50%';
            const off = py.endsWith('%') ? free * parseFloat(py) / 100 : Math.min(free, parseFloat(py) || 0);
            mb = media.offsetTop + pt + off + dh;
          }
          // a padding band under the picture (padding-bottom ≥ 24px; add object-position 50% 100% to seat a letterboxed
          // picture on it) holds the credit off the figure: centre the credit in the band
          let b = fig.clientHeight - mb + (cr.classList.contains('side') ? 0 : 10);
          if (pb >= 24) b = fig.clientHeight - box + Math.max(0, (pb - cr.offsetHeight) / 2);
          cr.style.bottom = Math.max(0, Math.round(b)) + 'px'; cr.__auto = true;
        }
      }
      // scrollWidth rounds a sub-pixel overflow away, yet the ellipsis still eats the last characters: compare the text's
      // own width with the content box (computed width is the fractional border-box width; the rect ratio undoes the stage scale)
      const over = () => {
        const cs = getComputedStyle(cr), w = parseFloat(cs.width), r = document.createRange(); r.selectNodeContents(cr);
        const inner = w - ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((a, p) => a + parseFloat(cs[p]), 0);
        return r.getBoundingClientRect().width * w / cr.getBoundingClientRect().width > inner + .05;
      };
      if (over()) {
        // a slightly-too-long credit first tightens (tighter letter-spacing, down to 14px) so it stays a one-line pill
        // in its letterbox; only if that fails does it wrap (a wrapped pill grows upward onto the media)
        cr.style.letterSpacing = '-.02em';
        for (let f = 14.5; f >= 14 && over(); f -= .5) cr.style.fontSize = f + 'px';
        if (over()) { cr.style.fontSize = cr.style.letterSpacing = ''; cr.classList.add('wrap'); }
      }
      // never sit on a sibling .vtag chip (e.g. a .tr credit next to a long top-left tag): step past it
      if (fig) for (const tg of fig.children) {
        if (tg === cr || !tg.classList.contains('vtag') || !tg.offsetWidth) continue;
        const a = cr.getBoundingClientRect(), g = tg.getBoundingClientRect();
        if (a.left < g.right && a.right > g.left && a.top < g.bottom && a.bottom > g.top) {
          if (cr.matches('.tl,.tr')) cr.style.top = (tg.offsetTop + tg.offsetHeight + 6) + 'px';
          else { cr.style.bottom = (fig.clientHeight - tg.offsetTop + 6) + 'px'; cr.__auto = false; }
        }
      }
      cr.__fit = true;
    });
  }
  slides.forEach(x => x.querySelectorAll('figure > img, figure > video').forEach(m => {
    const redo = () => { x.querySelectorAll('.credit').forEach(c => { c.__fit = false; c.classList.remove('wrap'); c.style.fontSize = c.style.letterSpacing = ''; }); if (x.classList.contains('near')) fitCredits(x); };
    m.addEventListener(m.tagName === 'IMG' ? 'load' : 'loadedmetadata', redo);
  }));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
    slides.forEach(x => {
      const t = x.querySelector(':scope > footer.foot .cite .txt'); if (t) t.__fit = false;
      x.querySelectorAll('.credit').forEach(c => { c.__fit = false; c.classList.remove('wrap'); c.style.fontSize = c.style.letterSpacing = ''; });
    });
    if (cur >= 0) slides.filter(x => x.classList.contains('near')).forEach(fitFoot);
  });
  function next() {
    const s = slides[cur];
    if (frag < fragsOf(s).length) { frag++; applyFrag(s, frag); updateHash(); broadcast(); return; }
    const vis = visible(); const vi = vis.indexOf(s);
    if (vi < vis.length - 1) go(slides.indexOf(vis[vi + 1]), 0);
  }
  function prev() {
    const s = slides[cur];
    if (frag > 0) { frag--; applyFrag(s, frag); updateHash(); broadcast(); return; }
    const vis = visible(); const vi = vis.indexOf(s);
    if (vi > 0) go(slides.indexOf(vis[vi - 1]), 'end');
  }
  function updateHash() {
    const s = slides[cur]; const h = '#' + s.id + (frag ? '/' + frag : '');
    history.replaceState(null, '', h);
  }
  function setMode(m, quiet) {
    mode = m;
    document.body.classList.toggle('m45', m === 45); document.body.classList.toggle('m90', m === 90);
    if (!EMBED) localStorage.setItem('diffdeck-mode', String(m));
    const u = new URL(location.href); u.searchParams.set('v', String(m));
    history.replaceState(null, '', u.pathname + u.search + location.hash);
    // if the current slide is not part of this cut, move to the next slide that is
    if (cur >= 0 && !inMode(slides[cur])) {
      let j = cur; while (j < slides.length && !inMode(slides[j])) j++;
      if (j >= slides.length) { j = cur; while (j >= 0 && !inMode(slides[j])) j--; }
      go(j, 0);
    } else if (cur >= 0) go(cur, frag);
    buildRail();
    updateChrome();
    if (!quiet) {
      const n = visible().length;
      const mins = visible().reduce((a, s) => a + minutesOf(s), 0);
      showToast(m === 45 ? `45-min core cut · ${n} slides · ~${Math.round(mins)}′` : `90-min full cut · ${n} slides · ~${Math.round(mins)}′`);
      chip.classList.add('flash'); setTimeout(() => chip.classList.remove('flash'), 1500);
    }
    if (overview.classList.contains('on')) buildOverview();
    document.dispatchEvent(new CustomEvent('deckmode', { detail: { mode: m } }));
  }
  function setTheme(t, quiet) {
    if (t === theme) return;
    theme = t; document.documentElement.dataset.theme = t;
    if (!EMBED) localStorage.setItem('diffdeck-theme', t);
    const u = new URL(location.href);
    if (u.searchParams.has('theme')) { u.searchParams.set('theme', t); history.replaceState(null, '', u.pathname + u.search + location.hash); }
    buildRail(); updateChrome();
    document.dispatchEvent(new CustomEvent('decktheme', { detail: { theme: t } }));
    // canvases only repaint while running: restart the visible slide's animations at the current step
    if (cur >= 0) slides[cur].querySelectorAll('[data-anim]').forEach(a => {
      try { if (a.__inst) { a.__inst.stop && a.__inst.stop(); a.__inst.start && a.__inst.start(); a.__inst.frag && a.__inst.frag(frag); } } catch (e) { console.error(e); }
    });
    if (!quiet) showToast(t === 'light' ? 'Light theme' : 'Dark theme');
  }
  // another window (presenter / audience) switched theme
  window.addEventListener('storage', e => { if (e.key === 'diffdeck-theme' && /^(light|dark)$/.test(e.newValue || '')) setTheme(e.newValue, true); });
  let toastT = 0;
  function showToast(t) { toast.textContent = t; toast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('show'), 1800); }

  // ---------------------------------------------------------------- chrome
  function buildRail() {
    rail.innerHTML = '';
    const vis = visible();
    const groups = [];
    vis.forEach(s => {
      const c = s.dataset.chapter || '0';
      if (!groups.length || groups[groups.length - 1].c !== c) groups.push({ c, n: 0, slides: [] });
      groups[groups.length - 1].n++; groups[groups.length - 1].slides.push(s);
    });
    groups.forEach(g => {
      const seg = el('div', 'seg'); seg.style.flex = g.n + ' 1 0'; seg.style.setProperty('--c', (theme === 'light' ? CH_COLORS_LIGHT : CH_COLORS)[g.c] || '#888');
      seg.appendChild(el('i')); seg.__g = g; rail.appendChild(seg);
    });
  }
  function updateChrome() {
    const vis = visible(); const s = slides[cur]; const vi = vis.indexOf(s);
    chip.querySelector('.m45').classList.toggle('on', mode === 45);
    chip.querySelector('.m90').classList.toggle('on', mode === 90);
    chip.querySelector('.m90').classList.add('m90');
    slides.forEach(x => {
      const n = x.querySelector('.foot .num'); if (!n) return;
      const k = vis.indexOf(x);
      n.textContent = k >= 0 ? `${k + 1} / ${vis.length}` : '—';
    });
    Array.from(rail.children).forEach(seg => {
      const g = seg.__g; const idx = g.slides.indexOf(s);
      const before = vis.indexOf(g.slides[0]) < vi;
      seg.firstChild.style.width = idx >= 0 ? ((idx + 1) / g.n * 100) + '%' : (before ? '100%' : '0');
    });
    if (notesbox.classList.contains('on')) showNotes();
  }
  function showNotes() {
    const n = slides[cur].querySelector('aside.notes');
    notesbox.innerHTML = n ? n.innerHTML : '<i>No notes.</i>';
  }

  function buildOverview() {
    const vis = visible();
    let html = `<div class="ov-head"><span>DIFFUSION MODELS · ${mode}-MIN CUT · ${vis.length} SLIDES · ~${Math.round(vis.reduce((a, s) => a + minutesOf(s), 0))} MIN</span><span>click a slide · V toggles cut · Esc closes · <span style="color:var(--core)">■ core (45 + 90)</span> <span style="color:var(--full)">■ full only (90)</span></span></div><div class="ov-grid">`;
    let lastCh = null;
    slides.forEach((s, i) => {
      const c = s.dataset.chapter || '0';
      if (c !== lastCh) { html += `<div class="ov-ch">${c > 0 && c < 10 ? 'Chapter ' + c + ' · ' : ''}${CH_NAMES[c] || ''}</div>`; lastCh = c; }
      const img = s.querySelector('img, video[poster]');
      const src = img ? (img.tagName === 'IMG' ? img.getAttribute('src') : img.getAttribute('poster')) : '';
      const h = s.querySelector('h1, h2'); const t = h ? h.textContent : s.id;
      const k = vis.indexOf(s);
      html += `<div class="ov-card ${i === cur ? 'cur' : ''} ${k < 0 ? 'hidden45' : ''}" data-i="${i}" style="--c:${CH_COLORS[c]}">
        ${src ? `<img src="${src}" loading="lazy" alt="">` : ''}<div class="bar"></div>
        <span class="n">${k >= 0 ? k + 1 : '–'}</span><span class="tier ${s.dataset.tier}">${s.dataset.tier === 'core' ? '45+90' : '90'}</span>
        <div class="t">${t.replace(/</g, '&lt;')}</div></div>`;
    });
    overview.innerHTML = html + '</div>';
    overview.querySelectorAll('.ov-card').forEach(c => c.addEventListener('click', () => {
      const i = +c.dataset.i; if (!inMode(slides[i])) setMode(90, true);
      overview.classList.remove('on'); go(i, 0);
    }));
    const c = overview.querySelector('.ov-card.cur'); if (c) c.scrollIntoView({ block: 'center' });
  }

  // ---------------------------------------------------------------- presenter link
  function openPresenter() {
    const u = new URL(location.href); u.search = '?presenter&v=' + mode; u.hash = '';
    presenterWin = window.open(u.toString(), 'diffdeck-presenter', 'width=1400,height=900');
    setTimeout(broadcast, 800); setTimeout(broadcast, 2000);
  }
  function broadcast() {
    if (EMBED || !presenterWin || presenterWin.closed) return;
    const s = slides[cur]; const vis = visible(); const vi = vis.indexOf(s);
    const nxt = vis[vi + 1];
    const planned = vis.slice(0, vi).reduce((a, x) => a + minutesOf(x), 0);
    const total = vis.reduce((a, x) => a + minutesOf(x), 0);
    presenterWin.postMessage({
      type: 'diffdeck-state', id: s.id, frag, nfrag: fragsOf(s).length, mode,
      title: (s.querySelector('h1,h2') || {}).textContent || s.id,
      notes: (s.querySelector('aside.notes') || {}).innerHTML || '',
      paper: s.dataset.paper || '', next: nxt ? nxt.id : null,
      nextTitle: nxt ? ((nxt.querySelector('h1,h2') || {}).textContent || nxt.id) : '— end —',
      idx: vi + 1, count: vis.length, planned, total, tier: s.dataset.tier
    }, '*');
  }
  window.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type !== 'diffdeck-cmd') return;
    if (d.cmd === 'next') next();
    else if (d.cmd === 'prev') prev();
    else if (d.cmd === 'mode') setMode(mode === 90 ? 45 : 90);
    else if (d.cmd === 'hello') { presenterWin = e.source; broadcast(); }
  });
  // presenter previews drive their embedded copies with postMessage (works for file:// too)
  window.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type !== 'diffdeck-goto' || !EMBED) return;
    if (d.mode && d.mode !== mode) setMode(d.mode, true);
    const i = slides.findIndex(s => s.id === d.id); if (i >= 0) go(i, d.frag || 0, { noHash: true });
  });

  // ---------------------------------------------------------------- input
  let digits = '';
  document.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'range' || e.target.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (overview.classList.contains('on')) {
      if (k === 'Escape' || k === 'o' || k === 'O') { overview.classList.remove('on'); e.preventDefault(); }
      else if (k === 'v' || k === 'V') setMode(mode === 90 ? 45 : 90);
      return;
    }
    if (help.classList.contains('on')) { help.classList.remove('on'); return; }
    if (lb.classList.contains('on')) { lb.classList.remove('on'); return; }
    if (/^[0-9]$/.test(k)) { digits += k; return; }
    if (k === 'Enter' && digits) { const n = +digits; digits = ''; const vis = visible(); const t = vis[Math.max(0, Math.min(vis.length - 1, n - 1))]; go(slides.indexOf(t), 0); return; }
    digits = '';
    switch (k) {
      case 'ArrowRight': case 'PageDown': case ' ': case 'ArrowDown': e.preventDefault(); if (e.target.blur) e.target.blur(); next(); break;
      case 'ArrowLeft': case 'PageUp': case 'ArrowUp': e.preventDefault(); if (e.target.blur) e.target.blur(); prev(); break;
      case 'Home': go(slides.indexOf(visible()[0]), 0); break;
      case 'End': { const v = visible(); go(slides.indexOf(v[v.length - 1]), 0); break; }
      case 'v': case 'V': setMode(mode === 90 ? 45 : 90); break;
      case 'o': case 'O': case 'Escape': buildOverview(); overview.classList.add('on'); break;
      case 'p': case 'P': openPresenter(); break;
      case 'n': case 'N': notesbox.classList.toggle('on'); showNotes(); break;
      case 'f': case 'F': if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen(); break;
      case 'b': case 'B': case '.': black.classList.toggle('on'); break;
      case 't': case 'T': setTheme(theme === 'light' ? 'dark' : 'light'); break;
      case '?': case 'h': case 'H': help.classList.add('on'); break;
    }
  });
  chip.addEventListener('click', e => { e.stopPropagation(); setMode(mode === 90 ? 45 : 90); });
  // range inputs should not keep keyboard focus (so arrows keep navigating)
  document.addEventListener('change', e => { if (e.target && e.target.type === 'range') e.target.blur(); });
  document.addEventListener('pointerup', e => { if (e.target && e.target.type === 'range') setTimeout(() => e.target.blur(), 0); });
  // swipe
  let tx = null;
  viewport.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  viewport.addEventListener('touchend', e => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 60) (dx < 0 ? next : prev)(); tx = null; });
  window.addEventListener('hashchange', () => fromHash(false));

  // compare sliders
  stage.querySelectorAll('.compare').forEach(c => {
    if (!c.querySelector('.handle')) c.appendChild(el('div', 'handle'));
    if (c.dataset.start) c.style.setProperty('--split', (+c.dataset.start) + '%');
    const set = x => { const r = c.getBoundingClientRect(); c.style.setProperty('--split', Math.max(0, Math.min(100, (x - r.left) / r.width * 100)) + '%'); };
    let drag = false;
    c.addEventListener('pointerdown', e => { drag = true; set(e.clientX); c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => { if (drag) set(e.clientX); });
    c.addEventListener('pointerup', () => { drag = false; });
  });

  // ---------------------------------------------------------------- math
  function renderMath() {
    if (typeof renderMathInElement !== 'function') return;
    renderMathInElement(stage, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }],
      throwOnError: false, ignoredClasses: ['nomath']
    });
  }

  // ---------------------------------------------------------------- boot
  function fromHash(initial) {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    let id = h, k = 0;
    const m = h.match(/^(.*)\/(\d+)$/); if (m) { id = m[1]; k = +m[2]; }
    let i = slides.findIndex(s => s.id === id);
    if (i < 0) {
      if (!initial) return;
      i = slides.indexOf(visible()[0]);
    }
    if (!inMode(slides[i])) { if (EMBED) setMode(90, true); else { let j = i; while (j < slides.length - 1 && !inMode(slides[j])) j++; i = j; } }
    if (i === cur && k === frag) return;
    go(i, k, { noHash: !initial });
  }

  function bootPresenter() {
    document.body.classList.add('presenter');
    const root = el('div'); root.id = 'presenter';
    const base = location.href.split('?')[0].split('#')[0];
    root.innerHTML = `
      <div class="top"><span class="clock" id="pclock">00:00</span><button id="preset">reset timer</button>
        <span id="ppos"></span><span class="pace" id="ppace"></span>
        <button id="pprev">◀ prev</button><button id="pnext">next ▶</button><button id="pmode">toggle 45/90</button></div>
      <div class="pv" id="pvcur"><span class="lab">NOW</span><iframe id="fcur"></iframe></div>
      <div class="right"><div class="pv" id="pvnext" style="flex:1"><span class="lab">NEXT</span><iframe id="fnext"></iframe></div>
        <div id="pnexttitle" style="font-family:var(--mono);font-size:15px;color:#aab"></div></div>
      <div class="notes"><h4 id="ptitle"></h4><div id="pnotes"></div></div>`;
    document.body.appendChild(root);
    const fcur = root.querySelector('#fcur'), fnext = root.querySelector('#fnext');
    let curMode = mode;
    fcur.src = base + '?embed&v=' + curMode; fnext.src = base + '?embed&v=' + curMode;
    [fcur, fnext].forEach(f => f.addEventListener('load', () => send('hello')));
    const scaleFrames = () => [['#pvcur', fcur], ['#pvnext', fnext]].forEach(([sel, f]) => {
      const box = root.querySelector(sel); const s = Math.min(box.clientWidth / W, box.clientHeight / H);
      f.style.transform = `scale(${s})`;
    });
    window.addEventListener('resize', scaleFrames); setTimeout(scaleFrames, 50);
    let t0 = Date.now(), lastState = null;
    root.querySelector('#preset').onclick = () => { t0 = Date.now(); };
    const send = cmd => window.opener && window.opener.postMessage({ type: 'diffdeck-cmd', cmd }, '*');
    root.querySelector('#pprev').onclick = () => send('prev');
    root.querySelector('#pnext').onclick = () => send('next');
    root.querySelector('#pmode').onclick = () => send('mode');
    document.addEventListener('keydown', e => {
      if (['ArrowRight', 'PageDown', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); send('next'); }
      if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(e.key)) { e.preventDefault(); send('prev'); }
      if (e.key === 'v' || e.key === 'V') send('mode');
    });
    setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      root.querySelector('#pclock').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
      if (lastState) {
        const diff = sec / 60 - lastState.planned; const p = root.querySelector('#ppace');
        p.textContent = `plan ${lastState.planned.toFixed(1)}′ of ${Math.round(lastState.total)}′ · ${diff > 0 ? '+' : ''}${diff.toFixed(1)}′`;
        p.className = 'pace ' + (diff > 1 ? 'behind' : diff < -1 ? 'ahead' : '');
      }
    }, 500);
    window.addEventListener('message', e => {
      const d = e.data || {}; if (d.type !== 'diffdeck-state') return;
      lastState = d;
      if (d.mode !== curMode) { curMode = d.mode; fcur.src = base + '?embed&v=' + curMode + '#' + d.id; fnext.src = base + '?embed&v=' + curMode + '#' + (d.next || d.id); }
      fcur.contentWindow.postMessage({ type: 'diffdeck-goto', id: d.id, frag: d.frag, mode: d.mode }, '*');
      if (d.next) fnext.contentWindow.postMessage({ type: 'diffdeck-goto', id: d.next, frag: 0, mode: d.mode }, '*');
      root.querySelector('#ptitle').textContent = `${d.title}  ·  ${d.tier === 'core' ? 'core (45+90)' : 'full only (90)'}  ·  step ${d.frag}/${d.nfrag}`;
      root.querySelector('#pnotes').innerHTML = d.notes || '<i>No notes.</i>';
      root.querySelector('#ppos').textContent = `${d.idx} / ${d.count} · ${d.mode}-min cut`;
      root.querySelector('#pnexttitle').textContent = 'Next: ' + d.nextTitle;
    });
    if (window.opener) send('hello');
  }

  document.body.classList.toggle('m45', mode === 45); document.body.classList.toggle('m90', mode === 90);
  if (PRESENTER) { bootPresenter(); return; }
  renderMath();
  buildRail();
  if (!location.hash && !EMBED) {
    const last = localStorage.getItem('diffdeck-pos');
    if (last && qs.has('resume')) location.hash = last;
  }
  fromHash(true);
  if (!EMBED && !localStorage.getItem('diffdeck-helpseen')) {
    localStorage.setItem('diffdeck-helpseen', '1');
    setTimeout(() => showToast('Press  ?  for keys ·  V  toggles 45 / 90-min cut'), 900);
  }
  window.DECK = { go, next, prev, setMode, get mode() { return mode; }, slides };
})();
