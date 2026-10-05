/* ==========================================================================
   Diffusion deck — animation library
   Every animation is  ANIMS[name](el, params) -> { start(), stop(), frag?(k) }
   Used in slides as  <div data-anim="name" data-params='{"...": ...}'></div>
   The 2-D toy animations use an exact Gaussian-mixture model, so scores,
   posterior means and ODE velocities are closed-form (no learned network).
   ========================================================================== */
(function () {
  'use strict';
  const ANIMS = window.ANIMS = {};
  const PI = Math.PI, TAU = 2 * PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r()); }
  function hexToRgb(h) {
    h = (h || '#8ab4ff').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
  // palette from the theme tokens in engine.css (dark defaults when unstyled). Every C handed out is kept and refreshed
  // in place on a theme switch, so draw code that reads C.fg / C.ink each frame follows the theme.
  const LIVE = [];
  function readColors(el) {
    const cs = getComputedStyle(el), v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    const ink = v('--ink', '#ffffff');
    return { hue: v('--hue', '#8ab4ff'), hue2: v('--hue2', '#c792ff'), fg: v('--fg', '#eef0f6'), fg2: v('--fg2', '#c3c8d4'), mute: v('--mute', '#7f8596'),
      bg: v('--bg', '#07080c'), surface: v('--surface', '#0b0d13'), ink, grid: rgba(ink, .07), light: v('--bg', '#07080c') === '#ffffff' };
  }
  function colors(el) { const C = readColors(el); C.of = x => cv(el, x); LIVE.push([el, C]); return C; }
  // a colour parameter may name a theme token ("var(--orange)"); canvas needs the resolved value
  function cv(el, x) {
    const m = /^var\((--[\w-]+)\)$/.exec(String(x || '').trim());
    return m ? (getComputedStyle(el).getPropertyValue(m[1]) || '').trim() || x : x;
  }
  document.addEventListener('decktheme', () => LIVE.forEach(([el, C]) => Object.assign(C, readColors(el))));
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const DISPLAY = SANS;

  function surface(el) {
    el.classList.add('anim');
    const c = document.createElement('canvas'); el.appendChild(c);
    const ctx = c.getContext('2d');
    const S = { c, ctx, w: 0, h: 0, k: 1 };
    S.fit = () => {
      const w = el.clientWidth || 960, h = el.clientHeight || 540;
      const k = Math.min(2, Math.max(1, (window.__deckScale || 1) * (window.devicePixelRatio || 1)));
      if (w !== S.w || h !== S.h || k !== S.k) { S.w = w; S.h = h; S.k = k; c.width = Math.round(w * k); c.height = Math.round(h * k); }
      ctx.setTransform(k, 0, 0, k, 0, 0);
      return S;
    };
    return S;
  }
  function ticker(fn) {
    let id = 0, on = false, last = 0, t = 0;
    const f = now => { if (!on) return; const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now; t += dt; fn(t, dt); id = requestAnimationFrame(f); };
    return { start() { if (on) return; on = true; last = 0; id = requestAnimationFrame(f); }, stop() { on = false; cancelAnimationFrame(id); }, reset() { t = 0; }, get t() { return t; }, set t(v) { t = v; } };
  }
  // control strip (sliders / buttons) — kept small and in a corner
  function controls(el, items) {
    const box = document.createElement('div'); box.className = 'ctl';
    const api = {};
    items.forEach(it => {
      const wrap = document.createElement('label'); wrap.style.display = 'flex'; wrap.style.gap = '10px'; wrap.style.alignItems = 'center';
      if (it.label) { const l = document.createElement('span'); l.innerHTML = it.label; wrap.appendChild(l); }
      if (it.type === 'range') {
        const r = document.createElement('input'); r.type = 'range'; r.min = it.min; r.max = it.max; r.step = it.step || 'any'; r.value = it.value;
        const v = document.createElement('span'); v.className = 'v';
        const show = () => { v.textContent = it.fmt ? it.fmt(+r.value) : (+r.value).toFixed(2); };
        r.addEventListener('input', () => { show(); it.onInput && it.onInput(+r.value); });
        show(); wrap.appendChild(r); wrap.appendChild(v);
        api[it.name] = { set(x) { r.value = x; show(); }, get() { return +r.value; } };
      } else if (it.type === 'buttons') {
        const btns = it.options.map(o => {
          const b = document.createElement('button'); b.textContent = o.label;
          b.addEventListener('click', e => { e.stopPropagation(); btns.forEach(x => x.classList.remove('on')); b.classList.add('on'); it.onPick && it.onPick(o.value); b.blur(); });
          if (o.value === it.value) b.classList.add('on');
          wrap.appendChild(b); return b;
        });
        api[it.name] = { set(x) { btns.forEach((b, i) => b.classList.toggle('on', it.options[i].value === x)); } };
      }
      box.appendChild(wrap);
    });
    box.addEventListener('pointerdown', e => e.stopPropagation());
    el.appendChild(box);
    return api;
  }
  function credit(el, text) {
    if (!text) return;
    const d = document.createElement('div'); d.className = 'anim-credit'; d.textContent = text; el.appendChild(d);
  }
  function loadImg(src) {
    return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function arrow(ctx, x1, y1, x2, y2, head, color, width, dash) {
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width || 2;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    const a = Math.atan2(y2 - y1, x2 - x1), h = head || 9;
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - h * Math.cos(a - .42), y2 - h * Math.sin(a - .42)); ctx.lineTo(x2 - h * Math.cos(a + .42), y2 - h * Math.sin(a + .42)); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // shared colored-noise tile (used for illustrative noise overlays)
  let NOISE_TILE = null;
  function noiseTile() {
    if (NOISE_TILE) return NOISE_TILE;
    const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
    const x = c.getContext('2d'); const im = x.createImageData(n, n); const r = rng(7);
    for (let i = 0; i < n * n; i++) { for (let ch = 0; ch < 3; ch++) im.data[i * 4 + ch] = clamp(127.5 + 70 * gauss(r), 0, 255); im.data[i * 4 + 3] = 255; }
    x.putImageData(im, 0, 0); NOISE_TILE = c; return c;
  }

  /* ======================================================================
     Gaussian-mixture toolkit  (data x0 ~ sum_k w_k N(mu_k, sd_k^2 I))
     x_t = a(t) x0 + s(t) eps   ->   everything below is exact
     ====================================================================== */
  const SCHED = {
    vp: t => ({ a: Math.cos(PI * t / 2), s: Math.sin(PI * t / 2), da: -PI / 2 * Math.sin(PI * t / 2), ds: PI / 2 * Math.cos(PI * t / 2) }),
    fm: t => ({ a: 1 - t, s: t, da: -1, ds: 1 })
  };
  function posterior(comps, x, y, a, s) {
    // returns E[x0 | x_t] and E[eps | x_t];  score = -E[eps|x_t] / s
    let best = -1e300; const lw = new Array(comps.length);
    for (let k = 0; k < comps.length; k++) {
      const c = comps[k], v = a * a * c.sd * c.sd + s * s, dx = x - a * c.x, dy = y - a * c.y;
      const l = Math.log(c.w) - Math.log(v) - (dx * dx + dy * dy) / (2 * v); lw[k] = l; if (l > best) best = l;
    }
    let Z = 0, mx = 0, my = 0;
    for (let k = 0; k < comps.length; k++) {
      const c = comps[k], r = Math.exp(lw[k] - best), v = a * a * c.sd * c.sd + s * s, g = a * c.sd * c.sd / v;
      Z += r; mx += r * (c.x + g * (x - a * c.x)); my += r * (c.y + g * (y - a * c.y));
    }
    mx /= Z; my /= Z;
    const ss = Math.max(s, 1e-6);
    return { x0: mx, y0: my, ex: (x - a * mx) / ss, ey: (y - a * my) / ss };
  }
  function density(comps, x, y, a, s) {
    let p = 0;
    for (let k = 0; k < comps.length; k++) {
      const c = comps[k], v = a * a * c.sd * c.sd + s * s, dx = x - a * c.x, dy = y - a * c.y;
      p += c.w / (TAU * v) * Math.exp(-(dx * dx + dy * dy) / (2 * v));
    }
    return p;
  }
  function sampleData(comps, r) {
    let u = r(), k = 0; while (k < comps.length - 1 && u > comps[k].w) { u -= comps[k].w; k++; }
    const c = comps[k]; return [c.x + c.sd * gauss(r), c.y + c.sd * gauss(r), k];
  }
  function norm(comps) { const z = comps.reduce((a, c) => a + c.w, 0); comps.forEach(c => { c.w /= z; }); return comps; }
  const DATA = {
    ring8: () => norm(Array.from({ length: 8 }, (_, i) => ({ x: 2 * Math.cos(TAU * i / 8), y: 2 * Math.sin(TAU * i / 8), sd: .13, w: 1 }))),
    moons: () => {
      const c = [];
      for (let i = 0; i < 11; i++) { const t = PI * i / 10; c.push({ x: (Math.cos(t) - .5) * 1.9, y: (Math.sin(t) - .25) * 1.9, sd: .11, w: 1 }); }
      for (let i = 0; i < 11; i++) { const t = PI * i / 10; c.push({ x: (1 - Math.cos(t) - .5) * 1.9, y: (.5 - Math.sin(t) - .25) * 1.9, sd: .11, w: 1 }); }
      return norm(c);
    },
    spiral: () => norm(Array.from({ length: 26 }, (_, i) => { const t = .6 + i * .36, r = .25 + i * .085; return { x: r * Math.cos(t), y: r * Math.sin(t), sd: .1, w: 1 }; })),
    smiley: () => {
      const c = [];
      for (let i = 0; i < 22; i++) { const t = TAU * i / 22; c.push({ x: 2.1 * Math.cos(t), y: 2.1 * Math.sin(t), sd: .08, w: 1 }); }
      c.push({ x: -.75, y: .7, sd: .2, w: 2.5 }, { x: .75, y: .7, sd: .2, w: 2.5 });
      for (let i = 0; i < 9; i++) { const t = PI * (1.15 + .7 * i / 8); c.push({ x: 1.15 * Math.cos(t), y: 1.15 * Math.sin(t) + .05, sd: .08, w: 1 }); }
      return norm(c);
    },
    twoclass: () => ({
      A: norm([{ x: -1.5, y: .9, sd: .32, w: 1 }, { x: -1.3, y: -1.0, sd: .3, w: 1 }]),
      B: norm([{ x: .15, y: .25, sd: .38, w: 1 }, { x: 1.5, y: -.8, sd: .32, w: 1 }, { x: 1.2, y: 1.3, sd: .3, w: 1 }])
    })
  };
  function getData(name) {
    if (name === 'twoclass') { const d = DATA.twoclass(); return d.A.map(c => Object.assign({}, c, { w: c.w / 2 })).concat(d.B.map(c => Object.assign({}, c, { w: c.w / 2 }))); }
    return (DATA[name] || DATA.ring8)();
  }
  // panel geometry: n square panels in a row, with a title band on top
  //   o.legendW : width of a legend drawn right of the last panel (at P.x+size+28) — panels+legend are centred together
  //   o.below   : px of captions/readouts drawn under the squares (subs ≈ 32)
  //   o.el      : the anim element — if it has a .ctl strip that would overlap a panel, space is reserved above it
  function ctlBox(el) {
    const c = el && el.querySelector(':scope > .ctl');
    if (!c || !c.offsetHeight || c.style.top) return null;
    return { x0: c.offsetLeft, x1: c.offsetLeft + c.offsetWidth, h: c.offsetHeight + (el.clientHeight - c.offsetTop - c.offsetHeight) };
  }
  function panels(S, n, R, top, o) {
    top = top == null ? 54 : top; o = o || {};
    const gap = 36, lw = o.legendW ? o.legendW + 28 : 0, below = o.below || 0, cb = ctlBox(o.el);
    const lay = reserve => {
      const availW = S.w - gap * (n - 1) - lw, availH = S.h - top - reserve;
      const size = Math.max(60, Math.min(availW / n, availH));
      const total = size * n + gap * (n - 1) + lw; const x0 = Math.max(0, (S.w - total) / 2);
      return Array.from({ length: n }, (_, i) => {
        const P = { x: x0 + i * (size + gap), y: top + (availH - size) / 2 + 6, size, R };
        P.px = (x, y) => [P.x + (x / R + 1) * size / 2, P.y + (1 - y / R) * size / 2];
        return P;
      });
    };
    let PS = lay(70);
    // keep the squares + their captions clear of the control strip (bottom-left)
    if (cb && PS.some(P => P.x < cb.x1 + 12 && P.x + P.size > cb.x0 - 12 && P.y + P.size + below + 10 > S.h - cb.h)) PS = lay(Math.max(70, cb.h + below + 16));
    return PS;
  }
  // set the largest `${px}px family` (hi → lo) at which txt fits in maxW; returns the size used
  function fitFont(ctx, txt, maxW, hi, lo, fam, wt) {
    let fs = hi; ctx.font = `${wt ? wt + ' ' : ''}${fs}px ${fam}`;
    while (fs > lo && ctx.measureText(txt).width > maxW) { fs -= .5; ctx.font = `${wt ? wt + ' ' : ''}${fs}px ${fam}`; }
    return fs;
  }
  // tiny inline math: segs = [[text, kind]] with kind '' (mono words), 'r' (upright math), 'i' (italic), 's' (subscript), 'is' (italic subscript)
  const SERIF = 'KaTeX_Math, "Times New Roman", serif', SERIF_R = 'KaTeX_Main, "Times New Roman", serif';
  // serif glyphs run ~15% smaller than the mono words at the same px, so math kinds get a 1.15 boost
  const mathFont = (k, fs) => { const m = k ? fs * 1.15 : fs; return `${k.includes('i') ? 'italic ' : ''}${Math.round(k.includes('s') ? m * .72 : m)}px ${k.includes('i') ? SERIF : k ? SERIF_R : MONO}`; };
  function mathWidth(ctx, segs, fs) { return segs.reduce((w, [t, k]) => { ctx.font = mathFont(k, fs); return w + ctx.measureText(t).width + (k === 'i' ? fs * .06 : 0); }, 0); }
  function mathText(ctx, segs, x, y, fs, color) {
    const al = ctx.textAlign, W = mathWidth(ctx, segs, fs); ctx.textAlign = 'left'; if (color) ctx.fillStyle = color;
    let cx = al === 'center' ? x - W / 2 : al === 'right' ? x - W : x;
    for (const [t, k] of segs) { ctx.font = mathFont(k, fs); ctx.fillText(t, cx, k.includes('s') ? y + fs * .26 : y); cx += ctx.measureText(t).width + (k === 'i' ? fs * .06 : 0); }
    ctx.textAlign = al; return W;
  }
  function drawPanelFrame(ctx, P, title, C, sub) {
    ctx.save();
    ctx.strokeStyle = rgba(C.ink, C.light ? .14 : .08); ctx.lineWidth = 1;
    roundRect(ctx, P.x, P.y, P.size, P.size, 14); ctx.stroke();
    ctx.fillStyle = C.fg; ctx.textAlign = 'center';
    if (title) {
      // shrink long titles (down to 16px) so they never run past the canvas edge or into the next panel's title
      const cw = ctx.canvas.clientWidth || 1e5, cx = P.x + P.size / 2, maxW = Math.min(P.size + 30, 2 * cx - 4, 2 * (cw - cx) - 4);
      let fs = 22; ctx.font = `600 ${fs}px ${SANS}`;
      while (fs > 16 && ctx.measureText(title).width > maxW) { fs -= 1; ctx.font = `600 ${fs}px ${SANS}`; }
      ctx.fillText(title, cx, P.y - 18);
    }
    if (sub) { ctx.fillStyle = C.mute; ctx.font = `15px ${MONO}`; ctx.fillText(sub, P.x + P.size / 2, P.y + P.size + 26); }
    ctx.restore();
  }
  // density heat-map, cached per (comps, t)
  function heatmap(comps, sch, t, R, color, cache, res) {
    res = res || 96;
    const key = sch + ':' + t.toFixed(3) + color;   // colour in the key: a theme switch must not reuse the old tint
    if (cache && cache[key]) return cache[key];
    const c = document.createElement('canvas'); c.width = c.height = res;
    const ctx = c.getContext('2d'); const im = ctx.createImageData(res, res);
    const S = SCHED[sch](t); const vals = new Float32Array(res * res); let mx = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x = ((i + .5) / res * 2 - 1) * R, y = (1 - (j + .5) / res * 2) * R;
      const p = density(comps, x, y, S.a, Math.max(S.s, .02)); vals[j * res + i] = p; if (p > mx) mx = p;
    }
    const [r, g, b] = hexToRgb(color);
    for (let i = 0; i < res * res; i++) {
      const v = Math.pow(vals[i] / mx, .55);
      im.data[i * 4] = r; im.data[i * 4 + 1] = g; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = 210 * v;
    }
    ctx.putImageData(im, 0, 0);
    if (cache) cache[key] = c;
    return c;
  }
  function drawHeat(ctx, P, hm, alpha) {
    ctx.save(); ctx.globalAlpha = alpha == null ? .55 : alpha; ctx.imageSmoothingEnabled = true;
    roundRect(ctx, P.x, P.y, P.size, P.size, 14); ctx.clip();
    ctx.drawImage(hm, P.x, P.y, P.size, P.size); ctx.restore();
  }
  function dots(ctx, P, pts, color, r, alpha) {
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = alpha == null ? .9 : alpha;
    roundRect(ctx, P.x, P.y, P.size, P.size, 14); ctx.clip();
    const rr = r || 2.2;
    for (const p of pts) { const [x, y] = P.px(p[0], p[1]); ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    ctx.restore();
  }
  // generalised DDIM step (VP):  eta = 1 -> DDPM ancestral, eta = 0 -> deterministic DDIM / PF-ODE
  function ddimStep(comps, sch, x, y, t, t2, eta, r) {
    const S = SCHED[sch](t), S2 = SCHED[sch](t2);
    const p = posterior(comps, x, y, S.a, S.s);
    let c = 0;
    if (eta > 0 && S2.s > 0 && S2.a > 0) c = eta * (S2.s / S.s) * Math.sqrt(Math.max(0, 1 - (S.a * S.a) / (S2.a * S2.a)));
    const d = Math.sqrt(Math.max(0, S2.s * S2.s - c * c));
    return [S2.a * p.x0 + d * p.ex + (c ? c * gauss(r) : 0), S2.a * p.y0 + d * p.ey + (c ? c * gauss(r) : 0)];
  }
  function odeVel(comps, sch, x, y, t) {
    const S = SCHED[sch](t), p = posterior(comps, x, y, S.a, S.s);
    return [S.da * p.x0 + S.ds * p.ex, S.da * p.y0 + S.ds * p.ey, p];
  }
  // accurate PF-ODE trajectory (Heun), returns list of [x,y,t]
  function odeTraj(comps, sch, x, y, N, tEnd) {
    tEnd = tEnd || 0; const out = [[x, y, 1]];
    for (let i = 0; i < N; i++) {
      const t = 1 - (1 - tEnd) * i / N, t2 = 1 - (1 - tEnd) * (i + 1) / N;
      const [vx, vy, p] = odeVel(comps, sch, x, y, Math.max(t, 1e-4));
      if (t2 < 1e-4) { x = p.x0; y = p.y0; }
      else {
        const xe = x + (t2 - t) * vx, ye = y + (t2 - t) * vy; const [vx2, vy2] = odeVel(comps, sch, xe, ye, t2);
        x += (t2 - t) * (vx + vx2) / 2; y += (t2 - t) * (vy + vy2) / 2;
      }
      out.push([x, y, t2]);
    }
    return out;
  }
  function eulerTraj(comps, sch, x, y, N) {
    const out = [[x, y, 1]];
    for (let i = 0; i < N; i++) {
      const t = 1 - i / N, t2 = 1 - (i + 1) / N; const [vx, vy] = odeVel(comps, sch, x, y, Math.max(t, 1e-4));
      x += (t2 - t) * vx; y += (t2 - t) * vy; out.push([x, y, t2]);
    }
    return out;
  }
  ANIMS._gmm = { SCHED, posterior, density, getData, odeTraj, eulerTraj, ddimStep, rng, gauss };

  /* ---------------------------------------------------------------------- gmm-forward
     params: data, n, schedule('vp'|'fm'), dur  — data dissolves into Gaussian noise */
  ANIMS['gmm-forward'] = (el, P) => {
    const S = surface(el), C = colors(el), sch = P.schedule || 'vp', comps = getData(P.data || 'smiley');
    const R = P.R || 3.4, n = P.n || 1600, dur = P.dur || 7, r = rng(11);
    const X0 = [], E = []; for (let i = 0; i < n; i++) { X0.push(sampleData(comps, r)); E.push([gauss(r), gauss(r)]); }
    const cache = {};
    const T = ticker(time => {
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      const ph = (time % (dur + 2.4)); let t = ph < 1.2 ? 0 : ph < 1.2 + dur ? ease((ph - 1.2) / dur) : 1;
      const tq = Math.round(t * 40) / 40;
      const [Pn] = panels(S, 1, R, 30);
      const s = SCHED[sch](t);
      drawHeat(ctx, Pn, heatmap(comps, sch, tq, R, C.hue, cache), .4);
      drawPanelFrame(ctx, Pn, '', C);
      const pts = X0.map((x, i) => [s.a * x[0] + s.s * E[i][0], s.a * x[1] + s.s * E[i][1]]);
      dots(ctx, Pn, pts, C.fg, 1.6, .75);
      ctx.fillStyle = C.fg2; ctx.font = `20px ${MONO}`; ctx.textAlign = 'left';
      const lx = Pn.x + Pn.size + 30, ly = Pn.y + 40;
      ctx.fillText(`t = ${t.toFixed(2)}`, lx, ly);
      ctx.fillStyle = C.mute; ctx.fillText(`α_t = ${s.a.toFixed(2)}`, lx, ly + 34); ctx.fillText(`σ_t = ${s.s.toFixed(2)}`, lx, ly + 64);
      // t bar
      const bw = 18, bh = Pn.size - 120; ctx.strokeStyle = rgba(C.ink, .15); ctx.strokeRect(lx, ly + 100, bw, bh);
      ctx.fillStyle = C.hue; ctx.fillRect(lx, ly + 100, bw, bh * t);
      ctx.fillStyle = C.mute; ctx.font = `14px ${MONO}`; ctx.fillText('data', lx + 28, ly + 112); ctx.fillText('noise', lx + 28, ly + 100 + bh);
    });
    return { start: () => { T.reset(); T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- gmm-score
     params: data, t (initial), anneal(bool), grid — score field + (annealed) Langevin particles */
  ANIMS['gmm-score'] = (el, P) => {
    const S = surface(el), C = colors(el), sch = 'vp', comps = getData(P.data || 'moons');
    const R = P.R || 3.2, G = P.grid || 21, anneal = P.anneal !== false;
    let tFix = P.t != null ? P.t : .35, manual = false;
    const r = rng(5); let parts = [];
    const reset = () => { parts = Array.from({ length: P.n || 500 }, () => [gauss(r) * 1.0, gauss(r) * 1.0]); };
    reset();
    const cache = {};
    const ui = P.controls === false ? null : controls(el, [{ type: 'range', name: 't', label: 'noise level t', min: .03, max: 1, step: .01, value: tFix, onInput: v => { tFix = v; manual = true; } }]);
    let phase = 0;
    const T = ticker((time, dt) => {
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      let t = tFix;
      if (anneal && !manual) {
        // annealed Langevin: t sweeps 1 -> 0.03 then holds, then restarts
        phase += dt; const L = 7, H = 2.5;
        if (phase > L + H) { phase = 0; reset(); }
        t = phase < L ? lerp(1, .03, ease(phase / L)) : .03;
        if (ui) ui.t.set(t);
      }
      ctx.font = `16px ${MONO}`;
      const legW = Math.max(ctx.measureText('arrows: σ·∇log p_t(x)').width, ctx.measureText('(noise annealed 1 → 0)').width);
      const [Pn] = panels(S, 1, R, 24, { legendW: legW, el });
      const tq = Math.round(t * 50) / 50;
      drawHeat(ctx, Pn, heatmap(comps, sch, Math.max(tq, .03), R, C.hue, cache), .45);
      drawPanelFrame(ctx, Pn, '', C);
      const s = SCHED[sch](t);
      // arrow field of the scaled score  sigma * grad log p_t = -E[eps | x_t]
      ctx.save(); roundRect(ctx, Pn.x, Pn.y, Pn.size, Pn.size, 14); ctx.clip();
      const cell = Pn.size / G;
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        const x = ((i + .5) / G * 2 - 1) * R, y = (1 - (j + .5) / G * 2) * R;
        const p = posterior(comps, x, y, s.a, s.s); let vx = -p.ex, vy = -p.ey;
        const m = Math.hypot(vx, vy); const L = Math.min(1, m / 2.2) * cell * .85;
        if (m < 1e-6) continue; vx /= m; vy /= m;
        const [cx, cy] = Pn.px(x, y);
        arrow(ctx, cx - vx * L / 2, cy + vy * L / 2, cx + vx * L / 2, cy - vy * L / 2, 5, rgba(C.fg, .28 + .5 * Math.min(1, m / 2.2)), 1.3);
      }
      ctx.restore();
      // Langevin dynamics at the current noise level: x += (d/2) grad log p + sqrt(d) z,  d = c sigma^2
      const cst = .06;
      for (let it = 0; it < 3; it++) for (const q of parts) {
        const p = posterior(comps, q[0], q[1], s.a, Math.max(s.s, .03)); const sg = Math.max(s.s, .03);
        q[0] += -cst * sg * p.ex / 2 + Math.sqrt(cst) * sg * gauss(r);
        q[1] += -cst * sg * p.ey / 2 + Math.sqrt(cst) * sg * gauss(r);
      }
      // particles live in x_t space; show them
      dots(ctx, Pn, parts, C.hue2, 2.1, .95);
      ctx.fillStyle = C.fg2; ctx.font = `19px ${MONO}`; ctx.textAlign = 'left';
      const lx = Pn.x + Pn.size + 28;
      ctx.fillText(`t = ${t.toFixed(2)}`, lx, Pn.y + 34);
      ctx.fillStyle = C.mute; ctx.font = `16px ${MONO}`;
      ctx.fillText('arrows: σ·∇log p_t(x)', lx, Pn.y + 70); ctx.fillText('dots: Langevin samples', lx, Pn.y + 96);
      if (anneal && !manual) ctx.fillText('(noise annealed 1 → 0)', lx, Pn.y + 122);
    });
    return { start: () => { S.fit(); T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- gmm-sample
     params: data, panels:[{eta,label,sub}], steps, n, trails, dur
     Same initial noise in every panel; eta=1 DDPM (stochastic), eta=0 DDIM (deterministic). */
  ANIMS['gmm-sample'] = (el, P) => {
    const S = surface(el), C = colors(el), sch = 'vp', comps = getData(P.data || 'ring8');
    const R = P.R || 3.2, N = P.steps || 60, n = P.n || 450, nt = P.trails || 12, dur = P.dur || 4.5;
    const PAN = P.panels || [{ eta: 1, label: 'DDPM · stochastic (η = 1)' }, { eta: 0, label: 'DDIM · deterministic (η = 0)' }];
    let seed = 1, traj = null;
    const build = () => {
      const r0 = rng(seed * 97 + 3); const init = Array.from({ length: n }, () => [gauss(r0), gauss(r0)]);
      traj = PAN.map((pn, pi) => {
        const r = rng(seed * 131 + pi * 7 + 1);
        return init.map(([x, y]) => {
          const path = [[x, y]];
          for (let i = 0; i < N; i++) { const t = 1 - i / N, t2 = 1 - (i + 1) / N;[x, y] = ddimStep(comps, sch, x, y, t, t2, pn.eta, r); path.push([x, y]); }
          return path;
        });
      });
    };
    build();
    const cache = {};
    let clock = 0;
    const T = ticker((time, dt) => {
      clock += dt; const hold = 2.2;
      if (clock > dur + hold + .6) { clock = 0; seed++; build(); }
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      const u = clamp(clock / dur, 0, 1), fi = ease(u) * N, i0 = Math.floor(fi), fr = fi - i0;
      const t = 1 - fi / N;
      const hasSub = PAN.some(p => p.sub);
      const PS = panels(S, PAN.length, R, null, { below: hasSub ? 58 : 32, el });
      PS.forEach((Pn, pi) => {
        drawHeat(ctx, Pn, heatmap(comps, sch, Math.max(.02, Math.round(t * 40) / 40), R, C.hue, cache), .35);
        drawPanelFrame(ctx, Pn, PAN[pi].label, C, PAN[pi].sub);
        const tr = traj[pi];
        const pos = tr.map(p => { const a = p[Math.min(N, i0)], b = p[Math.min(N, i0 + 1)]; return [lerp(a[0], b[0], fr), lerp(a[1], b[1], fr)]; });
        // trails
        ctx.save(); roundRect(ctx, Pn.x, Pn.y, Pn.size, Pn.size, 14); ctx.clip();
        const m = Math.min(N, i0);
        for (let k = 0; k < nt; k++) {
          const p = tr[k];
          if (PAN[pi].eta > 0) {
            // stochastic paths: fade each segment by how early it is, so the big early noise jumps recede
            // and the recent steps stay bright (full-opacity random walks turn into a hairball)
            for (let i = 1; i <= m + 1; i++) {
              const [ax, ay] = Pn.px(p[i - 1][0], p[i - 1][1]), [bx, by] = i <= m ? Pn.px(p[i][0], p[i][1]) : Pn.px(pos[k][0], pos[k][1]);
              const a = .1 + .75 * Math.pow(i / (m + 1), 2);
              ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.strokeStyle = rgba(C.hue2, a); ctx.lineWidth = 1.4; ctx.stroke();
            }
            continue;
          }
          ctx.beginPath();
          for (let i = 0; i <= m; i++) { const [x, y] = Pn.px(p[i][0], p[i][1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          const [x, y] = Pn.px(pos[k][0], pos[k][1]); ctx.lineTo(x, y);
          ctx.strokeStyle = rgba(C.hue2, .8); ctx.lineWidth = 1.6; ctx.stroke();
        }
        ctx.restore();
        dots(ctx, Pn, pos, C.fg, 1.7, .8);
        dots(ctx, Pn, pos.slice(0, nt), C.hue2, 3.2, 1);
      });
      const readout = `t = ${t.toFixed(2)}   ·   step ${Math.min(N, Math.round(fi))} / ${N}`;
      const base = PS[0].y + PS[0].size + 26;
      ctx.font = `15px ${MONO}`;
      const subBoxes = PS.map((Pn, pi) => { const w = PAN[pi].sub ? ctx.measureText(PAN[pi].sub).width : 0; return [Pn.x + Pn.size / 2 - w / 2, Pn.x + Pn.size / 2 + w / 2]; });
      ctx.fillStyle = C.fg2; ctx.font = `18px ${MONO}`; ctx.textAlign = 'center';
      const rw = ctx.measureText(readout).width, rx0 = S.w / 2 - rw / 2 - 24, rx1 = S.w / 2 + rw / 2 + 24;
      const clash = subBoxes.some(([a, b]) => b > a && a < rx1 && b > rx0);
      ctx.fillText(readout, S.w / 2, clash ? base + 28 : base);
    });
    return { start: () => { clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- gmm-cfg
     params: w (initial), presets, steps, n — classifier-free guidance on a 2-class toy.
     Guided prediction:  x0~ = x0_u + w (x0_c - x0_u)   (equivalently  eps~ = eps_u + w(eps_c - eps_u)) */
  ANIMS['gmm-cfg'] = (el, P) => {
    const S = surface(el), C = colors(el), sch = 'vp';
    const D = DATA.twoclass(); const all = getData('twoclass'); const condA = D.A;
    const R = P.R || 3.4, N = P.steps || 50, n = P.n || 420;
    let w = P.w != null ? P.w : 3; let paths = null, clock = 0;
    const r0 = rng(21); const init = Array.from({ length: n }, () => [gauss(r0), gauss(r0)]);
    const build = () => {
      paths = init.map(([x, y]) => {
        const path = [[x, y]];
        for (let i = 0; i < N; i++) {
          const t = 1 - i / N, t2 = 1 - (i + 1) / N, s1 = SCHED[sch](t), s2 = SCHED[sch](t2);
          const pu = posterior(all, x, y, s1.a, s1.s), pc = posterior(condA, x, y, s1.a, s1.s);
          const gx = pu.x0 + w * (pc.x0 - pu.x0), gy = pu.y0 + w * (pc.y0 - pu.y0);
          const ex = pu.ex + w * (pc.ex - pu.ex), ey = pu.ey + w * (pc.ey - pu.ey);
          x = s2.a * gx + s2.s * ex; y = s2.a * gy + s2.s * ey; path.push([x, y]);
        }
        return path;
      });
      clock = 0;
    };
    build();
    const hmC = {}, hmA = () => heatmap(D.A, sch, 0.02, R, C.hue, hmC), hmB = () => heatmap(D.B, sch, 0.02, R, C.of('var(--slate)'), hmC);
    controls(el, [{ type: 'buttons', name: 'w', label: 'guidance w', value: w, options: (P.presets || [0, 1, 3, 7]).map(v => ({ label: String(v), value: v })), onPick: v => { w = v; build(); } }]);
    const T = ticker((time, dt) => {
      clock += dt; const dur = 3.2;
      if (clock > dur + 4) clock = 0;
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      ctx.font = `17px ${MONO}`;
      const legW = Math.max(ctx.measureText('p(x|c)^w p(x)^(1-w)').width, ctx.measureText('sample spread 0.00').width, 26 + ctx.measureText('class c (target)').width);
      const [Pn] = panels(S, 1, R, 24, { legendW: legW, el });
      drawHeat(ctx, Pn, hmB(), .35); drawHeat(ctx, Pn, hmA(), .45);
      drawPanelFrame(ctx, Pn, '', C);
      const u = ease(clamp(clock / dur, 0, 1)), fi = u * N, i0 = Math.floor(fi), fr = fi - i0;
      const pos = paths.map(p => { const a = p[Math.min(N, i0)], b = p[Math.min(N, i0 + 1)]; return [lerp(a[0], b[0], fr), lerp(a[1], b[1], fr)]; });
      dots(ctx, Pn, pos, C.fg, 2, .9);
      const lx = Pn.x + Pn.size + 30; ctx.textAlign = 'left';
      ctx.fillStyle = C.fg; ctx.font = `600 26px ${MONO}`; ctx.fillText(`w = ${w}`, lx, Pn.y + 40);
      ctx.font = `17px ${MONO}`; ctx.fillStyle = C.mute;
      const desc = w === 0 ? ['unconditional', 'p(x)'] : w === 1 ? ['conditional', 'p(x | c)'] : ['guided', 'p(x|c)^w p(x)^(1-w)'];
      ctx.fillText(desc[0], lx, Pn.y + 72); ctx.fillText(desc[1], lx, Pn.y + 98);
      ctx.fillStyle = C.hue; ctx.fillRect(lx, Pn.y + 140, 16, 16); ctx.fillStyle = C.fg2; ctx.fillText('class c (target)', lx + 26, Pn.y + 154);
      ctx.fillStyle = C.of('var(--slate)'); ctx.fillRect(lx, Pn.y + 172, 16, 16); ctx.fillStyle = C.fg2; ctx.fillText('other class', lx + 26, Pn.y + 186);
      if (u >= 1) {
        // sample spread (diversity) readout
        let mx = 0, my = 0; pos.forEach(p => { mx += p[0]; my += p[1]; }); mx /= pos.length; my /= pos.length;
        let v = 0; pos.forEach(p => { v += (p[0] - mx) ** 2 + (p[1] - my) ** 2; }); v = Math.sqrt(v / pos.length);
        ctx.fillStyle = C.mute; ctx.fillText(`sample spread ${v.toFixed(2)}`, lx, Pn.y + 236);
      }
    });
    return { start: () => { clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- gmm-paths
     params: data, panels: subset of ['pairs','vp','fm','reflow'], steps (Euler steps), n
     'pairs'  : training targets = straight lines between random (noise, data) pairs (they cross)
     'vp'/'fm': exact marginal PF-ODE trajectories + N-step Euler (dots)
     'reflow' : idealised 2-rectified flow — noise re-paired with its own ODE endpoint (straight) */
  ANIMS['gmm-paths'] = (el, P) => {
    const S = surface(el), C = colors(el), comps = getData(P.data || 'ring8');
    const R = P.R || 3.3, n = P.n || 46;
    const names = P.panels || ['pairs', 'fm', 'reflow'];
    const TITLES = { pairs: 'Training pairs: straight, but they cross', vp: 'Diffusion PF-ODE (VP, cosine)', fm: 'Flow-matching ODE: curved', reflow: 'After reflow: straight' };
    const SUBS = { pairs: 'x_t = (1−t)·x₀ + t·ε, random pairing', vp: 'exact marginal trajectories', fm: 'marginal paths cannot cross', reflow: 'idealised 2-rectified flow' };
    let steps = P.steps || 2;
    const r = rng(17);
    const noise = Array.from({ length: n }, () => [gauss(r), gauss(r)]);
    const dataPts = Array.from({ length: n }, () => sampleData(comps, r));
    const fine = {}; ['vp', 'fm'].forEach(sc => { if (names.includes(sc) || (sc === 'fm' && names.includes('reflow'))) fine[sc] = noise.map(([x, y]) => odeTraj(comps, sc, x, y, 160)); });
    let euler = {};
    const buildEuler = () => { euler = {}; ['vp', 'fm'].forEach(sc => { if (fine[sc]) euler[sc] = noise.map(([x, y]) => eulerTraj(comps, sc, x, y, steps)); }); };
    buildEuler();
    if (P.controls !== false) controls(el, [{ type: 'buttons', name: 'n', label: 'Euler steps', value: steps, options: [1, 2, 4, 8, 32].map(v => ({ label: String(v), value: v })), onPick: v => { steps = v; buildEuler(); clock = 0; } }]);
    const hmC = {}, hm = () => heatmap(comps, 'fm', 0.02, R, C.hue, hmC);
    let clock = 0;
    const T = ticker((time, dt) => {
      clock += dt; const dur = 3.2, hold = 4.5; if (clock > dur + hold) clock = 0;
      const u = ease(clamp(clock / dur, 0, 1));
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      const PS = panels(S, names.length, R, null, { below: 32, el });
      PS.forEach((Pn, pi) => {
        const nm = names[pi];
        drawHeat(ctx, Pn, hm(), .3);
        drawPanelFrame(ctx, Pn, TITLES[nm], C, SUBS[nm]);
        ctx.save(); roundRect(ctx, Pn.x, Pn.y, Pn.size, Pn.size, 14); ctx.clip();
        if (nm === 'pairs') {
          for (let k = 0; k < n; k++) {
            const [ax, ay] = Pn.px(noise[k][0], noise[k][1]), [bx, by] = Pn.px(dataPts[k][0], dataPts[k][1]);
            ctx.strokeStyle = rgba(C.fg, .22); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
            ctx.fillStyle = C.hue2; ctx.beginPath(); ctx.arc(lerp(ax, bx, u), lerp(ay, by, u), 3, 0, TAU); ctx.fill();
          }
        } else {
          const sc = nm === 'reflow' ? 'fm' : nm, F = fine[sc];
          for (let k = 0; k < n; k++) {
            const path = F[k], end = path[path.length - 1];
            if (nm === 'reflow') {
              const [ax, ay] = Pn.px(noise[k][0], noise[k][1]), [bx, by] = Pn.px(end[0], end[1]);
              ctx.strokeStyle = rgba(C.fg, .3); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
              // Euler on a straight path is exact: the steps lie on the line
              for (let i = 1; i <= steps; i++) { const f = Math.min(1, i / steps); if (f > u + 1e-6) break; ctx.fillStyle = C.hue2; ctx.beginPath(); ctx.arc(lerp(ax, bx, f), lerp(ay, by, f), 3, 0, TAU); ctx.fill(); }
              ctx.fillStyle = C.fg; ctx.beginPath(); ctx.arc(lerp(ax, bx, u), lerp(ay, by, u), 2.6, 0, TAU); ctx.fill();
            } else {
              ctx.strokeStyle = rgba(C.fg, .3); ctx.lineWidth = 1.3; ctx.beginPath();
              const last = Math.round(u * (path.length - 1));
              for (let i = 0; i <= last; i++) { const [x, y] = Pn.px(path[i][0], path[i][1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
              ctx.stroke();
              const [hx, hy] = Pn.px(path[last][0], path[last][1]);   // moving head, as in 'pairs' / 'reflow'
              ctx.fillStyle = C.fg; ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, TAU); ctx.fill();
              // Euler polyline
              const E = euler[sc][k]; const shown = Math.floor(u * steps + 1e-6);
              ctx.strokeStyle = rgba(C.hue2, .75); ctx.lineWidth = 1.4; ctx.beginPath();
              for (let i = 0; i <= shown; i++) { const [x, y] = Pn.px(E[i][0], E[i][1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
              ctx.stroke();
              for (let i = 1; i <= shown; i++) { const [x, y] = Pn.px(E[i][0], E[i][1]); ctx.fillStyle = C.hue2; ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill(); }
            }
          }
        }
        ctx.restore();
      });
      ctx.fillStyle = C.mute; ctx.font = `16px ${MONO}`; ctx.textAlign = 'right';
      ctx.fillText(`${C.light ? 'grey' : 'white'}: exact ODE path   ·   colored dots: Euler steps`, S.w - 16, 22);
    });
    return { start: () => { clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- gmm-consistency
     params: data, variant: 'cm' | 'meanflow', schedule
     cm       : every point on one PF-ODE trajectory maps to the same endpoint  f(x_t,t) = x_0
     meanflow : instantaneous velocity v (tangent) vs average velocity u over [r,t] (chord) */
  ANIMS['gmm-consistency'] = (el, P) => {
    const S = surface(el), C = colors(el), comps = getData(P.data || 'ring8'), sch = P.schedule || 'fm';
    const R = P.R || 3.2, variant = P.variant || 'cm';
    const r = rng(P.seed || 4);
    const bg = Array.from({ length: 28 }, () => odeTraj(comps, sch, gauss(r), gauss(r), 120));
    let main = null, fb = null;
    // pick a main trajectory that travels far (long chord) but still bends visibly (length/chord > 1.12);
    // pure max-bend picks tiny loops near a mode
    for (let tries = 0; tries < 80; tries++) {
      const tr = odeTraj(comps, sch, gauss(r) * .8, gauss(r) * .8, 240);
      let L = 0; for (let i = 1; i < tr.length; i++) L += Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]);
      const ch = Math.hypot(tr[tr.length - 1][0] - tr[0][0], tr[tr.length - 1][1] - tr[0][1]), ratio = L / Math.max(ch, 1e-6);
      const score = ch * Math.min(ratio, 1.45);
      if (ratio > 1.12 && (!main || score > main.score)) main = { tr, score, L };
      if (!fb || ratio * ch > fb.score) fb = { tr, score: ratio * ch, L };
    }
    main = main || fb;
    const tr = main.tr, end = tr[tr.length - 1];
    // cumulative arc length -> marks at equal arc length (equal index bunches them where the ODE barely moves)
    const cum = [0]; for (let i = 1; i < tr.length; i++) cum.push(cum[i - 1] + Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]));
    const markIdx = [0, .2, .4, .6, .8].map(f => { let j = 0; while (j < tr.length - 1 && cum[j] < f * main.L) j++; return j; });
    const F_EQ = [['f', 'i'], ['θ', 's'], ['(', 'r'], ['x', 'i'], ['t', 'is'], [', ', 'r'], ['t', 'i'], [')  =  ', 'r'], ['x', 'i'], ['0', 's']];
    const EUL = [['x', 'i'], ['r', 'is'], [' ≈ ', 'r'], ['x', 'i'], ['t', 'is'], [' − (', 'r'], ['t', 'i'], [' − ', 'r'], ['r', 'i'], [')·', 'r'], ['v', 'i'], ['   (Euler, instantaneous ', ''], ['v', 'i'], [')', '']];
    const AVG = [['x', 'i'], ['r', 'is'], [' = ', 'r'], ['x', 'i'], ['t', 'is'], [' − (', 'r'], ['t', 'i'], [' − ', 'r'], ['r', 'i'], [')·', 'r'], ['u', 'i'], ['   (average velocity)', '']];
    let gap = P.gap != null ? P.gap : .5;
    if (variant === 'meanflow') controls(el, [{ type: 'range', name: 'g', label: 'interval t − r', min: .1, max: 1, step: .01, value: gap, onInput: v => { gap = v; } }]);
    const hmC = {}, hm = () => heatmap(comps, sch, .02, R, C.hue, hmC);
    let clock = 0;
    const T = ticker((time, dt) => {
      clock += dt; const dur = 6.5, hold = 1.6; if (clock > dur + hold) clock = 0;
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      ctx.font = `18px ${MONO}`;
      const legW = variant === 'cm' ? Math.max(ctx.measureText('same ODE trajectory').width, mathWidth(ctx, F_EQ, 26)) : ctx.measureText('r = 0  →  one step').width;
      const [Pn] = panels(S, 1, R, 24, { legendW: legW, el });
      drawHeat(ctx, Pn, hm(), .32); drawPanelFrame(ctx, Pn, '', C);
      ctx.save(); roundRect(ctx, Pn.x, Pn.y, Pn.size, Pn.size, 14); ctx.clip();
      bg.forEach(p => { ctx.beginPath(); p.forEach((q, i) => { const [x, y] = Pn.px(q[0], q[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = rgba(C.ink, C.light ? .2 : .1); ctx.lineWidth = 1; ctx.stroke(); });
      ctx.beginPath(); tr.forEach((q, i) => { const [x, y] = Pn.px(q[0], q[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = rgba(C.fg, .75); ctx.lineWidth = 2.2; ctx.stroke();
      const [ex, ey] = Pn.px(end[0], end[1]);
      const u = clamp(clock / dur, 0, 1);
      // meanflow sweeps t from 1 down to the interval length, so every loop ends on r = 0: the one-step jump
      const span = variant === 'meanflow' ? 1 - Math.min(gap, .98) : 1;
      const idx = Math.min(tr.length - 1, Math.round(u * span * (tr.length - 1)));
      const at = i => Pn.px(tr[i][0], tr[i][1]);
      if (variant === 'cm') {
        let lastLbl = null;
        markIdx.forEach(j => {
          if (j > idx) return;
          const [x, y] = at(j);
          arrow(ctx, x, y, ex + (x - ex) * .06, ey + (y - ey) * .06, 10, rgba(C.hue2, .9), 2, [7, 6]);
          ctx.fillStyle = C.hue2; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill();
          if (lastLbl && Math.hypot(x - lastLbl[0], y - lastLbl[1]) < 30) return;   // no stacked labels
          ctx.fillStyle = C.fg2; ctx.font = `16px ${MONO}`; ctx.textAlign = 'left'; ctx.fillText(`t=${tr[j][2].toFixed(2)}`, x + 10, y - 10);
          lastLbl = [x, y];
        });
      } else {
        const t = tr[idx][2];
        if (t > .02) {
          const rr = Math.max(0, t - gap); const j2 = Math.min(tr.length - 1, Math.round((1 - rr) * (tr.length - 1)));
          const [x, y] = at(idx), [x2, y2] = at(j2);
          const [vx, vy] = odeVel(comps, sch, tr[idx][0], tr[idx][1], Math.max(t, 1e-3));
          const hx = tr[idx][0] - (t - rr) * vx, hy = tr[idx][1] - (t - rr) * vy; const [px2, py2] = Pn.px(hx, hy);
          arrow(ctx, x, y, x2, y2, 10, rgba(C.hue2, .95), 2.6, [8, 6]);
          ctx.fillStyle = C.hue2; ctx.beginPath(); ctx.arc(x2, y2, 6, 0, TAU); ctx.fill();
          // Euler step on top, thicker, with an end dot: it is short where v barely changes, so it must stay visible
          const amb = C.of('var(--amber)');
          arrow(ctx, x, y, px2, py2, 12, amb, 3.2);
          ctx.fillStyle = amb; ctx.beginPath(); ctx.arc(px2, py2, 5, 0, TAU); ctx.fill();
          ctx.textAlign = 'left';
          mathText(ctx, EUL, Pn.x + 16, Pn.y + 34, 20, amb);
          mathText(ctx, AVG, Pn.x + 16, Pn.y + 66, 20, C.hue2);
        }
      }
      // moving point
      const [mx, my] = at(idx); ctx.fillStyle = C.fg; ctx.beginPath(); ctx.arc(mx, my, 7, 0, TAU); ctx.fill();
      // endpoint star
      ctx.fillStyle = C.light ? C.fg : '#fff'; ctx.shadowColor = C.hue2; ctx.shadowBlur = 18; ctx.beginPath(); ctx.arc(ex, ey, 8, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.restore();
      const lx = Pn.x + Pn.size + 28; ctx.textAlign = 'left'; ctx.font = `18px ${MONO}`; ctx.fillStyle = C.fg2;
      if (variant === 'cm') { mathText(ctx, F_EQ, lx, Pn.y + 42, 26, C.fg2); ctx.fillStyle = C.mute; ctx.font = `18px ${MONO}`; ctx.fillText('for every t on the', lx, Pn.y + 78); ctx.fillText('same ODE trajectory', lx, Pn.y + 104); }
      else { ctx.fillText(`t = ${tr[idx][2].toFixed(2)}`, lx, Pn.y + 40); ctx.fillText(`r = ${Math.max(0, tr[idx][2] - gap).toFixed(2)}`, lx, Pn.y + 68); ctx.fillStyle = C.mute; ctx.fillText('r = 0  →  one step', lx, Pn.y + 104); }
    });
    return { start: () => { clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- denoise-reveal
     params: text, sub, src (image, optional), dur, size, align, dim (bg use), loop, label
     Coarse-to-fine reveal: x_t = a·blur_t(x0) + s·eps with a VP schedule. */
  ANIMS['denoise-reveal'] = (el, P) => {
    const S = surface(el), C = colors(el);
    const dur = P.dur || 3.6, hold = P.hold || 5, LW = P.res || 480;
    let img = null, ready = !P.src;
    if (P.src) loadImg(P.src).then(im => { img = im; ready = true; prep(); });
    let LH = 270, content = null, lo = null, loCtx = null, small = null, out = null, outCtx = null, noise = null, outIm = null, tainted = false, crisp = null;
    function prep() {
      S.fit();
      LH = Math.max(2, Math.round(LW * S.h / S.w));
      // crisp full-res content
      crisp = document.createElement('canvas'); crisp.width = S.c.width; crisp.height = S.c.height;
      drawContent(crisp.getContext('2d'), crisp.width, crisp.height);
      content = document.createElement('canvas'); content.width = LW; content.height = LH;
      content.getContext('2d').drawImage(crisp, 0, 0, LW, LH);
      lo = document.createElement('canvas'); lo.width = LW; lo.height = LH; loCtx = lo.getContext('2d', { willReadFrequently: true });
      small = document.createElement('canvas');
      out = document.createElement('canvas'); out.width = LW; out.height = LH; outCtx = out.getContext('2d');
      outIm = outCtx.createImageData(LW, LH);
      const r = rng(P.seed || 3); noise = new Float32Array(LW * LH * 3); for (let i = 0; i < noise.length; i++) noise[i] = gauss(r);
    }
    function drawContent(ctx, w, h) {
      const k = w / S.w;
      ctx.fillStyle = '#07080c'; ctx.fillRect(0, 0, w, h);
      if (img) {
        const s = Math.max(w / img.width, h / img.height); const iw = img.width * s, ih = img.height * s;
        ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
        if (P.shade !== false && P.text) {   // keep overlaid text legible
          const g = ctx.createLinearGradient(0, 0, w, 0);
          g.addColorStop(0, 'rgba(7,8,12,.86)'); g.addColorStop(.55, 'rgba(7,8,12,.45)'); g.addColorStop(1, 'rgba(7,8,12,.05)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        }
      }
      if (P.text) {
        const size = (P.size || 150) * k; ctx.textBaseline = 'alphabetic';
        ctx.font = `700 ${size}px ${DISPLAY}`;
        const align = P.align || 'left'; ctx.textAlign = align;
        const x = align === 'center' ? w / 2 : align === 'right' ? w - 90 * k : 96 * k;
        const y = P.y != null ? P.y * h : h * .5;
        const g = ctx.createLinearGradient(x - (align === 'left' ? 0 : size * 3), 0, x + size * 5, 0);
        g.addColorStop(0, P.color || '#ffffff'); g.addColorStop(1, P.color2 || C.hue);
        ctx.fillStyle = g;
        String(P.text).split('\n').forEach((line, i) => ctx.fillText(line, x, y + i * size * 1.02));
        if (P.sub) { ctx.font = `500 ${(P.subSize || 40) * k}px ${SANS}`; ctx.fillStyle = '#c3c8d4'; ctx.fillText(P.sub, x, y + (String(P.text).split('\n').length - 1) * size * 1.02 + size * .62); }
      }
    }
    // default label sits 24px above the bottom-right corner; lift it above any .credit badge that would cover it
    function autoLabelY(tw) {
      const host = el.parentElement; let y = 24;
      if (!host || !el.clientHeight) return y;
      const er = el.getBoundingClientRect(), sc = er.height / el.clientHeight || 1;
      host.querySelectorAll('.credit').forEach(c => {
        if (el.contains(c) || !c.offsetWidth) return;
        const cr = c.getBoundingClientRect();
        const lx0 = er.right - (24 + tw + 8) * sc, ly0 = er.bottom - (y + 18) * sc, ly1 = er.bottom - (y - 6) * sc;
        if (cr.left < er.right && cr.right > lx0 && cr.top < ly1 && cr.bottom > ly0) y = Math.max(y, (er.bottom - cr.top) / sc + 12);
      });
      return y;
    }
    let clock = 0, started = false;
    const T = ticker((time, dt) => {
      if (!ready) return;
      if (!content || S.c.width !== Math.round(el.clientWidth * S.k)) prep();
      clock += dt;
      const total = dur + hold;
      if (P.loop && clock > total + .3) clock = 0;
      const u = clamp(clock / dur, 0, 1);
      const t = 1 - easeOut(u * 1.02);   // noise level 1 -> 0
      const ctx = S.ctx; S.fit();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (t <= 0.002 || tainted) {
        ctx.clearRect(0, 0, S.c.width, S.c.height);
        if (tainted) { ctx.drawImage(crisp, 0, 0); ctx.globalAlpha = clamp(t, 0, 1); ctx.drawImage(noiseTile(), 0, 0, S.c.width, S.c.height); ctx.globalAlpha = 1; }
        else ctx.drawImage(crisp, 0, 0);
      } else {
        // coarse-to-fine estimate of x0: downsample by a factor growing with t
        const f = Math.max(1, Math.pow(2, 6 * Math.pow(t, 1.3)));
        const sw = Math.max(2, Math.round(LW / f)), sh = Math.max(2, Math.round(LH / f));
        small.width = sw; small.height = sh; const sc = small.getContext('2d'); sc.imageSmoothingEnabled = true; sc.drawImage(content, 0, 0, sw, sh);
        loCtx.imageSmoothingEnabled = true; loCtx.clearRect(0, 0, LW, LH); loCtx.drawImage(small, 0, 0, LW, LH);
        let d;
        try { d = loCtx.getImageData(0, 0, LW, LH).data; } catch (e) { tainted = true; return; }
        const a = Math.cos(PI * t / 2), s = Math.sin(PI * t / 2), o = outIm.data;
        for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
          o[i] = clamp((a * (d[i] / 127.5 - 1) + s * noise[j] + 1) * 127.5, 0, 255);
          o[i + 1] = clamp((a * (d[i + 1] / 127.5 - 1) + s * noise[j + 1] + 1) * 127.5, 0, 255);
          o[i + 2] = clamp((a * (d[i + 2] / 127.5 - 1) + s * noise[j + 2] + 1) * 127.5, 0, 255);
          o[i + 3] = 255;
        }
        outCtx.putImageData(outIm, 0, 0);
        ctx.imageSmoothingEnabled = true; ctx.drawImage(out, 0, 0, S.c.width, S.c.height);
        if (t < .12) { ctx.globalAlpha = 1 - t / .12; ctx.drawImage(crisp, 0, 0); ctx.globalAlpha = 1; }
      }
      if (P.label !== false) {
        const k = S.k; ctx.font = `${15 * k}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.textAlign = 'right';
        const steps = P.steps || 50, txt = `t = ${t.toFixed(2)}   step ${Math.round((1 - t) * steps)}/${steps}`;
        ctx.fillText(txt, S.c.width - 24 * k, S.c.height - (P.labelY != null ? P.labelY : autoLabelY(ctx.measureText(txt).width / k)) * k);
      }
      ctx.setTransform(S.k, 0, 0, S.k, 0, 0);
      if (!P.loop && clock > total && P.stopAfter !== false) { /* keep last frame static */ }
    });
    el.addEventListener('click', () => { clock = 0; });
    return { start: () => { clock = 0; if (ready) prep(); T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- forward-noise
     params: src (inlined data URI), schedule ('vp'|'fm'), strip:[t...], auto(bool)
     x_t = a_t x0 + s_t eps on a real image, with the schedule plot. */
  ANIMS['forward-noise'] = (el, P) => {
    const S = surface(el), C = colors(el), sch = P.schedule || 'vp';
    const strip = P.strip || [0, .15, .3, .5, .7, .85, 1];
    let img = null, px = null, nz = null, IW = 0, IH = 0, thumbs = null, cur = null, curCtx = null, curIm = null, tainted = false, t = P.t != null ? P.t : 0, manual = false, lastT = -1;
    const ui = controls(el, [{ type: 'range', name: 't', label: 't', min: 0, max: 1, step: .01, value: t, onInput: v => { t = v; manual = true; } }]);
    loadImg(P.src).then(im => {
      if (!im) return; img = im;
      const M = P.res || 256; const s = M / Math.max(im.width, im.height); IW = Math.round(im.width * s); IH = Math.round(im.height * s);
      const c = document.createElement('canvas'); c.width = IW; c.height = IH; const x = c.getContext('2d'); x.drawImage(im, 0, 0, IW, IH);
      try { px = x.getImageData(0, 0, IW, IH).data; } catch (e) { tainted = true; }
      const r = rng(9); nz = new Float32Array(IW * IH * 3); for (let i = 0; i < nz.length; i++) nz[i] = gauss(r);
      cur = document.createElement('canvas'); cur.width = IW; cur.height = IH; curCtx = cur.getContext('2d'); curIm = curCtx.createImageData(IW, IH);
      thumbs = strip.map(tt => { const cc = document.createElement('canvas'); cc.width = IW; cc.height = IH; render(cc.getContext('2d'), tt, cc); return cc; });
    });
    function render(ctx2, tt, canvas) {
      const sc = SCHED[sch](tt);
      if (tainted || !px) {
        ctx2.clearRect(0, 0, IW, IH); ctx2.globalAlpha = 1; ctx2.drawImage(noiseTile(), 0, 0, IW, IH);
        ctx2.globalAlpha = sc.a; ctx2.drawImage(img, 0, 0, IW, IH); ctx2.globalAlpha = 1; return;
      }
      const im = canvas === cur ? curIm : ctx2.createImageData(IW, IH), o = im.data;
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        o[i] = clamp((sc.a * (px[i] / 127.5 - 1) + sc.s * nz[j] + 1) * 127.5, 0, 255);
        o[i + 1] = clamp((sc.a * (px[i + 1] / 127.5 - 1) + sc.s * nz[j + 1] + 1) * 127.5, 0, 255);
        o[i + 2] = clamp((sc.a * (px[i + 2] / 127.5 - 1) + sc.s * nz[j + 2] + 1) * 127.5, 0, 255);
        o[i + 3] = 255;
      }
      ctx2.putImageData(im, 0, 0);
    }
    let clock = 0;
    const T = ticker((time, dt) => {
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      if (!img || !thumbs) return;
      if (!manual && P.auto !== false) { clock += dt; const L = 9; const ph = (clock % L) / L; t = ph < .1 ? 0 : ph < .55 ? ease((ph - .1) / .45) : ph < .65 ? 1 : 1 - ease((ph - .65) / .35); ui.t.set(t); }
      if (Math.abs(t - lastT) > 1e-3) { render(curCtx, t, cur); lastT = t; }
      // layout: big view left, schedule plot right, strip bottom
      const ctlEl = el.querySelector(':scope > .ctl'), ctlH = ctlEl && ctlEl.offsetHeight ? ctlEl.offsetHeight : 50;
      const stripH = strip.length ? Math.min(150, S.h * .2) : 0, mainH = S.h - stripH - (strip.length ? 40 : ctlH + 20);
      const bw = Math.min(mainH * IW / IH, S.w * .5), bh = bw * IH / IW;
      // no strip: the slider sits right under the image instead of at the bottom of a tall box
      if (ctlEl && !strip.length) { const tp = Math.round(bh + 14) + 'px'; if (ctlEl.style.top !== tp) { ctlEl.style.top = tp; ctlEl.style.bottom = 'auto'; } }
      ctx.imageSmoothingEnabled = false;
      ctx.save(); roundRect(ctx, 0, 0, bw, bh, 14); ctx.clip(); ctx.drawImage(cur, 0, 0, bw, bh); ctx.restore();
      // plot
      const px0 = bw + 60, py0 = 30, pw = S.w - px0 - 20, ph = Math.min(bh - 60, 300);
      ctx.strokeStyle = rgba(C.ink, .15); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px0, py0 + ph); ctx.lineTo(px0 + pw, py0 + ph); ctx.stroke();
      const curve = (fn, col) => { ctx.beginPath(); for (let i = 0; i <= 100; i++) { const tt = i / 100, v = fn(SCHED[sch](tt)); const X = px0 + tt * pw, Y = py0 + ph - v * ph; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke(); };
      curve(s => s.a, C.hue); curve(s => s.s, C.hue2);
      // axes: 0 / 1 ticks, t under the x-axis, curve names at their right-hand ends
      ctx.font = `15px ${MONO}`; ctx.fillStyle = C.mute;
      ctx.textAlign = 'right'; ctx.fillText('1', px0 - 10, py0 + 5); ctx.fillText('0', px0 - 10, py0 + ph + 5);
      ctx.textAlign = 'center'; ctx.fillText('0', px0, py0 + ph + 20); ctx.fillText('1', px0 + pw, py0 + ph + 20); ctx.fillText('t →', px0 + pw / 2, py0 + ph + 20);
      // curve names early on (t = .18), where α is still high and σ low: α_t above its curve, σ_t below its own,
      // clear of the curve over the label's whole width (the linear schedule's lines are steep in a narrow plot)
      const lX = px0 + .18 * pw;
      ctx.font = `600 17px ${MONO}`; ctx.textAlign = 'center';
      const name = (txt, k, col, above) => {
        const w = ctx.measureText(txt).width, ys = [-.5, 0, .5].map(f => py0 + ph - SCHED[sch](.18 + f * w / pw)[k] * ph);
        ctx.fillStyle = col; ctx.fillText(txt, lX, above ? Math.min(...ys) - 10 : Math.max(...ys) + 24);
      };
      name('α_t', 'a', C.hue, true); name('σ_t', 's', C.hue2, false);
      const sc = SCHED[sch](t); const X = px0 + t * pw;
      ctx.strokeStyle = rgba(C.ink, .5); ctx.setLineDash([5, 6]); ctx.beginPath(); ctx.moveTo(X, py0); ctx.lineTo(X, py0 + ph); ctx.stroke(); ctx.setLineDash([]);
      [[sc.a, C.hue], [sc.s, C.hue2]].forEach(([v, col]) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X, py0 + ph - v * ph, 7, 0, TAU); ctx.fill(); });
      ctx.font = `18px ${MONO}`; ctx.textAlign = 'left';
      ctx.fillStyle = C.hue; ctx.fillText(`α_t (signal) = ${sc.a.toFixed(2)}`, px0 + 14, py0 + ph + 56);
      ctx.fillStyle = C.hue2; ctx.fillText(`σ_t (noise)  = ${sc.s.toFixed(2)}`, px0 + 14, py0 + ph + 84);
      ctx.fillStyle = C.mute; ctx.fillText(`t = ${t.toFixed(2)}   SNR = α²/σ² = ${sc.s > 1e-3 ? (sc.a * sc.a / (sc.s * sc.s)).toPrecision(2) : '∞'}`, px0 + 14, py0 + ph + 112);
      ctx.fillText(sch === 'vp' ? 'variance-preserving: α² + σ² = 1' : 'linear path: α = 1 − t, σ = t', px0 + 14, py0 + ph + 140);
      // strip
      // strip: centred, but never under the bottom-left slider (shrinks the thumbnails if needed)
      const n = thumbs.length, gap = 12, xMin = ctlEl && ctlEl.offsetWidth && !ctlEl.style.top ? ctlEl.offsetLeft + ctlEl.offsetWidth + 24 : 0;
      let tw = Math.min((S.w - gap * (n - 1)) / n, stripH * IW / IH);
      let sx0 = (S.w - (tw * n + gap * (n - 1))) / 2;
      if (n && sx0 < xMin) { tw = Math.min(tw, (S.w - xMin - gap * (n - 1)) / n); sx0 = Math.max(xMin, (S.w - (tw * n + gap * (n - 1))) / 2); }
      const th = tw * IH / IW, sy = S.h - th - 4;
      ctx.font = `15px ${MONO}`;
      thumbs.forEach((c, i) => {
        const x = sx0 + i * (tw + gap), lab = `t=${strip[i].toFixed(2)}`;
        ctx.save(); roundRect(ctx, x, sy, tw, th, 8); ctx.clip(); ctx.drawImage(c, x, sy, tw, th); ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x + 6, sy + 6, ctx.measureText(lab).width + 12, 24); ctx.fillStyle = '#fff'; ctx.fillText(lab, x + 12, sy + 23);
      });
      if (P.credit) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `15px ${MONO}`; ctx.fillText(P.credit, 10, bh - 10); }
    });
    return { start: () => { manual = false; clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- patchify
     params: src | srcs (video frames), grid, label, block — image (or clip) -> patches -> tokens -> transformer */
  ANIMS.patchify = (el, P) => {
    const S = surface(el), C = colors(el);
    const srcs = P.srcs || [P.src]; const G = P.grid || 4; const video = srcs.length > 1;
    let imgs = null; Promise.all(srcs.map(loadImg)).then(a => { imgs = a.filter(Boolean); });
    let clock = 0;
    const T = ticker((time, dt) => {
      clock += dt; const L = video ? 9.5 : 8.5; if (clock > L) clock = 0;
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      if (!imgs || !imgs.length) return;
      const F = imgs.length, im0 = imgs[0], ar = im0.width / im0.height;
      const tokensPer = G * G, ntok = tokensPer * F;
      const tokGap = ntok > 20 ? 3 : 4, rowY = S.h * .78, tokS = Math.min(46, (S.w - 40) / ntok - tokGap);
      const rowW = ntok * (tokS + tokGap) - tokGap, rowX = (S.w - rowW) / 2;
      const iy = S.h * .06 + (video ? 30 : 0);
      // keep ≥ 16px between the (split) patch grid and the transformer box above the token row
      const ih = Math.min(S.h * (video ? .48 : .56), rowY - 96 - 16 - 15 - iy), iw = ih * ar;
      const ix = S.w * (video ? .30 : .5) - iw / 2;
      const off = video ? Math.min(46, iw * .09) : 0;
      const tGrid = clamp((clock - .8) / .7, 0, 1), tSplit = clamp((clock - 1.6) / .8, 0, 1);
      const sep = easeOut(tSplit) * 10;
      const pw = iw / G, ph = ih / G;
      for (let f = F - 1; f >= 0; f--) {
        const im = imgs[f], fx = ix + f * off, fy = iy - f * off;
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
          const k = f * tokensPer + j * G + i;
          const start = 2.6 + k * (1.6 / ntok);
          const fly = easeOut(clamp((clock - start) / .9, 0, 1));
          const sx0 = fx + i * (pw + sep) - sep * (G - 1) / 2, sy0 = fy + j * (ph + sep) - sep * (G - 1) / 2;
          const tx = rowX + k * (tokS + tokGap), ty = rowY;
          const x = lerp(sx0, tx, fly), y = lerp(sy0, ty, fly), w = lerp(pw, tokS, fly), h = lerp(ph, tokS, fly);
          if (fly > 0) {   // a faint ghost stays where the patch came from, so the end state still reads "frames → tokens"
            ctx.save(); ctx.globalAlpha = (f === 0 ? .3 : .12) * fly;   // the front frame's ghost dominates the stack
            ctx.drawImage(im, i * im.width / G, j * im.height / G, im.width / G, im.height / G, sx0, sy0, pw, ph);
            ctx.strokeStyle = rgba(C.hue, .5); ctx.lineWidth = 1; ctx.strokeRect(sx0, sy0, pw, ph); ctx.restore();
          }
          ctx.save(); ctx.globalAlpha = f > 0 && fly < .01 ? .92 : 1;
          ctx.drawImage(im, i * im.width / G, j * im.height / G, im.width / G, im.height / G, x, y, w, h);
          if (tGrid > 0) { ctx.strokeStyle = rgba(C.hue, .9 * tGrid); ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h); }
          ctx.restore();
        }
        const tOut = video ? clamp((clock - 4.4) / .5, 0, 1) : 0;   // once emptied, each frame keeps its outline: a stack of 3
        if (tOut > 0) {
          ctx.strokeStyle = rgba(C.hue, .6 * tOut); ctx.lineWidth = 1.5;
          ctx.strokeRect(fx - sep * (G - 1) / 2, fy - sep * (G - 1) / 2, iw + sep * (G - 1), ih + sep * (G - 1));
        }
      }
      if (video && clock > 1.2) {
        ctx.save(); ctx.globalAlpha = .45 + .55 * (1 - clamp((clock - 3.2) / .8, 0, 1));
        ctx.fillStyle = C.fg2; ctx.font = `17px ${MONO}`; ctx.textAlign = 'left';
        ctx.fillText(`${F} frames × ${G}×${G} patches`, ix + iw + F * off + 24, iy + ih / 2);
        ctx.fillStyle = C.mute; ctx.fillText('→ spacetime patches', ix + iw + F * off + 24, iy + ih / 2 + 26);
        ctx.restore();
      }
      // token row label and transformer box
      const tTok = clamp((clock - 4.2) / .6, 0, 1);
      if (tTok > 0) {
        ctx.globalAlpha = tTok;
        ctx.fillStyle = C.mute; ctx.font = `16px ${MONO}`; ctx.textAlign = 'center';
        ctx.fillText(`${ntok} tokens (+ position embeddings)`, S.w / 2, rowY + tokS + 28);
        const bx = rowX - 14, by = rowY - 96, bw = rowW + 28, bh = 66;
        ctx.strokeStyle = C.hue; ctx.lineWidth = 2; roundRect(ctx, bx, by, bw, bh, 14); ctx.stroke();
        ctx.fillStyle = rgba(C.hue, .12); ctx.fill();
        ctx.fillStyle = C.fg; ctx.font = `600 22px ${SANS}`; ctx.fillText(P.block || 'Transformer blocks', S.w / 2, by + 30);
        ctx.fillStyle = C.mute; ctx.font = `15px ${MONO}`; ctx.fillText(P.blockSub || 'self-attention over all tokens · conditioned on t (and c)', S.w / 2, by + 52);
        // flow pulses
        const pulse = (clock * 1.4) % 1;
        for (let k = 0; k < ntok; k += Math.max(1, Math.floor(ntok / 16))) { const x = rowX + k * (tokS + tokGap) + tokS / 2; ctx.fillStyle = rgba(C.hue2, 1 - pulse); ctx.beginPath(); ctx.arc(x, rowY - 4 - pulse * 26, 3, 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    });
    return { start: () => { clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- dforcing
     params: srcs (frames, optional), rows: ['full','ar','df'], n
     Per-frame noise levels: full-sequence diffusion vs autoregressive vs Diffusion Forcing. */
  ANIMS.dforcing = (el, P) => {
    const S = surface(el), C = colors(el);
    const rows = P.rows || ['full', 'ar', 'df']; const n = P.n || 8;
    const LABEL = { full: ['Full-sequence diffusion', 'all frames share one noise level'], ar: ['Autoregressive (next frame)', 'past frames clean, one frame at a time'], df: ['Diffusion Forcing', 'independent per-frame noise levels'] };
    let frames = null;
    if (P.srcs) Promise.all(P.srcs.map(loadImg)).then(a => { frames = a.filter(Boolean); });
    const proc = (ctx, i, x, y, w, h) => { // procedural fallback: a ball rolling across a scene
      const g = ctx.createLinearGradient(x, y, x, y + h); g.addColorStop(0, '#1e3a5f'); g.addColorStop(1, '#0f172a'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#334155'; ctx.fillRect(x, y + h * .78, w, h * .22);
      const bx = x + w * (.15 + .7 * i / (n - 1)), by = y + h * .78 - h * .14 - Math.abs(Math.sin(i * .9)) * h * .3;
      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(bx, by, h * .12, 0, TAU); ctx.fill();
    };
    function level(row, i, u) {
      if (row === 'full') return 1 - clamp(u / .85, 0, 1);
      if (row === 'ar') { const s = i / n * .9, e = (i + 1) / n * .9; return u < s ? 1 : u > e ? 0 : 1 - (u - s) / (e - s); }
      const d = .35, Tt = u / .92 * (1 + (n - 1) * d); return clamp(1 - (Tt - i * d), 0, 1);
    }
    let clock = 0;
    const T = ticker((time, dt) => {
      clock += dt; const L = 9; if (clock > L + 1.5) clock = 0; const u = clamp(clock / L, 0, 1);
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      // label column sized to its widest line (fixed 330 let 'past frames clean, …' run under the first tile)
      let labW = P.labW || 0;
      if (!labW) rows.forEach(row => { ctx.font = `600 22px ${SANS}`; labW = Math.max(labW, ctx.measureText(LABEL[row][0]).width); ctx.font = `15px ${MONO}`; labW = Math.max(labW, ctx.measureText(LABEL[row][1]).width); });
      if (!P.labW) labW = Math.max(300, labW + 24);
      const gap = 10, rowH = (S.h - 30) / rows.length;
      const tw = Math.min((S.w - labW - gap * (n - 1)) / n, (rowH - 50) * 16 / 9), th = tw * 9 / 16;
      const nt = noiseTile();
      rows.forEach((row, ri) => {
        const y = 10 + ri * rowH + (rowH - th - 34) / 2;
        ctx.fillStyle = C.fg; ctx.font = `600 22px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(LABEL[row][0], 0, y + th / 2 - 4);
        ctx.fillStyle = C.mute; ctx.font = `15px ${MONO}`; ctx.fillText(LABEL[row][1], 0, y + th / 2 + 22);
        for (let i = 0; i < n; i++) {
          const x = labW + i * (tw + gap), k = level(row, i, u);
          ctx.save(); roundRect(ctx, x, y, tw, th, 8); ctx.clip();
          if (row === 'ar' && k >= 1 && u < i / n * .9) {
            ctx.strokeStyle = rgba(C.ink, .15); ctx.setLineDash([5, 5]); ctx.strokeRect(x + 1, y + 1, tw - 2, th - 2); ctx.setLineDash([]);
          } else {
            ctx.drawImage(nt, (i * 37) % 128, (ri * 53) % 128, 128, 72, x, y, tw, th);
            ctx.globalAlpha = Math.pow(1 - k, 1.6);   // steeper than cos: k = 0.33 still reads as clearly noisy
            if (frames && frames.length) { const f = frames[Math.min(frames.length - 1, Math.round(i * (frames.length - 1) / Math.max(1, n - 1)))]; const s = Math.max(tw / f.width, th / f.height); ctx.drawImage(f, x + (tw - f.width * s) / 2, y + (th - f.height * s) / 2, f.width * s, f.height * s); }
            else proc(ctx, i, x, y, tw, th);
            ctx.globalAlpha = 1;
          }
          ctx.restore();
          // noise-level bar
          ctx.fillStyle = rgba(C.ink, .08); ctx.fillRect(x, y + th + 8, tw, 8);
          ctx.fillStyle = k > .001 ? C.hue2 : C.hue; ctx.fillRect(x, y + th + 8, tw * Math.max(k, .02), 8);
          ctx.fillStyle = C.mute; ctx.font = `15px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText(`k=${k.toFixed(2)}`, x + tw / 2, y + th + 33);
        }
      });
      ctx.fillStyle = C.mute; ctx.font = `16px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText('frame 1 → ' + n + '   ·   bar = noise level k (1 = pure noise)', S.w, S.h - 4);
    });
    return { start: () => { clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- attn-mask
     params: n, panels: ['bidirectional','causal','block-causal'], block */
  ANIMS['attn-mask'] = (el, P) => {
    const S = surface(el), C = colors(el);
    const n = P.n || 8, names = P.panels || ['bidirectional', 'causal'], B = P.block || 2;
    const TITLE = { bidirectional: 'Bidirectional', causal: 'Causal', 'block-causal': 'Block-causal (chunks)' };
    const SUB = { bidirectional: 'all frames denoised together', causal: 'frame i sees frames ≤ i → streamable', 'block-causal': `chunks of ${B} frames` };
    const allowed = (nm, i, j) => nm === 'bidirectional' ? true : nm === 'causal' ? j <= i : Math.floor(j / B) <= Math.floor(i / B);
    let clock = 0;
    const T = ticker((time, dt) => {
      clock += dt; const L = 6; if (clock > L + 1.5) clock = 0;
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      const m = names.length, gap = 90, y0 = 84, size = Math.min((S.w - gap * (m - 1) - 60) / m, S.h - y0 - 50), x00 = (S.w - (size * m + gap * (m - 1))) / 2;
      const cs = size / n;
      names.forEach((nm, pi) => {
        const x0 = x00 + pi * (size + gap);
        ctx.fillStyle = C.fg; ctx.font = `600 24px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText(TITLE[nm], x0 + size / 2, y0 - 42);
        ctx.fillStyle = C.fg2; ctx.font = `16px ${MONO}`; ctx.fillText(SUB[nm], x0 + size / 2, y0 + size + 30);
        const prog = nm === 'bidirectional' ? (clock > .6 ? n : 0) : clamp(Math.floor(clock / L * n * 1.05) + 1, 0, n);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const ok = allowed(nm, i, j); const on = i < prog;
          ctx.fillStyle = ok ? (on ? rgba(C.hue, .85) : rgba(C.hue, .16)) : rgba(C.ink, C.light ? .05 : .03);
          ctx.fillRect(x0 + j * cs + 1.5, y0 + i * cs + 1.5, cs - 3, cs - 3);
        }
        if (nm !== 'bidirectional' && prog > 0 && prog <= n) {
          const i = prog - 1; ctx.strokeStyle = C.light ? rgba(C.ink, .6) : C.fg; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + i * cs + 1, cs * n - 2, cs - 2);
        }
        ctx.save(); ctx.fillStyle = C.mute; ctx.font = `16px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText('key frame →', x0 + size / 2, y0 - 12);
        ctx.translate(x0 - 14, y0 + size / 2); ctx.rotate(-PI / 2); ctx.fillText('← query frame', 0, 0); ctx.restore();
      });
    });
    return { start: () => { clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- bars
     params: items:[{label, sub, value, note}], log(bool), unit, max — animated horizontal bars */
  ANIMS.bars = (el, P) => {
    const S = surface(el), C = colors(el), items = P.items || [];
    const lg = P.log !== false; const vmax = P.max || Math.max(...items.map(i => i.value)); const vmin = P.min || 1;
    let clock = 0;
    const T = ticker((time, dt) => {
      clock += dt; S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      const labW = P.labelWidth || 330, rh = Math.min(64, (S.h - 30) / items.length), bw = S.w - labW - 180;
      items.forEach((it, i) => {
        const y = 10 + i * rh, u = easeOut(clamp((clock - i * .25) / .9, 0, 1));
        const frac = lg ? (Math.log10(Math.max(vmin, it.value)) - Math.log10(vmin) + .15) / (Math.log10(vmax) - Math.log10(vmin) + .15) : it.value / vmax;
        ctx.fillStyle = C.fg; ctx.font = `600 22px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(it.label, 0, y + rh * .48);
        if (it.sub) { ctx.fillStyle = C.mute; fitFont(ctx, it.sub, labW - 14, 16, 14, MONO); ctx.fillText(it.sub, 0, y + rh * .48 + 21); }
        const g = ctx.createLinearGradient(labW, 0, labW + bw, 0); g.addColorStop(0, C.hue); g.addColorStop(1, C.hue2);
        ctx.fillStyle = g; roundRect(ctx, labW, y + rh * .18, Math.max(4, bw * frac * u), rh * .5, 6); ctx.fill();
        ctx.fillStyle = C.fg; ctx.font = `600 20px ${MONO}`; ctx.fillText((it.text || Math.round(it.value * u)) + (P.unit ? ' ' + P.unit : ''), labW + bw * frac * u + 12, y + rh * .5);
        if (it.note) { ctx.fillStyle = C.mute; ctx.font = `16px ${MONO}`; ctx.fillText(it.note, labW + bw * frac * u + 12, y + rh * .5 + 20); }
      });
      if (lg) { ctx.fillStyle = C.mute; ctx.font = `15px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText('log scale', S.w, S.h - 4); }
    });
    return { start: () => { clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- seq  (Transfusion-style mixed sequence)
     params: tokens:[{type:'text',label}|{type:'img',n}|{type:'boi'}|{type:'eoi'}], mask(bool) */
  ANIMS.seq = (el, P) => {
    const S = surface(el), C = colors(el);
    const toks = []; (P.tokens || []).forEach(t => { if (t.type === 'img') { for (let i = 0; i < (t.n || 9); i++) toks.push({ type: 'img', g: t.g || 0, i }); } else toks.push(t); });
    let gid = -1; toks.forEach((t, i) => { if (t.type === 'img' && (i === 0 || toks[i - 1].type !== 'img')) gid++; if (t.type === 'img') t.g = gid; });
    const nt = noiseTile();
    let clock = 0;
    const T = ticker((time, dt) => {
      // tokens ~1.2s, loss brackets from 0.9s, mask rows fill 0.8 → 2.2s, then hold (P.loop restarts)
      clock += dt; if (P.loop && clock > 9) clock = 0;
      S.fit(); const ctx = S.ctx; ctx.clearRect(0, 0, S.w, S.h);
      const N = toks.length, ts = Math.min(64, (S.w - 40) / N - 6), gap = 6, rowW = N * (ts + gap) - gap, x0 = (S.w - rowW) / 2, y0 = 70;
      toks.forEach((t, i) => {
        const a = easeOut(clamp((clock - i * Math.min(.06, .8 / N)) / .4, 0, 1)); if (a <= 0) return;
        const x = x0 + i * (ts + gap), y = y0 + (1 - a) * 14; ctx.globalAlpha = a;
        if (t.type === 'img') {
          ctx.save(); roundRect(ctx, x, y, ts, ts, 6); ctx.clip(); ctx.drawImage(nt, (i * 23) % 200, (i * 41) % 200, 40, 40, x, y, ts, ts);
          ctx.fillStyle = rgba(C.hue2, .35); ctx.fillRect(x, y, ts, ts); ctx.restore();
        } else {
          ctx.fillStyle = t.type === 'text' ? rgba(C.ink, .08) : rgba(C.hue, .25); roundRect(ctx, x, y, ts, ts, 6); ctx.fill();
          ctx.strokeStyle = rgba(C.ink, .2); ctx.stroke();
          ctx.fillStyle = C.fg; ctx.font = `${t.type === 'text' ? 600 : 400} ${Math.min(17, ts * .32)}px ${t.type === 'text' ? SANS : MONO}`; ctx.textAlign = 'center';
          ctx.fillText(t.type === 'boi' ? '<BOI>' : t.type === 'eoi' ? '<EOI>' : t.label, x + ts / 2, y + ts / 2 + 6);
        }
        ctx.globalAlpha = 1;
      });
      // loss brackets
      const tb = clamp((clock - .9) / .5, 0, 1);
      if (tb > 0) {
        ctx.globalAlpha = tb; let i = 0;
        while (i < N) {
          const ty = toks[i].type === 'img' ? 'img' : 'txt'; let j = i; while (j + 1 < N && (toks[j + 1].type === 'img' ? 'img' : 'txt') === ty) j++;
          const xa = x0 + i * (ts + gap), xb = x0 + j * (ts + gap) + ts, col = ty === 'img' ? C.hue2 : C.fg2;
          ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xa, y0 - 12); ctx.lineTo(xa, y0 - 20); ctx.lineTo(xb, y0 - 20); ctx.lineTo(xb, y0 - 12); ctx.stroke();
          ctx.fillStyle = col; ctx.font = `15px ${MONO}`; ctx.textAlign = 'center';
          ctx.fillText(ty === 'img' ? (P.imgLoss || 'diffusion loss') : (P.txtLoss || 'next-token loss'), (xa + xb) / 2, y0 - 30);
          i = j + 1;
        }
        ctx.globalAlpha = 1;
      }
      // attention mask: causal overall, bidirectional within each image
      if (P.mask !== false) {
        // the mask grid is visible (dimmed) from the start; rows fill in query order
        const tm = clamp((clock - .8) / 1.4, 0, 1);
        const my = y0 + ts + 66, ms = Math.max(60, Math.min(S.h - my - 6, 520, S.w - 80)), cs = ms / N, mx = (S.w - ms) / 2;
        ctx.fillStyle = C.fg2; ctx.font = `17px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText('attention mask: causal across the sequence, bidirectional inside each image', S.w / 2, my - 22);
        // token-type bands on the key (top) and query (left) edges, same colours as the loss brackets
        const tcol = t => t.type === 'img' ? C.hue2 : t.type === 'text' ? rgba(C.fg2, .55) : C.hue;
        toks.forEach((t, j) => { ctx.fillStyle = tcol(t); ctx.fillRect(mx + j * cs + .8, my - 9, cs - 1.6, 5); ctx.fillRect(mx - 9, my + j * cs + .8, 5, cs - 1.6); });
        const rows = tm * N;
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
          const ok = j <= i || (toks[i].type === 'img' && toks[j].type === 'img' && toks[i].g === toks[j].g);
          const inImg = ok && j > i, on = clamp(rows - i, 0, 1);
          ctx.fillStyle = ok ? (inImg ? rgba(C.hue2, .14 + .76 * on) : rgba(C.hue, .12 + .58 * on)) : rgba(C.ink, C.light ? .05 : .03);
          ctx.fillRect(mx + j * cs + .8, my + i * cs + .8, cs - 1.6, cs - 1.6);
        }
      }
    });
    return { start: () => { clock = 0; T.start(); }, stop: T.stop };
  };

  /* ---------------------------------------------------------------------- graph  (block diagrams)
     params: cols, rows, nodes:[{id,c,r,w,h,label,sub,cls,hue,img,f}], edges:[{a,b,label,cls,f,from,to}], seq(bool), step
     c/r = grid cell of the node centre (can be fractional); w/h in cells (default .8 x .6).
     f = fragment step at which the item appears (if any item has f, appearance follows fragments). */
  ANIMS.graph = (el, P) => {
    el.classList.add('anim');
    const nodes = P.nodes || [], edges = P.edges || [];
    const useFrag = nodes.some(n => n.f != null) || edges.some(e => e.f != null);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('class', 'g-svg'); el.appendChild(svg);
    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `<marker id="ah-${el.id || (el.id = 'g' + Math.random().toString(36).slice(2, 8))}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:rgba(var(--ink-rgb),.6)"/></marker>
      <marker id="ahh-${el.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--hue)" style="fill:var(--hue)"/></marker>`;
    svg.appendChild(defs);
    const nEl = {};
    nodes.forEach(n => {
      const d = document.createElement('div'); d.className = 'g-node ' + (n.cls || '');
      if (n.hue) d.style.setProperty('--nh', n.hue);
      d.innerHTML = (n.img ? `<img src="${n.img}" alt="">` : '') + (n.label ? `<span>${n.label}</span>` : '') + (n.sub ? `<small>${n.sub}</small>` : '');
      if (n.size) d.style.fontSize = n.size + 'px';
      el.appendChild(d); nEl[n.id] = d;
    });
    const eEl = edges.map(e => {
      const p = document.createElementNS(svgNS, 'path'); p.setAttribute('class', 'e ' + (e.cls || ''));
      p.setAttribute('marker-end', `url(#${(e.cls || '').includes('flow') ? 'ahh' : 'ah'}-${el.id})`);
      if (e.bi) p.setAttribute('marker-start', `url(#ah-${el.id})`);
      svg.appendChild(p);
      let t = null;
      if (e.label) {
        t = document.createElementNS(svgNS, 'text'); t.setAttribute('text-anchor', 'middle'); t.textContent = e.label;
        // e.size = label px; e.tcls = extra label class ('hl' = bright). Bare operator labels ('+', '×', '⊕') get the bright, larger style by default
        const short = /^[^\p{L}\p{N}]{1,2}$/u.test(String(e.label).trim());
        const cls = [e.tcls || (short ? 'hl' : '')].filter(Boolean).join(' '); if (cls) t.setAttribute('class', cls);
        if (e.size || short) t.style.fontSize = (e.size || 22) + 'px';
        svg.appendChild(t);
      }
      return { p, t };
    });
    function layout() {
      const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
      const cw = W / (P.cols || 4), rh = H / (P.rows || 2);
      const box = {};
      nodes.forEach(n => {
        const w = (n.w || .8) * cw, h = (n.h || .6) * rh, cx = (n.c + .5) * cw, cy = (n.r + .5) * rh;
        Object.assign(nEl[n.id].style, { left: (cx - w / 2) + 'px', top: (cy - h / 2) + 'px', width: w + 'px', height: h + 'px' });
        box[n.id] = { cx, cy, w, h };
      });
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      edges.forEach((e, i) => {
        const A = box[e.a], B = box[e.b]; if (!A || !B) return;
        const dx = B.cx - A.cx, dy = B.cy - A.cy;
        const side = (s, bx, toward) => s === 'r' ? [bx.cx + bx.w / 2, bx.cy, 1, 0] : s === 'l' ? [bx.cx - bx.w / 2, bx.cy, -1, 0] : s === 't' ? [bx.cx, bx.cy - bx.h / 2, 0, -1] : s === 'b' ? [bx.cx, bx.cy + bx.h / 2, 0, 1] : null;
        const horiz = Math.abs(dx) / cw >= Math.abs(dy) / rh;
        const fa = e.from || (horiz ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't'));
        const fb = e.to || (horiz ? (dx > 0 ? 'l' : 'r') : (dy > 0 ? 't' : 'b'));
        const [x1, y1, ux, uy] = side(fa, A), [x2, y2, vx, vy] = side(fb, B);
        const L = Math.max(30, Math.hypot(x2 - x1, y2 - y1) * .4);
        const d = `M${x1},${y1} C${x1 + ux * L},${y1 + uy * L} ${x2 + vx * L},${y2 + vy * L} ${x2 - vx * 3},${y2 - vy * 3}`;
        eEl[i].p.setAttribute('d', d);
        if (eEl[i].t) { eEl[i].t.setAttribute('x', (x1 + x2) / 2 + (e.lx || 0)); eEl[i].t.setAttribute('y', (y1 + y2) / 2 - 8 + (e.ly || 0)); }
      });
    }
    if (typeof renderMathInElement === 'function') {
      try { renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) {}
    }
    let timers = [], lastK = 0;
    function show(k) {
      nodes.forEach(n => nEl[n.id].classList.toggle('on', (n.f || 0) <= k));
      edges.forEach((e, i) => { const on = (e.f != null ? e.f : 0) <= k; eEl[i].p.classList.toggle('on', on); if (eEl[i].t) eEl[i].t.classList.toggle('on', on); });
    }
    return {
      start() {
        layout(); timers.forEach(clearTimeout); timers = [];
        if (useFrag) { show(lastK); return; }
        if (P.seq === false) { show(99); return; }
        // sequential reveal in declaration order
        nodes.forEach(n => nEl[n.id].classList.remove('on')); eEl.forEach(x => { x.p.classList.remove('on'); x.t && x.t.classList.remove('on'); });
        // whole reveal capped at ~2 s however big the diagram is
        const step = Math.min(P.step || 220, 2000 / Math.max(1, nodes.length, nodes.length * .6 + edges.length * .7));
        nodes.forEach((n, i) => timers.push(setTimeout(() => nEl[n.id].classList.add('on'), 150 + i * step)));
        edges.forEach((e, i) => timers.push(setTimeout(() => { eEl[i].p.classList.add('on'); eEl[i].t && eEl[i].t.classList.add('on'); }, 150 + nodes.length * step * .6 + i * step * .7)));
      },
      stop() { timers.forEach(clearTimeout); timers = []; },
      frag(k) { lastK = k; if (useFrag) { layout(); show(k); } }
    };
  };

  /* ---------------------------------------------------------------------- timeline
     params: from, to, lanes:[{name,color}], items:[{d (e.g. 2020.45), lane, label, core}], sweep(bool)
     In the 45-min cut, items with core:false are dimmed. */
  ANIMS.timeline = (el, P) => {
    el.classList.add('anim');
    const from = P.from || 2015, to = P.to || 2026.9, lanes = P.lanes || [{ name: '' }], items = (P.items || []).slice().sort((a, b) => a.d - b.d);
    const wrap = document.createElement('div'); wrap.style.cssText = 'position:absolute;inset:0;';
    el.appendChild(wrap);
    let built = false, timers = [];
    const fs = P.fontScale || 1, px = v => Math.round(v * fs * 10) / 10;
    function build() {
      wrap.innerHTML = '';
      const W = el.clientWidth, H = el.clientHeight, L = P.labelW || 200, top = 14, axisH = Math.round(44 * Math.max(1, fs));
      const laneH = (H - axisH - top) / lanes.length;
      const X = d => L + (d - from) / (to - from) * (W - L - 30);
      // year ticks
      for (let y = Math.ceil(from); y <= Math.floor(to); y++) {
        const t = document.createElement('div');
        t.style.cssText = `position:absolute;left:${X(y)}px;top:${top}px;bottom:${axisH - 8}px;border-left:1px solid rgba(var(--ink-rgb),.07);`;
        wrap.appendChild(t);
        const lab = document.createElement('div'); lab.textContent = y;
        lab.style.cssText = `position:absolute;left:${X(y)}px;bottom:8px;transform:translateX(-50%);font:${px(16)}px ${MONO};color:var(--mute);`;
        wrap.appendChild(lab);
      }
      lanes.forEach((ln, li) => {
        const y = top + li * laneH;
        const name = document.createElement('div'); name.textContent = ln.name;
        name.style.cssText = `position:absolute;left:0;top:${y + laneH / 2 - px(12)}px;width:${L - 20}px;font:600 ${px(18)}px ${SANS};color:${ln.color || 'var(--fg2)'};letter-spacing:.02em;`;
        wrap.appendChild(name);
        const line = document.createElement('div');
        line.style.cssText = `position:absolute;left:${L}px;right:20px;top:${y + laneH / 2}px;height:2px;background:linear-gradient(90deg, color-mix(in srgb, ${ln.color || 'var(--azure)'} 33%, transparent), color-mix(in srgb, ${ln.color || 'var(--azure)'} 7%, transparent));`;
        wrap.appendChild(line);
      });
      const mode = (window.DECK && window.DECK.mode) || 90;
      // label placement: alternate above/below with greedy collision avoidance per lane
      const levels = {}, lastDot = {};
      items.forEach((it, idx) => {
        const ln = lanes[it.lane || 0] || {}; const col = ln.color || 'var(--azure)';
        const r = it.core === false ? 6 : 9, key0 = it.lane || 0;
        // dots a few weeks apart would merge into one blob: nudge right just enough to keep them distinct circles (≲ 1 month)
        let cx = X(it.d); const pd = lastDot[key0]; if (pd) cx = Math.max(cx, pd.cx + (pd.r + r) * .85); lastDot[key0] = { cx, r };
        const cy = top + key0 * laneH + laneH / 2;
        const dim = mode === 45 && it.core === false;
        const dot = document.createElement('div'); if (it.core !== false) dot.className = 'tl-core';   // glow (dark) / ring (light): engine.css
        dot.style.cssText = `position:absolute;left:${cx - r - 2}px;top:${cy - r - 2}px;width:${2 * r}px;height:${2 * r}px;border:2px solid var(--bg);box-sizing:content-box;border-radius:50%;background:${col};--dc:${col};opacity:0;transform:scale(.3);transition:opacity .4s, transform .5s;`;
        const lab = document.createElement('div'); lab.innerHTML = it.label;
        lab.style.cssText = `position:absolute;white-space:nowrap;font:${it.core === false ? 500 : 600} ${px(it.core === false ? 15 : 17)}px ${SANS};color:${it.core === false ? 'var(--foot-txt)' : 'var(--fg)'};opacity:0;transition:opacity .5s;`;
        wrap.appendChild(dot); wrap.appendChild(lab);
        const w = lab.offsetWidth || 80;
        const key = it.lane || 0; levels[key] = levels[key] || [];
        const th = 21 * fs; let lv = 0; const maxLv = Math.max(2, Math.floor((laneH / 2 - 8) / th) * 2);
        while (lv < maxLv && levels[key][lv] != null && levels[key][lv] > cx - w / 2 - 8) lv++;
        if (lv >= maxLv) lv = idx % maxLv;
        levels[key][lv] = cx + w / 2;
        const above = lv % 2 === 0, tier = Math.floor(lv / 2);
        const ly = above ? cy - 14 - 20 * fs - tier * th : cy + 14 + tier * th;
        lab.style.left = (cx - w / 2) + 'px'; lab.style.top = ly + 'px';
        it._dot = dot; it._lab = lab; it._dim = dim;
      });
      built = true;
    }
    function reveal() {
      timers.forEach(clearTimeout); timers = [];
      items.forEach((it, i) => {
        const go = () => { it._dot.style.opacity = it._dim ? .25 : 1; it._dot.style.transform = 'none'; it._lab.style.opacity = it._dim ? .25 : 1; };
        // whole sweep capped at ~1.4 s however many items there are
        if (P.sweep === false) go(); else timers.push(setTimeout(go, 200 + i * Math.min(P.step || 90, 1400 / Math.max(1, items.length))));
      });
    }
    let live = false;
    document.addEventListener('deckmode', () => { if (live) { build(); reveal(); } });
    return { start() { live = true; build(); reveal(); }, stop() { live = false; timers.forEach(clearTimeout); } };
  };
})();
