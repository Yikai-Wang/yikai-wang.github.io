/* Vision-centric world model talk: a small, dependency-free slide engine.

   Every slide is a <section class="slide"> on a fixed 1920 x 1080 canvas that is scaled to fit the
   window, so layouts are written in plain px and look the same on a laptop and on a projector.

   Slide markup
     <section class="slide [dark]" id="s-..." data-title="..." data-section="..." data-time="60"
              [data-steps="N"] [data-chrome="none"]>
       ... content ...
       <aside class="notes">speaker notes</aside>
     </section>

   Builds (the clicker advances builds before it advances slides)
     data-step="n"        shown once the slide's step >= n
     data-step-only="a,b" shown only at the listed steps ("1-3" ranges are allowed)
     data-step-hide="n"   hidden once step >= n
     data-step-dim="n"    dimmed once step >= n
     data-anim="up|fade|left|right|scale|none" chooses the entrance of a shown element
   The slide also carries data-current-step, so CSS can style any step directly.

   Scripted slides
     Deck.register('s-id', {
       steps: 3,                         // optional, otherwise derived from the markup
       init(slide) {},                   // once, lazily, before the first update
       update(slide, step, info) {},     // every time the slide is shown or its step changes
       leave(slide) {},                  // when the slide stops being current
     });
     info = { prev, entering, dir, animate, mode }. update() must be able to render ANY step
     directly (the presenter can jump anywhere); animate is true only for a single step forward.

   Media
     <video data-autoplay>                plays while the slide is current
     data-start / data-end (seconds)     start time, and loop back to data-start at data-end
     data-play-step="n"                  starts playing only once the step reaches n
     data-rate="1.5"                     playback rate
     data-loop                           restart at the end (for videos without the loop attribute)
     data-replay                         play once and hold the last frame; a click on the video's
                                         figure plays it again from data-start
     <div data-sync> ... videos ... </div> keeps every video inside locked to the first one
   Videos should be muted, playsinline, preload="none" with a poster; the engine preloads the
   current and the next slide.

   URL: #/12 or #/12/3 (slide number from 1, then build step). ?presenter opens the presenter
   view, ?static disables all motion (for screenshots), ?print lays every slide out for PDF export.
*/
(() => {
  'use strict';

  const W = 1920;
  const H = 1080;
  const params = new URLSearchParams(location.search);
  const MODE = params.has('presenter') ? 'presenter'
    : params.has('embed') ? 'embed'
      : params.has('print') ? 'print'
        : 'deck';
  // Static (no motion) is opt-in: ?static or print. The OS "reduce motion" setting only shows a
  // hint, so a presenter laptop with it switched on still plays the talk's animations.
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STATIC = params.has('static') || MODE === 'print';
  const NS = 'wm-deck';

  const registry = new Map();
  const readyFns = [];
  const inited = new WeakSet();

  let slides = [];
  let index = -1;
  let step = 0;
  let stage = null;
  let chrome = null;
  let overview = false;
  let presenterWin = null;
  let channel = null;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- Steps ----------

  const parseSteps = (spec) => {
    const out = new Set();
    String(spec).split(',').forEach((part) => {
      const [a, b] = part.split('-').map((s) => parseInt(s, 10));
      if (Number.isNaN(a)) return;
      const end = Number.isFinite(b) ? b : a;
      for (let i = a; i <= end; i += 1) out.add(i);
    });
    return out;
  };

  const maxStep = (slide) => {
    const handler = registry.get(slide.id);
    if (handler && Number.isFinite(handler.steps)) return handler.steps;
    let max = parseInt(slide.dataset.steps || '0', 10) || 0;
    slide.querySelectorAll('[data-step],[data-step-hide],[data-step-dim],[data-play-step]').forEach((el) => {
      ['step', 'stepHide', 'stepDim', 'playStep'].forEach((key) => {
        if (el.dataset[key] !== undefined) max = Math.max(max, parseInt(el.dataset[key], 10) || 0);
      });
    });
    slide.querySelectorAll('[data-step-only]').forEach((el) => {
      parseSteps(el.dataset.stepOnly).forEach((n) => { max = Math.max(max, n); });
    });
    return max;
  };

  const applyBuilds = (slide, n) => {
    slide.dataset.currentStep = String(n);
    slide.querySelectorAll('[data-step]').forEach((el) => {
      el.classList.toggle('is-shown', n >= parseInt(el.dataset.step, 10));
    });
    slide.querySelectorAll('[data-step-only]').forEach((el) => {
      el.classList.toggle('is-shown', parseSteps(el.dataset.stepOnly).has(n));
    });
    slide.querySelectorAll('[data-step-hide]').forEach((el) => {
      el.classList.toggle('is-hidden', n >= parseInt(el.dataset.stepHide, 10));
    });
    slide.querySelectorAll('[data-step-dim]').forEach((el) => {
      el.classList.toggle('is-dimmed', n >= parseInt(el.dataset.stepDim, 10));
    });
  };

  const callHandler = (slide, name, ...args) => {
    const handler = registry.get(slide.id);
    if (!handler || typeof handler[name] !== 'function') return;
    try {
      handler[name](slide, ...args);
    } catch (err) {
      console.error(`[deck] ${slide.id}.${name} failed`, err);
    }
  };

  const ensureInit = (slide) => {
    if (inited.has(slide)) return;
    inited.add(slide);
    callHandler(slide, 'init');
  };

  // ---------- Media ----------

  const videosOf = (slide) => Array.from(slide.querySelectorAll('video'));

  const preload = (slide) => {
    if (!slide || MODE === 'embed') return;
    videosOf(slide).forEach((v) => {
      if (v.preload !== 'auto') {
        v.preload = 'auto';
        if (v.readyState === 0) v.load();
      }
    });
  };

  const startTime = (v) => parseFloat(v.dataset.start || '0') || 0;

  const safePlay = (v) => {
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  };

  const seek = (v, t) => {
    const set = () => { try { v.currentTime = t; } catch (e) { /* not seekable yet */ } };
    if (v.readyState >= 1) set();
    else v.addEventListener('loadedmetadata', set, { once: true });
  };

  // Loop a [data-start, data-end] window, and keep synced groups locked to their first video.
  const bindVideo = (v) => {
    if (v.dataset.bound) return;
    v.dataset.bound = '1';
    v.muted = true;
    v.playsInline = true;
    if (v.dataset.rate) v.playbackRate = parseFloat(v.dataset.rate) || 1;
    v.addEventListener('loadedmetadata', () => {
      if (v.dataset.rate) v.playbackRate = parseFloat(v.dataset.rate) || 1;
    });
    v.addEventListener('timeupdate', () => {
      const end = parseFloat(v.dataset.end || '');
      if (Number.isFinite(end) && v.currentTime >= end && !v.closest('[data-sync]')) {
        v.currentTime = startTime(v);
      }
    });
    v.addEventListener('ended', () => {
      if (v.loop || v.closest('[data-sync]')) return;
      if (v.dataset.end || v.hasAttribute('data-loop')) { v.currentTime = startTime(v); safePlay(v); }
    });
    if (v.hasAttribute('data-replay')) {
      const target = v.closest('figure') || v;
      target.classList.add('replayable');
      target.addEventListener('click', (e) => {
        if (document.body.classList.contains('is-overview')) return; // overview picks the slide
        e.stopPropagation();
        v.currentTime = startTime(v);
        safePlay(v);
      });
    }
  };

  const syncTimers = new Map();
  const syncGen = new WeakMap(); // bumped by stopSync, so a pending start from an old visit is dropped

  const startSync = (group) => {
    const vids = Array.from(group.querySelectorAll('video'));
    if (!vids.length) return;
    stopSync(group);
    const gen = syncGen.get(group);
    const master = vids[0];
    const start = startTime(master);
    const end = parseFloat(master.dataset.end || group.dataset.end || '');
    vids.forEach((v) => { bindVideo(v); seek(v, start); });
    const go = () => { if (syncGen.get(group) === gen) vids.forEach(safePlay); };
    // Start together once everyone can play (or after a short grace period).
    let pending = vids.filter((v) => v.readyState < 3).length;
    if (!pending) go();
    else {
      const timer = setTimeout(go, 1200);
      vids.forEach((v) => {
        if (v.readyState >= 3) return;
        v.addEventListener('canplay', () => {
          pending -= 1;
          if (pending <= 0) { clearTimeout(timer); go(); }
        }, { once: true });
      });
    }
    const id = setInterval(() => {
      if (master.paused) return;
      let t = master.currentTime;
      if ((Number.isFinite(end) && t >= end) || master.ended) {
        t = start;
        vids.forEach((v) => { v.currentTime = t; safePlay(v); });
        return;
      }
      vids.slice(1).forEach((v) => {
        if (Math.abs(v.currentTime - t) > 0.12) v.currentTime = t;
        if (v.paused) safePlay(v);
      });
    }, 200);
    syncTimers.set(group, id);
  };

  const stopSync = (group) => {
    syncGen.set(group, (syncGen.get(group) || 0) + 1);
    const id = syncTimers.get(group);
    if (id) clearInterval(id);
    syncTimers.delete(group);
  };

  const mediaEnter = (slide) => {
    if (MODE === 'embed' || MODE === 'print') return;
    preload(slide);
    videosOf(slide).forEach(bindVideo);
    slide.querySelectorAll('[data-sync]').forEach((group) => {
      if (group.dataset.playStep === undefined) startSync(group);
    });
    videosOf(slide).forEach((v) => {
      if (v.closest('[data-sync]')) return;
      if (!v.hasAttribute('data-autoplay') || v.dataset.playStep !== undefined) return;
      seek(v, startTime(v));
      safePlay(v);
    });
  };

  const mediaStep = (slide, n, prev) => {
    if (MODE === 'embed' || MODE === 'print') return;
    slide.querySelectorAll('[data-play-step]').forEach((el) => {
      const at = parseInt(el.dataset.playStep, 10);
      const on = n >= at;
      const wasOn = prev >= at;
      if (on === wasOn && prev !== -1) return;
      if (el.tagName === 'VIDEO') {
        bindVideo(el);
        if (on) { seek(el, startTime(el)); safePlay(el); } else { el.pause(); }
      } else if (el.hasAttribute('data-sync')) {
        if (on) startSync(el);
        else { stopSync(el); el.querySelectorAll('video').forEach((v) => v.pause()); }
      }
    });
  };

  const mediaLeave = (slide) => {
    slide.querySelectorAll('[data-sync]').forEach(stopSync);
    videosOf(slide).forEach((v) => v.pause());
  };

  const toggleMedia = () => {
    const slide = slides[index];
    if (!slide) return;
    const vids = videosOf(slide);
    const anyPlaying = vids.some((v) => !v.paused);
    vids.forEach((v) => (anyPlaying ? v.pause() : safePlay(v)));
  };

  const restartMedia = () => {
    const slide = slides[index];
    if (!slide) return;
    mediaLeave(slide);
    mediaEnter(slide);
    mediaStep(slide, step, -1);
  };

  // ---------- Navigation ----------

  const show = (i, s, opts = {}) => {
    if (!slides.length) return;
    i = clamp(i, 0, slides.length - 1);
    const target = slides[i];
    const last = maxStep(target);
    s = clamp(s, 0, last);
    const entering = i !== index;
    const prevStep = entering ? -1 : step;
    if (!entering && s === step && !opts.force) return;
    const dir = entering ? Math.sign(i - index) || 1 : Math.sign(s - step) || 1;

    if (entering && index >= 0 && slides[index]) {
      const old = slides[index];
      old.classList.remove('is-current');
      old.classList.add('was-current');
      setTimeout(() => old.classList.remove('was-current'), 600);
      mediaLeave(old);
      callHandler(old, 'leave');
    }

    index = i;
    step = s;
    ensureInit(target);
    if (entering) target.classList.add('no-trans');
    applyBuilds(target, s);
    if (entering) {
      void target.offsetWidth; // commit the snapped build state before transitions come back
      requestAnimationFrame(() => target.classList.remove('no-trans'));
      slides.forEach((sl) => sl.classList.toggle('is-current', sl === target));
      target.classList.remove('was-current');
      mediaEnter(target);
      preload(slides[i + 1]);
    }
    mediaStep(target, s, prevStep);
    callHandler(target, 'update', s, {
      prev: prevStep,
      entering,
      dir,
      animate: !STATIC && !opts.instant && (entering ? dir > 0 : s - prevStep === 1),
      mode: MODE,
    });

    updateChrome();
    if (MODE === 'deck' || MODE === 'presenter') {
      const hash = `#/${i + 1}${s ? `/${s}` : ''}`;
      if (location.hash !== hash) history.replaceState(null, '', hash);
    }
    if (MODE === 'deck') broadcast({ type: 'state', index, step });
    emit('change', { index, step, slide: target });
  };

  const next = () => {
    if (index < 0) return;
    if (step < maxStep(slides[index])) show(index, step + 1);
    else if (index < slides.length - 1) show(index + 1, 0);
  };

  const prev = () => {
    if (index < 0) return;
    if (step > 0) show(index, step - 1);
    else if (index > 0) show(index - 1, maxStep(slides[index - 1]), { instant: true });
  };

  // Q&A jumps (number + Enter, overview click, presenter 'go') land on a backup slide's last build.
  const jump = (i) => {
    const t = slides[clamp(i, 0, slides.length - 1)];
    const backup = t && t.dataset.section === 'Backup';
    show(i, backup ? maxStep(t) : 0, backup ? { instant: true } : {});
  };

  const nextSlide = () => show(index + 1, 0);
  const prevSlide = () => show(index - 1, 0);

  const parseHash = () => {
    const m = location.hash.match(/^#\/([^/]+)(?:\/(\d+))?/);
    if (!m) return null;
    let i = parseInt(m[1], 10) - 1;
    if (Number.isNaN(i)) {
      const el = document.getElementById(decodeURIComponent(m[1]));
      i = slides.indexOf(el);
      if (i < 0) return null;
    }
    return { index: i, step: parseInt(m[2] || '0', 10) || 0 };
  };

  // ---------- Events ----------

  const listeners = {};
  const emit = (name, detail) => (listeners[name] || []).forEach((fn) => {
    try { fn(detail); } catch (err) { console.error(err); }
  });

  // ---------- Scaling and chrome ----------

  const fit = () => {
    if (!stage) return;
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    document.documentElement.style.setProperty('--deck-scale', String(scale));
  };

  const buildChrome = () => {
    chrome = document.createElement('div');
    chrome.className = 'deck-chrome';
    chrome.innerHTML = '<span class="deck-brand">Yikai Wang</span>'
      + '<span class="deck-section"></span><span class="deck-num"></span>'
      + '<span class="deck-progress"><i></i></span>';
    stage.appendChild(chrome);
  };

  const updateChrome = () => {
    if (!chrome) return;
    const slide = slides[index];
    const off = slide.dataset.chrome === 'none';
    chrome.classList.toggle('is-off', off);
    chrome.classList.toggle('on-dark', slide.classList.contains('dark'));
    chrome.querySelector('.deck-section').textContent = slide.dataset.section || '';
    chrome.querySelector('.deck-num').textContent = String(index + 1);
    const frac = slides.length > 1 ? index / (slides.length - 1) : 1;
    chrome.querySelector('.deck-progress i').style.width = `${(frac * 100).toFixed(2)}%`;
  };

  const toast = (html, ms = 5000) => {
    const el = document.createElement('div');
    el.className = 'deck-toast';
    el.innerHTML = html;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 500); }, ms);
  };

  const canPlayAV1 = () => {
    const v = document.createElement('video');
    return !!v.canPlayType('video/mp4; codecs="av01.0.05M.08"');
  };

  // ---------- Overview ----------

  const layoutOverview = () => {
    const n = slides.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const scale = Math.min(1 / cols, 1 / rows) * 0.94;
    const gx = (W - cols * W * scale) / (cols + 1);
    const gy = (H - rows * H * scale) / (rows + 1);
    slides.forEach((slide, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = gx + c * (W * scale + gx);
      const y = gy + r * (H * scale + gy);
      slide.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    });
  };

  const setOverview = (on) => {
    if (on === overview) return;
    overview = on;
    document.body.classList.toggle('is-overview', on);
    if (on) {
      if (slides[index]) mediaLeave(slides[index]);
      slides.forEach((slide, i) => {
        ensureInit(slide);
        if (i !== index) {
          const last = maxStep(slide);
          applyBuilds(slide, last);
          callHandler(slide, 'update', last, { prev: -1, entering: true, dir: 1, animate: false, mode: 'overview' });
        }
      });
      layoutOverview();
    } else {
      slides.forEach((slide) => { slide.style.transform = ''; });
      const i = index;
      slides.forEach((sl, k) => { if (k !== i) callHandler(sl, 'leave'); });
      index = -1;
      show(i, step, { instant: true, force: true });
    }
  };

  // ---------- Help ----------

  const HELP = [
    ['→ ␣ PgDn', 'next build / slide'],
    ['← PgUp', 'previous'],
    ['⇧ + → / ←', 'next / previous slide, skipping builds'],
    ['Home / End', 'first / last slide'],
    ['12 ⏎', 'jump to slide 12'],
    ['F', 'full screen'],
    ['S', 'presenter view (notes, timer, next)'],
    ['O', 'overview'],
    ['B / W', 'black / white screen'],
    ['K / R', 'pause / restart videos'],
    ['H', 'this help'],
  ];

  let helpEl = null;
  const toggleHelp = (force) => {
    if (!helpEl) {
      helpEl = document.createElement('div');
      helpEl.className = 'deck-help';
      helpEl.innerHTML = `<div class="deck-help-card"><h3>Keyboard</h3><dl>${
        HELP.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
      helpEl.addEventListener('click', () => toggleHelp(false));
      document.body.appendChild(helpEl);
    }
    const on = force === undefined ? !helpEl.classList.contains('is-on') : force;
    helpEl.classList.toggle('is-on', on);
  };

  // ---------- Keyboard ----------

  let digits = '';
  let digitTimer = 0;

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  const blank = (cls) => {
    const on = !document.body.classList.contains(cls);
    document.body.classList.remove('is-black', 'is-white');
    if (on) document.body.classList.add(cls);
  };

  // Returns true when the key was a deck command. Shared by the deck and the presenter window.
  const command = (e) => {
    const k = e.key;
    if (/^[0-9]$/.test(k)) {
      digits += k;
      clearTimeout(digitTimer);
      digitTimer = setTimeout(() => { digits = ''; }, 1600);
      return true;
    }
    if (k === 'Enter' && digits) {
      const n = parseInt(digits, 10);
      digits = '';
      if (overview) setOverview(false);
      jump(n - 1);
      return true;
    }
    if (document.body.classList.contains('is-black') || document.body.classList.contains('is-white')) {
      if (!['b', 'B', '.', 'w', 'W', ','].includes(k)) {
        document.body.classList.remove('is-black', 'is-white');
        return true;
      }
    }
    switch (k) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'n': case 'N':
        if (e.shiftKey && (k === 'ArrowRight' || k === 'ArrowDown')) nextSlide(); else next();
        return true;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': case 'p': case 'P':
        if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowUp')) prevSlide(); else prev();
        return true;
      case 'Home': show(0, 0); return true;
      case 'End': show(slides.length - 1, 0); return true;
      default: return false;
    }
  };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key;
    if (command(e)) { e.preventDefault(); return; }
    switch (k) {
      case 'f': case 'F': case 'F5': fullscreen(); break;
      case 'o': case 'O': setOverview(!overview); break;
      case 'Escape': if (overview) setOverview(false); toggleHelp(false); break;
      case 's': case 'S': openPresenter(); break;
      case 'b': case 'B': case '.': blank('is-black'); break;
      case 'w': case 'W': case ',': blank('is-white'); break;
      case 'k': case 'K': toggleMedia(); break;
      case 'r': case 'R': restartMedia(); break;
      case 'h': case 'H': case '?': toggleHelp(); break;
      default: return;
    }
    e.preventDefault();
  };

  // ---------- Presenter link ----------

  const broadcast = (msg) => {
    const data = { ns: NS, ...msg };
    if (presenterWin && !presenterWin.closed) {
      try { presenterWin.postMessage(data, '*'); } catch (e) { /* closed */ }
    }
    if (channel) { try { channel.postMessage(data); } catch (e) { /* ignore */ } }
  };

  const openPresenter = () => {
    if (presenterWin && !presenterWin.closed) { presenterWin.focus(); return; }
    const url = `${location.pathname}?presenter${location.hash}`;
    presenterWin = window.open(url, 'wm-presenter', 'popup,width=1440,height=900');
    if (!presenterWin) toast('Allow pop-ups for this page to open the presenter view.');
  };

  const seenCmds = new Set(); // command ids from the presenter (it may deliver one twice)

  const onDeckMessage = (data) => {
    if (!data || data.ns !== NS) return;
    if (data.id) {
      if (seenCmds.has(data.id)) return;
      seenCmds.add(data.id);
      if (seenCmds.size > 64) seenCmds.delete(seenCmds.values().next().value);
    }
    if (data.type === 'hello') broadcast({ type: 'state', index, step });
    else if (data.type === 'cmd') {
      if (data.cmd === 'next') next();
      else if (data.cmd === 'prev') prev();
      else if (data.cmd === 'nextSlide') nextSlide();
      else if (data.cmd === 'prevSlide') prevSlide();
      else if (data.cmd === 'go') { if (data.jump) jump(data.index); else show(data.index, data.step || 0); }
      else if (data.cmd === 'black') blank('is-black');
      else if (data.cmd === 'media') toggleMedia();
      else if (data.cmd === 'restart') restartMedia();
    }
  };

  // ---------- Presenter view ----------

  const fmt = (sec) => {
    const s = Math.max(0, Math.round(Math.abs(sec)));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const startPresenter = () => {
    document.body.classList.add('is-presenter');
    const base = location.pathname;
    const ui = document.createElement('div');
    ui.className = 'pv';
    ui.innerHTML = `
      <div class="pv-main">
        <div class="pv-frame pv-current"><iframe title="Current slide"></iframe></div>
        <div class="pv-side">
          <div class="pv-label">Next</div>
          <div class="pv-frame pv-next"><iframe title="Next slide"></iframe></div>
          <div class="pv-clocks">
            <div><span class="pv-elapsed">0:00</span><small>elapsed · T resets</small></div>
            <div><span class="pv-pace">on pace</span><small class="pv-budget"></small></div>
            <div><span class="pv-clock"></span><small class="pv-pos"></small></div>
          </div>
        </div>
      </div>
      <div class="pv-notes"><div class="pv-title"></div><div class="pv-text"></div></div>
      <div class="pv-warn" hidden></div>`;
    document.body.appendChild(ui);
    const cur = ui.querySelector('.pv-current iframe');
    const nxt = ui.querySelector('.pv-next iframe');
    cur.src = `${base}?embed#/1`;
    nxt.src = `${base}?embed#/1`;

    const planned = [];
    let acc = 0;
    slides.forEach((s) => { planned.push(acc); acc += parseFloat(s.dataset.time || '0') || 0; });
    const total = acc;

    const TKEY = 'wm-deck-started';
    const readStart = () => { try { return parseInt(sessionStorage.getItem(TKEY) || '', 10) || 0; } catch (e) { return 0; } };
    const saveStart = (t) => { try { sessionStorage.setItem(TKEY, String(t)); } catch (e) { /* private mode */ } };
    let started = readStart() || Date.now();
    saveStart(started);
    let slideStarted = Date.now();
    let lastIndex = -1;
    let notesIndex = -1;

    const fitFrames = () => {
      ui.querySelectorAll('.pv-frame').forEach((frame) => {
        const f = frame.querySelector('iframe');
        const s = frame.clientWidth / W;
        f.style.transform = `scale(${s})`;
        frame.style.height = `${H * s}px`;
      });
    };
    window.addEventListener('resize', fitFrames);
    setTimeout(fitFrames, 0);

    const post = (frame, i, s) => {
      const send = () => {
        try { frame.contentWindow.postMessage({ ns: NS, type: 'goto', index: i, step: s }, '*'); } catch (e) { /* loading */ }
      };
      send();
      if (!frame.dataset.loaded) frame.addEventListener('load', send, { once: true });
    };
    [cur, nxt].forEach((f) => f.addEventListener('load', () => { f.dataset.loaded = '1'; }, { once: true }));

    const render = (i, s) => {
      if (i !== lastIndex) { slideStarted = Date.now(); lastIndex = i; }
      index = i;
      step = s;
      const slide = slides[i];
      post(cur, i, s);
      let ni = i;
      let ns = s + 1;
      if (ns > maxStep(slide)) { ni = i + 1; ns = 0; }
      const endSlide = ni >= slides.length;
      nxt.style.visibility = endSlide ? 'hidden' : 'visible';
      if (!endSlide) post(nxt, ni, ns);
      ui.querySelector('.pv-label').textContent = endSlide ? 'End of deck' : (ni === i ? `Next · build ${ns}` : `Next · slide ${ni + 1}`);
      const notes = slide.querySelector('aside.notes');
      ui.querySelector('.pv-title').textContent = `${i + 1}. ${slide.dataset.title || slide.id}${slide.dataset.time ? ` · ${fmt(parseFloat(slide.dataset.time))}` : ''}`;
      const box = ui.querySelector('.pv-notes');
      const txt = ui.querySelector('.pv-text');
      if (i !== notesIndex) { txt.innerHTML = notes ? notes.innerHTML : '<em>No notes.</em>'; box.scrollTop = 0; notesIndex = i; }
      const cues = Array.from(txt.querySelectorAll('em')).filter((e) => e.textContent.trim() === '[click]');
      cues.forEach((c, k) => c.classList.toggle('is-now', k === s - 1));
      if (s === 0 || !cues[s - 1]) box.scrollTop = 0;
      else box.scrollTop += cues[s - 1].getBoundingClientRect().top - box.getBoundingClientRect().top - 40;
      ui.querySelector('.pv-pos').textContent = `slide ${i + 1} / ${slides.length} · build ${s} / ${maxStep(slide)}`;
      history.replaceState(null, '', `#/${i + 1}${s ? `/${s}` : ''}`);
      tick();
    };

    const tick = () => {
      const now = Date.now();
      const el = (now - started) / 1000;
      ui.querySelector('.pv-elapsed').textContent = fmt(el);
      ui.querySelector('.pv-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (index >= 0) {
        const budget = parseFloat(slides[index].dataset.time || '0') || 0;
        const onSlide = (now - slideStarted) / 1000;
        const expected = planned[index] + Math.min(onSlide, budget);
        const delta = el - expected;
        const pace = ui.querySelector('.pv-pace');
        pace.textContent = Math.abs(delta) < 20 ? 'on pace' : `${fmt(delta)} ${delta > 0 ? 'behind' : 'ahead'}`;
        pace.className = `pv-pace ${Math.abs(delta) < 20 ? '' : delta > 0 ? 'is-behind' : 'is-ahead'}`;
        ui.querySelector('.pv-budget').textContent = `this slide ${fmt(onSlide)} of ${fmt(budget)} · talk ${fmt(total)}`;
      }
    };
    setInterval(tick, 1000);

    // One path per command (opener, else the channel), with an id the deck dedupes on.
    let cmdSeq = 0;
    const toDeck = (msg) => {
      cmdSeq += 1;
      const data = { ns: NS, id: `${Date.now().toString(36)}-${cmdSeq}-${Math.random().toString(36).slice(2, 7)}`, ...msg };
      let sent = false;
      if (window.opener && !window.opener.closed) {
        try { window.opener.postMessage(data, '*'); sent = true; } catch (e) { /* ignore */ }
      }
      if (!sent && channel) { try { channel.postMessage(data); } catch (e) { /* ignore */ } }
    };

    const onMsg = (data) => {
      if (!data || data.ns !== NS || data.type !== 'state') return;
      render(data.index, data.step);
    };
    window.addEventListener('message', (e) => onMsg(e.data));
    if (channel) channel.onmessage = (e) => onMsg(e.data);

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      let cmd = null;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'n', 'N'].includes(k)) cmd = e.shiftKey && k.startsWith('Arrow') ? 'nextSlide' : 'next';
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) cmd = e.shiftKey && k.startsWith('Arrow') ? 'prevSlide' : 'prev';
      else if (k === 'Home') { toDeck({ type: 'cmd', cmd: 'go', index: 0, step: 0 }); e.preventDefault(); return; }
      else if (k === 'End') { toDeck({ type: 'cmd', cmd: 'go', index: slides.length - 1, step: 0 }); e.preventDefault(); return; }
      else if (k === 't' || k === 'T') { started = Date.now(); saveStart(started); slideStarted = Date.now(); tick(); e.preventDefault(); return; }
      else if (k === 'b' || k === 'B' || k === '.') cmd = 'black';
      else if (k === 'k' || k === 'K') cmd = 'media';
      else if (k === 'r' || k === 'R') cmd = 'restart';
      else if (/^[0-9]$/.test(k)) {
        digits += k;
        clearTimeout(digitTimer);
        digitTimer = setTimeout(() => { digits = ''; }, 1600);
      } else if (k === 'Enter' && digits) {
        toDeck({ type: 'cmd', cmd: 'go', index: parseInt(digits, 10) - 1, step: 0, jump: true });
        digits = '';
      }
      if (cmd) { toDeck({ type: 'cmd', cmd }); e.preventDefault(); }
    });

    const h = parseHash();
    render(h ? clamp(h.index, 0, slides.length - 1) : 0, h ? h.step : 0);
    toDeck({ type: 'hello' });
    if (document.querySelector('video[data-av1], source[type*="av01"]') && !canPlayAV1()) {
      const warn = ui.querySelector('.pv-warn');
      warn.hidden = false;
      warn.textContent = 'This browser cannot decode the AV1 demo videos. Present from Google Chrome.';
    }
  };

  // ---------- Start ----------

  const start = () => {
    stage = document.querySelector('.deck-stage');
    if (!stage) return;
    slides = Array.from(stage.querySelectorAll(':scope > section.slide'));
    slides.forEach((s, i) => {
      if (!s.id) s.id = `slide-${i + 1}`;
    });
    document.documentElement.classList.add(`mode-${MODE}`);
    if (STATIC) document.documentElement.classList.add('is-static');
    if ('BroadcastChannel' in window) {
      try { channel = new BroadcastChannel(NS); } catch (e) { channel = null; }
    }

    if (MODE === 'presenter') {
      readyFns.forEach((fn) => fn());
      startPresenter();
      return;
    }

    if (MODE === 'print') {
      slides.forEach((slide, i) => {
        slide.insertAdjacentHTML('beforeend', `<div class="print-num">${i + 1}</div>`);
        ensureInit(slide);
        const last = maxStep(slide);
        applyBuilds(slide, last);
        slide.classList.add('is-current');
        callHandler(slide, 'update', last, { prev: -1, entering: true, dir: 1, animate: false, mode: 'print' });
      });
      readyFns.forEach((fn) => fn());
      return;
    }

    buildChrome();
    fit();
    window.addEventListener('resize', fit);

    if (MODE === 'deck') {
      document.addEventListener('keydown', onKey);
      window.addEventListener('message', (e) => onDeckMessage(e.data));
      if (channel) channel.onmessage = (e) => onDeckMessage(e.data);
      window.addEventListener('hashchange', () => {
        const h = parseHash();
        if (h && (h.index !== index || h.step !== step)) show(h.index, h.step, { instant: true });
      });
      stage.addEventListener('click', (e) => {
        if (!overview) return;
        const slide = e.target.closest('section.slide');
        if (!slide) return;
        const i = slides.indexOf(slide);
        overview = false;
        document.body.classList.remove('is-overview');
        slides.forEach((s, k) => { s.style.transform = ''; if (k !== i) callHandler(s, 'leave'); });
        index = -1;
        jump(i);
      });
      // Swipe on touch screens.
      let tx = null;
      stage.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
      stage.addEventListener('touchend', (e) => {
        if (tx === null) return;
        const dx = e.changedTouches[0].clientX - tx;
        if (Math.abs(dx) > 50) { if (dx < 0) next(); else prev(); }
        tx = null;
      });
      // Hide the cursor while presenting.
      let idle = 0;
      const wake = () => {
        document.body.classList.remove('is-idle');
        clearTimeout(idle);
        idle = setTimeout(() => document.body.classList.add('is-idle'), 2500);
      };
      document.addEventListener('mousemove', wake);
      wake();
      if (REDUCED && !STATIC) {
        toast('System “Reduce motion” is on; animations still play. Add <b>?static</b> for a still deck.', 6000);
      }
      if (document.querySelector('video[data-av1], source[type*="av01"]') && !canPlayAV1()) {
        toast('This browser cannot decode the AV1 demo videos. <b>Present from Google Chrome.</b>', 9000);
      }
    }

    if (MODE === 'embed') {
      document.documentElement.classList.add('is-static');
      window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || d.ns !== NS || d.type !== 'goto') return;
        show(d.index, d.step, { instant: true, force: true });
      });
    }

    const h = parseHash();
    readyFns.forEach((fn) => fn());
    show(h ? h.index : 0, h ? h.step : 0, { instant: true, force: true });
    document.documentElement.classList.add('is-ready');
  };

  window.Deck = {
    W,
    H,
    mode: MODE,
    isStatic: STATIC,
    register(id, handler) { registry.set(id, handler); },
    onReady(fn) { readyFns.push(fn); },
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    go: (i, s = 0) => show(i, s),
    next,
    prev,
    maxStep,
    get index() { return index; },
    get step() { return step; },
    get slides() { return slides; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else setTimeout(start, 0);
})();
