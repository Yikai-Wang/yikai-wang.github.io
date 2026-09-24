(() => {
  'use strict';

  const DATA = window.SHOWCASE_DATA || {};
  const METHODS = (DATA.methods || []).filter((m) => m && m.id);
  // Methods flagged `alt` are a second encoding of the same clips: selectable, but off by default
  // so the page opens on the comparison it is actually about.
  const PRIMARY = METHODS.filter((m) => !m.alt);
  const BY_SETTING = DATA.settings || {};
  const SETTINGS = Object.keys(BY_SETTING).filter((s) => (BY_SETTING[s] || []).length);
  const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
  const FPS = 16; // every clip is 16 fps
  const MAX_MAGNIFY = 8;
  const MAGNIFY_STEP = 1.5;
  const PAN_STEP = 0.1; // Shift+arrow pans by this fraction of the visible window
  const PAN_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const DEFAULT_AR = 832 / 480;
  const MIN_PANEL = 48; // smallest zoom panel width, for windows too short to fit a real layout
  const JUMP_PROMPT = 72; // characters of the prompt shown in the jump list
  // The clips are 10-bit AV1, which Safari only decodes on recent hardware. Rather than leave a
  // reader staring at three black rectangles, say what is wrong and what to open the page in.
  const AV1_HINT = 'These clips are encoded as AV1 — please open this page in a browser with AV1 '
    + 'support, such as Chrome.';
  const canPlayAV1 = (() => {
    try {
      return document.createElement('video').canPlayType('video/mp4; codecs="av01.0.05M.10"') !== '';
    } catch (_) {
      return true; // no answer is not an answer; only complain when a video actually fails
    }
  })();
  // The VAE gives the first frame its own latent and packs every later four into one, so latent k
  // covers frames 4k-3..4k. Anchors sit on every tenth latent, starting at the image latent.
  const ANCHOR_STRIDE = 10;
  const latentFrames = (k) => (k === 0 ? [0, 0] : [4 * k - 3, 4 * k]);
  // One method leads, the others follow it. Below SOFT_SYNC (under a frame) they are left alone;
  // past it the playback rate nudges them back; past HARD_SYNC only a seek can still catch up.
  // Just over one frame: some browsers report currentTime quantised to the displayed frame, so a
  // tighter band would have the correction chasing frame boundaries instead of real drift.
  const SOFT_SYNC = 1.2 / 16;
  const HARD_SYNC = 0.35;
  const NUDGE = 0.12;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const pad2 = (n) => String(n).padStart(2, '0');
  const lengthLabel = (setting) => setting;
  const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
  // Remembers whether a control was last operated by pointer or keyboard, so a 'change' handler can
  // hand the keys back to the shortcuts after a mouse pick but keep focus for keyboard users.
  const pointerOperated = (el) => {
    let pointer = false;
    el.addEventListener('pointerdown', () => { pointer = true; });
    el.addEventListener('keydown', () => { pointer = false; });
    return () => pointer;
  };

  const videoGrid = $('[data-video-grid]');
  const errorNote = $('[data-video-error]');
  const jump = $('[data-jump]');
  const promptWrap = $('[data-prompt-wrap]');
  const promptToggle = $('.prompt-toggle', promptWrap);
  const promptText = $('.sample-prompt', promptWrap);
  const methodsRoot = $('[data-methods]');
  const methodsOptions = $('.methods-options', methodsRoot);
  const zoomDialog = $('[data-zoom]');
  const zoomShell = $('.zoom-shell', zoomDialog);
  const zoomGrid = $('[data-zoom-grid]');
  const zoomPrompt = $('.zoom-prompt', zoomGrid);
  const magnifyValue = $('[data-magnify-value]');
  const shortcutToggle = $('[data-shortcuts]');
  const anchorToggle = $('[data-anchors]');
  const canZoom = typeof zoomDialog.showModal === 'function';

  if (!SETTINGS.length || !METHODS.length) {
    $('.viewer').textContent = 'The video list could not be loaded.';
    return;
  }

  const state = {
    setting: SETTINGS[0],
    index: Object.fromEntries(SETTINGS.map((s) => [s, 0])),
    rate: 1,
    userPaused: false,
    scrubbing: false,
    scrubValue: null,
    scrubSource: null,
    shown: new Set((PRIMARY.length ? PRIMARY : METHODS).map((m) => m.id)),
    leadId: METHODS[0].id,
    // Magnification m and the top-left corner (x, y) of the visible window, as fractions of a frame.
    view: { m: 1, x: 0, y: 0 },
  };

  const items = () => BY_SETTING[state.setting];
  const current = () => items()[state.index[state.setting]];

  // ---------- One player per method ----------

  // Every method keeps its own <video>, tile and zoom panel for the whole session; unticking a
  // method hides them and drops its source, so nothing is decoded or downloaded for a hidden method.
  const players = METHODS.map((method) => {
    const tile = document.createElement('figure');
    tile.className = `tile${method.ours ? ' is-ours' : ''}`;
    tile.innerHTML = `
      <figcaption></figcaption>
      <div class="video-frame">
        <video muted playsinline preload="auto"></video>
        <div class="loading-bar" aria-hidden="true"></div>
      </div>`;
    $('figcaption', tile).textContent = method.label;
    const video = $('video', tile);
    video.setAttribute('aria-label', method.label);
    videoGrid.appendChild(tile);

    const panel = document.createElement('figure');
    panel.className = `panel${method.ours ? ' is-ours' : ''}`;
    panel.innerHTML = '<figcaption></figcaption><div class="panel-stage"><canvas></canvas></div>';
    $('figcaption', panel).textContent = method.label;
    $('canvas', panel).setAttribute('aria-label', `${method.label}, enlarged`);
    zoomGrid.insertBefore(panel, zoomPrompt);

    return {
      method,
      video,
      tile,
      frame: $('.video-frame', tile),
      caption: $('figcaption', tile),
      panel,
      panelCaption: $('figcaption', panel),
      stage: $('.panel-stage', panel),
      canvas: $('canvas', panel),
      rateSet: null,
      nudge: 0,
      syncOnLoad: false,
      frameCallbackId: 0,
    };
  });

  const shown = () => players.filter((p) => state.shown.has(p.method.id));
  const loaded = (p) => Boolean(p.video.getAttribute('src'));
  const playable = () => shown().filter((p) => loaded(p) && !p.video.error);
  // The lead sets the clock everything else follows, so a method that failed to load never takes
  // the role: its duration and currentTime would stay at zero and stall the whole transport.
  const lead = () => {
    const list = shown();
    const healthy = list.filter((p) => loaded(p) && !p.video.error);
    const pool = healthy.length ? healthy : list;
    return pool.find((p) => p.method.id === state.leadId) || pool[0] || null;
  };
  const leadTime = () => {
    const p = lead();
    return p && Number.isFinite(p.video.currentTime) ? p.video.currentTime : 0;
  };

  // ---------- Time helpers ----------

  const formatTime = (seconds) => {
    const tenths = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10 + 1e-6);
    const minutes = Math.floor(tenths / 600);
    return `${minutes}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
  };

  // Accepts "12", "12.5", "12,5", "12.5s", "0:12.5", "1:02".
  const parseTime = (text) => {
    const parts = text.trim().toLowerCase().replace(/\s*s$/, '').replace(/,/g, '.').split(':');
    if (!parts.length || parts.length > 3) return NaN;
    if (!parts.every((part) => /^(\d+\.?\d*|\.\d+)$/.test(part.trim()))) return NaN;
    return parts.reduce((total, part) => total * 60 + parseFloat(part), 0);
  };

  function duration() {
    const p = lead();
    const d = p ? p.video.duration : 0;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  // ---------- Anchor positions ----------

  // Every anchor's frame span, in seconds, for the clip that is loaded.
  function anchorSpans() {
    const d = duration();
    if (!d) return [];
    const frames = Math.round(d * FPS);
    const latents = Math.max(1, Math.round((frames - 1) / 4) + 1);
    const spans = [];
    for (let k = 0; k < latents; k += ANCHOR_STRIDE) {
      const [first, last] = latentFrames(k);
      spans.push({ k, from: first / FPS, to: (last + 1) / FPS, mid: (first + 0.5) / FPS });
    }
    return spans;
  }

  let spansCache = { key: null, list: [] };
  function anchors() {
    const key = `${duration()}`;
    if (spansCache.key !== key) spansCache = { key, list: anchorSpans() };
    return spansCache.list;
  }

  const onAnchor = (time) => anchors().some((a) => time >= a.from && time < a.to);

  function jumpAnchor(delta) {
    const list = anchors();
    if (!list.length) return;
    const now = pendingSeek ?? leadTime();
    const current = list.findIndex((a) => now >= a.from && now < a.to);
    let index;
    if (current >= 0) index = clamp(current + delta, 0, list.length - 1);
    else if (delta > 0) index = list.findIndex((a) => a.from > now);
    else {
      index = -1;
      list.forEach((a, i) => { if (a.to <= now) index = i; });
    }
    if (index < 0 || index >= list.length) return;
    setPaused(true);
    requestSeek(list[index].mid);
  }

  // ---------- Seeking ----------

  // Clips have ~15 s between keyframes, so each seek may decode many frames. While one seek is in
  // flight, later requests collapse into a single pending target instead of queueing up.
  let pendingSeek = null;
  let seekTarget = null; // target of the seek in flight
  const anySeeking = () => shown().some((p) => p.video.seeking);

  function seekTo(target) {
    pendingSeek = null;
    seekTarget = target;
    shown().forEach((p) => {
      if (loaded(p)) p.video.currentTime = target;
    });
  }

  function requestSeek(time) {
    const d = duration();
    if (!d || !Number.isFinite(time)) return;
    const target = clamp(time, 0, d - 0.001);
    if (anySeeking()) {
      // A repeat of the in-flight target (a slider's 'change' after its 'input') needs no second seek.
      pendingSeek = target === seekTarget ? null : target;
      return;
    }
    // Nor does one that has already landed (a slider released after its last 'input' seek finished).
    if (target === seekTarget && Math.abs(leadTime() - target) < 0.5 / FPS) return;
    seekTo(target);
  }

  function stepFrame(delta) {
    const d = duration();
    if (!d) return;
    setPaused(true);
    const base = pendingSeek ?? leadTime();
    const lastFrame = Math.max(0, Math.ceil(d * FPS - 1e-3) - 1);
    const target = clamp(Math.floor(base * FPS + 1e-3) + delta, 0, lastFrame);
    // Aim at the middle of the frame so rounding never lands on its neighbour.
    requestSeek((target + 0.5) / FPS);
  }

  // ---------- Playback ----------

  // The methods only stay in step if they start together, so playback waits for the slowest one:
  // while any of them is seeking or short of buffered data, all of them stay paused.
  const wantPlay = () => !state.userPaused && !state.scrubbing && !document.hidden;
  // A video that has ended is counted as ready and never restarted: play() on an ended element
  // rewinds it to the start, which would flash frame 0 in the tiles that end a frame early.
  const groupReady = () => {
    const list = playable();
    return list.length > 0 && list.every((p) => p.video.ended || p.video.readyState >= 3);
  };

  function playGroup() {
    playable().forEach((p) => {
      if (!p.video.paused || p.video.ended) return;
      const promise = p.video.play();
      if (promise) {
        promise.catch((error) => {
          if (error && error.name === 'NotAllowedError') {
            state.userPaused = true;
            syncPauseButtons();
          }
        });
      }
    });
  }

  function pauseGroup() {
    players.forEach((p) => {
      if (!p.video.paused) p.video.pause();
    });
  }

  function syncPlayback() {
    if (wantPlay() && !anySeeking() && groupReady()) playGroup();
    else pauseGroup();
  }

  // Keeps the followers on the lead's clock: a small lag is corrected by running a little faster or
  // slower, a large one (a stall, a dropped tab) only by seeking.
  function correctDrift() {
    const master = lead();
    if (!master) return;
    const time = master.video.currentTime;
    const running = !master.video.paused && !anySeeking();
    shown().forEach((p) => {
      const follows = p !== master && running &&
        !p.video.paused && !p.video.seeking && p.video.readyState >= 3;
      if (!follows) {
        p.nudge = 0;
      } else {
        const error = time - p.video.currentTime;
        if (Math.abs(error) > HARD_SYNC) {
          // Too far apart to catch up by speed alone: hold everyone, jump, and restart together.
          p.nudge = 0;
          pauseGroup();
          p.video.currentTime = time;
        } else if (Math.abs(error) > SOFT_SYNC) {
          p.nudge = Math.sign(error);
        } else if (Math.abs(error) < SOFT_SYNC * 0.4) {
          p.nudge = 0; // close enough; the band keeps it from flapping
        }
      }
      // Rewriting playbackRate every frame upsets the media clock badly enough that the video
      // stops gaining on the others, so the correction only ever takes these three values.
      const rate = state.rate * (1 + p.nudge * NUDGE);
      if (p.rateSet !== rate) {
        p.video.playbackRate = rate;
        p.rateSet = rate;
      }
    });
  }

  function setPaused(paused) {
    state.userPaused = paused;
    syncPlayback();
    syncPauseButtons();
  }

  const togglePause = () => setPaused(!state.userPaused);

  function restart() {
    pendingSeek = null;
    if (duration()) seekTo(0);
    setPaused(false);
  }

  function syncPauseButtons() {
    $$('[data-action="pause"]').forEach((button) => {
      button.textContent = state.userPaused ? 'Play' : 'Pause';
      button.classList.toggle('is-paused', state.userPaused);
    });
  }

  function setRate(rate) {
    state.rate = rate;
    players.forEach((p) => {
      p.video.defaultPlaybackRate = rate;
      p.video.playbackRate = rate;
      p.rateSet = rate;
    });
    $$('[data-rate]').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.rate) === rate));
    });
  }

  // ---------- Per-video wiring ----------

  players.forEach((p) => {
    const { video } = p;

    ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting',
      'seeking', 'seeked', 'pause', 'play', 'stalled', 'emptied', 'error'].forEach((type) => {
      video.addEventListener(type, () => updateLoading(p));
    });
    ['timeupdate', 'durationchange', 'seeking', 'seeked', 'emptied'].forEach((type) => {
      video.addEventListener(type, updateTransports);
    });

    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) {
        videoGrid.style.setProperty('--video-ar', String(video.videoWidth / video.videoHeight));
      }
      video.defaultPlaybackRate = state.rate;
      video.playbackRate = state.rate;
      p.rateSet = state.rate;
      if (p.syncOnLoad) {
        p.syncOnLoad = false;
        const master = lead();
        // A method ticked back on joins the others where they already are. They are stopped first,
        // otherwise they run on during the seek and the newcomer arrives that much behind.
        if (master && master !== p && duration()) {
          pauseGroup();
          video.currentTime = master.video.currentTime;
        }
      }
      layoutZoom();
    });

    video.addEventListener('loadeddata', () => requestDraw(p));
    video.addEventListener('seeked', () => {
      if (!anySeeking() && pendingSeek !== null) seekTo(pendingSeek);
      requestDraw(p);
      // 'seeked' can land before the new frame is presentable — AV1 in particular — so the panel
      // is drawn again on the frame callback, which only fires once the frame really exists.
      if (hasFrameCallback && zoomDialog.open) video.requestVideoFrameCallback(() => drawPanel(p));
    });
    // Looping is done by hand: the native loop restarts each file on its own clock, which would
    // leave the methods seconds apart after the first wrap.
    video.addEventListener('ended', () => {
      if (p !== lead() || !duration()) return;
      seekTo(0);
      syncPlayback();
    });
    video.addEventListener('error', updateError);
    video.addEventListener('click', togglePause);
  });

  function updateLoading(p) {
    const busy = loaded(p) && !p.video.error &&
      (p.video.seeking || p.video.readyState < 2 || (wantPlay() && p.video.readyState < 3));
    p.frame.classList.toggle('is-loading', busy);
  }

  function updateAnchorState() {
    const on = anchorToggle.checked && onAnchor(pendingSeek ?? leadTime());
    document.body.classList.toggle('show-anchors', anchorToggle.checked);
    videoGrid.classList.toggle('is-anchor', on);
  }

  function updateError() {
    const broken = shown().filter((p) => loaded(p) && p.video.error);
    errorNote.hidden = !broken.length && canPlayAV1;
    errorNote.textContent = broken.length
      ? `These videos could not be loaded: ${broken.map((p) => p.method.label).join(', ')}. ${AV1_HINT}`
      : (canPlayAV1 ? '' : AV1_HINT);
    // The note sits behind the zoom dialog, so the caption has to carry the reason for a black panel.
    players.forEach((p) => {
      const text = broken.includes(p) ? `${p.method.label} — not available` : p.method.label;
      if (p.caption.textContent !== text) {
        p.caption.textContent = text;
        p.panelCaption.textContent = text;
      }
    });
  }

  // ---------- Method picker ----------

  const methodBoxes = METHODS.map((method, i) => {
    if (method.alt && !METHODS[i - 1].alt) {
      methodsOptions.appendChild(document.createElement('span')).className = 'methods-sep';
    }
    const label = document.createElement('label');
    label.className = `method-chip${method.ours ? ' is-ours' : ''}${method.alt ? ' is-alt' : ''}`;
    label.innerHTML = '<input type="checkbox" autocomplete="off" checked><span></span>';
    const box = $('input', label);
    box.dataset.method = method.id;
    $('span', label).textContent = method.label;
    box.addEventListener('change', () => {
      if (!box.checked && state.shown.size <= 1) {
        // Something has to stay on screen.
        box.checked = true;
        return;
      }
      if (box.checked) state.shown.add(method.id);
      else state.shown.delete(method.id);
      applyMethods();
    });
    methodsOptions.appendChild(label);
    return box;
  });

  function applyMethods() {
    const item = current();
    const master = lead();
    if (master) state.leadId = master.method.id;
    players.forEach((p) => {
      const on = state.shown.has(p.method.id);
      p.tile.hidden = !on;
      p.panel.hidden = !on;
      if (on) load(p, item, { sync: true });
      else unload(p);
    });
    methodBoxes.forEach((box) => {
      box.checked = state.shown.has(box.dataset.method);
      box.parentElement.classList.toggle('is-on', box.checked);
    });
    videoGrid.style.setProperty('--tiles', String(state.shown.size));
    // Dropping the source of a video that was still seeking clears its 'seeking' flag without a
    // 'seeked' event, so a queued target would otherwise sit there and freeze the clock readout.
    if (pendingSeek !== null && !anySeeking()) seekTo(pendingSeek);
    updateError();
    syncPlayback();
    if (zoomDialog.open) {
      stopDrawing();
      layoutZoom();
      startDrawing();
    }
  }

  function load(p, item, { sync = false } = {}) {
    const file = item.videos[p.method.id];
    if (!file) {
      unload(p);
      return;
    }
    if (p.video.dataset.file === file) return;
    p.video.dataset.file = file;
    p.syncOnLoad = sync;
    p.rateSet = null;
    p.video.src = encodePath(file);
  }

  function unload(p) {
    if (!loaded(p)) return;
    p.video.pause();
    p.video.removeAttribute('src');
    delete p.video.dataset.file;
    p.video.load(); // drops the buffered data instead of leaving it in memory
    clearCanvas(p);
  }

  // ---------- Transport bars (main card and zoom view) ----------

  const transports = $$('[data-transport]').map((root) => {
    root.innerHTML = `
      <label class="time" title="Type a time such as 12.5 or 0:12.5, then press Enter">
        <input class="time-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="0:00.0" aria-label="Current time. Type a time and press Enter to jump there">
        <span class="time-total">/ 0:00.0</span>
      </label>
      <span class="sr-only" role="status" data-time-status></span>
      <span class="seek-wrap">
        <input class="seek" type="range" min="0" max="1" step="${1 / FPS}" value="0" aria-label="Seek">
        <span class="anchor-ticks" data-ticks aria-hidden="true"></span>
      </span>
      <div class="segmented speed" role="group" aria-label="Playback speed">
        <span class="segmented-label">Speed</span>
        <div class="segmented-options">
          ${SPEEDS.map((rate) => `<button type="button" data-rate="${rate}" aria-pressed="${rate === 1}">${rate}×</button>`).join('')}
        </div>
      </div>`;

    const transport = {
      input: $('.time-input', root),
      total: $('.time-total', root),
      status: $('[data-time-status]', root),
      seek: $('.seek', root),
      ticks: $('[data-ticks]', root),
      shownTicks: null,
      editing: false,
      pointerScrub: false,
      focusText: '',
      shownText: null,
      shownTotal: null,
      shownSeek: null,
      shownMax: null,
    };

    const { input, seek } = transport;

    input.addEventListener('focus', () => {
      transport.editing = true;
      transport.focusText = input.value;
      // Deferred so a click's mouseup does not undo it; skipped if focus already moved on, because
      // select() on an unfocused input focuses it again in WebKit.
      requestAnimationFrame(() => {
        if (document.activeElement === input) input.select();
      });
    });
    input.addEventListener('blur', () => {
      if (transport.editing) commitTime(transport, false);
    });
    input.addEventListener('input', () => markTimeInvalid(transport, false));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTime(transport, true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        endTimeEdit(transport);
        input.blur();
      }
    });

    seek.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.ctrlKey) return;
      transport.pointerScrub = true;
      beginScrub(transport);
    });
    seek.addEventListener('input', () => {
      beginScrub(transport);
      state.scrubValue = Number(seek.value);
      requestSeek(state.scrubValue);
    });
    seek.addEventListener('change', () => {
      requestSeek(Number(seek.value));
      endScrub();
    });

    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-rate]');
      if (button) setRate(Number(button.dataset.rate));
    });

    return transport;
  });

  function markTimeInvalid(transport, invalid) {
    transport.input.classList.toggle('is-invalid', invalid);
    if (invalid) transport.input.setAttribute('aria-invalid', 'true');
    else transport.input.removeAttribute('aria-invalid');
    transport.status.textContent = invalid ? 'Not a valid time. Enter a time such as 12.5 or 0:12.5.' : '';
  }

  function endTimeEdit(transport) {
    transport.editing = false;
    transport.shownText = null;
    markTimeInvalid(transport, false);
  }

  function commitTime(transport, fromEnter) {
    const { input } = transport;
    const value = parseTime(input.value);
    if (!Number.isFinite(value)) {
      if (fromEnter) {
        markTimeInvalid(transport, true);
        return; // keep focus so the entry can be corrected
      }
      endTimeEdit(transport);
      return;
    }
    if (!duration()) {
      // Nothing is loaded to seek in yet; the box goes back to showing the current time.
      endTimeEdit(transport);
      if (fromEnter) input.blur();
      return;
    }
    const changed = input.value !== transport.focusText;
    endTimeEdit(transport);
    if (fromEnter || changed) requestSeek(value);
    if (fromEnter) input.blur();
  }

  function beginScrub(transport) {
    if (state.scrubbing) return;
    state.scrubbing = true;
    state.scrubSource = transport;
    pauseGroup();
  }

  function endScrub() {
    if (!state.scrubbing) return;
    state.scrubbing = false;
    state.scrubValue = null;
    state.scrubSource = null;
    syncPlayback();
  }

  function endPointerScrub() {
    transports.forEach((transport) => {
      if (!transport.pointerScrub) return;
      transport.pointerScrub = false;
      // After a mouse scrub, hand ←/→ back to sample switching.
      if (document.activeElement === transport.seek) transport.seek.blur();
    });
    endScrub();
  }

  window.addEventListener('pointerup', endPointerScrub);
  window.addEventListener('pointercancel', endPointerScrub);
  window.addEventListener('contextmenu', endPointerScrub);

  function updateTransports() {
    const d = duration();
    const raw = state.scrubbing && state.scrubValue !== null ? state.scrubValue : (pendingSeek ?? leadTime());
    const time = d ? Math.min(raw, d) : 0;
    const text = formatTime(time);
    const total = `/ ${formatTime(d)}`;
    const max = d || 1;

    transports.forEach((transport) => {
      const { input, seek } = transport;
      // Focus events can arrive late (e.g. while the window is inactive); trust the actual focus.
      if (transport.editing && document.activeElement !== input) endTimeEdit(transport);
      if (transport.shownMax !== max) {
        seek.max = String(max);
        transport.shownMax = max;
        transport.shownSeek = null;
      }
      if (!transport.editing && transport.shownText !== text) {
        input.value = text;
        transport.shownText = text;
        seek.setAttribute('aria-valuetext', `${text} of ${formatTime(d)}`);
      }
      if (transport.shownTotal !== total) {
        transport.total.textContent = total;
        transport.shownTotal = total;
      }
      if (transport !== state.scrubSource && transport.shownSeek !== time) {
        seek.value = String(time);
        transport.shownSeek = time;
      }
      const ticks = anchorToggle.checked && d ? `${d}` : '';
      if (transport.shownTicks !== ticks) {
        transport.shownTicks = ticks;
        transport.ticks.replaceChildren(...(ticks ? anchors().map((a) => {
          const mark = document.createElement('i');
          mark.style.left = `${(a.mid / d) * 100}%`;
          return mark;
        }) : []));
      }
    });
  }

  // ---------- Sample selection ----------

  const tabsRoot = $('[data-tabs]');
  SETTINGS.forEach((setting) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.setting = setting;
    button.setAttribute('aria-pressed', 'false');
    button.title = `${lengthLabel(setting)} videos (${SETTINGS.indexOf(setting) + 1})`;
    button.setAttribute('aria-label', `${lengthLabel(setting)} videos, ${BY_SETTING[setting].length} samples`);
    button.textContent = lengthLabel(setting);
    button.addEventListener('click', () => show(setting, state.index[setting]));
    tabsRoot.appendChild(button);
  });

  // Windows browsers fire 'change' on every arrow press in a closed select, so only a mouse pick
  // gives the keys back to the shortcuts; keyboard browsing keeps focus in the list.
  const jumpByPointer = pointerOperated(jump);
  jump.addEventListener('change', () => {
    show(state.setting, Number(jump.value));
    if (jumpByPointer()) jump.blur();
  });

  function show(setting, index, { updateHash = true } = {}) {
    const list = BY_SETTING[setting];
    const wrapped = ((index % list.length) + list.length) % list.length;
    state.setting = setting;
    state.index[setting] = wrapped;
    const item = list[wrapped];

    if (videoGrid.dataset.sample !== `${setting}/${item.id}`) {
      videoGrid.dataset.sample = `${setting}/${item.id}`;
      pendingSeek = null;
      seekTarget = null;
      state.userPaused = false;
      // Every method restarts from the beginning, so none of them has to catch up to the others.
      shown().forEach((p) => load(p, item));
      players.filter((p) => !state.shown.has(p.method.id)).forEach(unload);
      syncPauseButtons();
      clearCanvases();
      resetView();
      updateError();
      syncPlayback();
    }

    renderMeta(item, wrapped, list.length);
    if (updateHash) {
      try {
        history.replaceState(null, '', `#${setting}/${item.id}`);
      } catch (_) {
        // Some browsers refuse history updates on file:// pages; the hash is only a convenience.
      }
    }
  }

  const step = (delta) => show(state.setting, state.index[state.setting] + delta);

  function renderMeta(item, index, total) {
    const counter = `${pad2(index + 1)} / ${pad2(total)}`;
    const sample = `Sample ${item.id}`;
    $$('[data-counter]').forEach((el) => { el.textContent = counter; });
    $('[data-sample-title]').textContent = sample;
    $('[data-sample-length]').textContent = lengthLabel(state.setting);
    $$('[data-sample-prompt]').forEach((el) => { el.textContent = item.prompt; });
    $('[data-zoom-sample]').textContent = `${lengthLabel(state.setting)} · ${sample} · ${counter}`;
    zoomDialog.setAttribute('aria-label', `Enlarged comparison, ${lengthLabel(state.setting)} ${sample}`);
    zoomPrompt.scrollTop = 0;
    measurePrompt();

    $$('button', tabsRoot).forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.setting === state.setting));
    });

    if (jump.dataset.setting !== state.setting) {
      jump.replaceChildren(...items().map((it, i) => new Option(`${it.id} · ${shorten(it.prompt)}`, String(i))));
      jump.dataset.setting = state.setting;
    }
    jump.value = String(index);
  }

  const shorten = (text) => (text.length > JUMP_PROMPT ? `${text.slice(0, JUMP_PROMPT - 1).trimEnd()}…` : text);

  // The prompts run to several hundred characters, so the card shows the first lines and opens on
  // request; the button only appears when there is more to see.
  function measurePrompt() {
    promptToggle.hidden = true;
    requestAnimationFrame(() => {
      const clamped = !promptWrap.classList.contains('is-open');
      promptToggle.hidden = clamped && promptText.scrollHeight <= promptText.clientHeight + 1;
    });
  }

  function togglePrompt() {
    const open = !promptWrap.classList.contains('is-open');
    promptWrap.classList.toggle('is-open', open);
    promptToggle.textContent = open ? 'Show less' : 'Show full prompt';
    promptToggle.setAttribute('aria-expanded', String(open));
  }

  function fromHash() {
    let hash = location.hash;
    try { hash = decodeURIComponent(hash); } catch (_) { /* keep raw */ }
    const match = /^#?(\d+s)(?:\/(\d+))?$/.exec(hash);
    if (!match || !BY_SETTING[match[1]] || !BY_SETTING[match[1]].length) return null;
    const list = BY_SETTING[match[1]];
    let index = state.index[match[1]];
    if (match[2]) {
      const found = list.findIndex((it) => Number(it.id) === Number(match[2]));
      index = found >= 0 ? found : 0;
    }
    return [match[1], index];
  }

  window.addEventListener('hashchange', () => {
    const target = fromHash();
    if (target) show(target[0], target[1], { updateHash: false });
  });

  // ---------- Zoom view ----------

  function openZoom() {
    if (!canZoom || zoomDialog.open) return;
    zoomDialog.showModal();
    document.body.classList.add('has-zoom');
    zoomShell.focus({ preventScroll: true });
    layoutZoom();
    startDrawing();
  }

  let closedByPointer = false;

  function closeZoom(event) {
    if (!zoomDialog.open) return;
    closedByPointer = Boolean(event && event.detail > 0);
    zoomDialog.close();
  }

  zoomDialog.addEventListener('close', () => {
    document.body.classList.remove('has-zoom');
    stopDrawing();
    // The dialog hands focus back to the button that opened it; after a mouse close, drop it so
    // Space pauses instead of reopening the zoom.
    if (closedByPointer && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    closedByPointer = false;
  });

  function panelAspect() {
    const p = shown().find((q) => q.video.videoWidth && q.video.videoHeight);
    return p ? p.video.videoWidth / p.video.videoHeight : DEFAULT_AR;
  }

  // Tries every arrangement of the visible panels — with the prompt in a spare cell or in a band
  // below them — and keeps whichever one leaves each panel the widest.
  function layoutZoom() {
    if (!zoomDialog.open) return;
    const n = shown().length;
    const width = zoomGrid.clientWidth;
    const height = zoomGrid.clientHeight;
    if (!n || !width || !height) return;

    const ar = panelAspect();
    const gap = 8;
    const padX = 10; // figure padding + border
    const padY = 29; // caption + padding + border
    const bandH = clamp(height * 0.16, 72, 130);
    const fit = (cols, rows, availH) => {
      const byWidth = (width - gap * (cols - 1)) / cols - padX;
      const byHeight = ((availH - gap * (rows - 1)) / rows - padY) * ar;
      return Math.floor(Math.min(byWidth, byHeight));
    };

    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = fit(cols, rows, height - bandH - gap);
      if (!best || w > best.w) best = { w, cols, rows, mode: 'band' };
    }
    for (let cols = 2; cols <= n + 1; cols++) {
      const rows = Math.ceil((n + 1) / cols);
      const w = fit(cols, rows, height);
      // A prompt cell is only worth it while the text still has room to breathe.
      if (w > best.w && w / ar + padY >= 96) best = { w, cols, rows, mode: 'cell' };
    }
    // In a window too short for any arrangement, still lay out the smallest sensible panels:
    // bailing out here would leave the columns from the last, much larger, layout in place.
    best.w = Math.max(best.w, MIN_PANEL);

    const panelH = best.w / ar + padY;
    zoomGrid.dataset.prompt = best.mode;
    zoomGrid.style.setProperty('--cols', String(best.cols));
    zoomGrid.style.setProperty('--panel-ar', String(ar));
    zoomGrid.style.setProperty('--panel-w', `${best.w + padX}px`);
    // In the band layouts, let the prompt use whatever height the panels leave over.
    const promptBox = best.mode === 'cell'
      ? panelH
      : Math.max(bandH, Math.floor(height - best.rows * (panelH + gap)) - 2);
    zoomGrid.style.setProperty('--prompt-h', `${Math.floor(promptBox)}px`);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    shown().forEach((p) => {
      p.canvas.width = Math.round(best.w * dpr);
      p.canvas.height = Math.round((best.w / ar) * dpr);
    });
    draw();
  }

  let layoutFrame = 0;
  window.addEventListener('resize', () => {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      layoutZoom();
    });
  });
  if ('ResizeObserver' in window) new ResizeObserver(() => layoutZoom()).observe(zoomGrid);

  function drawPanel(p) {
    if (!zoomDialog.open || !state.shown.has(p.method.id) || p.video.readyState < 2) return;
    const vw = p.video.videoWidth;
    const vh = p.video.videoHeight;
    if (!vw || !vh) return;
    const { m, x, y } = state.view;
    const ctx = p.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(p.video, x * vw, y * vh, vw / m, vh / m, 0, 0, p.canvas.width, p.canvas.height);
  }

  const draw = () => shown().forEach(drawPanel);

  function clearCanvas(p) {
    p.canvas.getContext('2d').clearRect(0, 0, p.canvas.width, p.canvas.height);
  }

  const clearCanvases = () => players.forEach(clearCanvas);

  let drawQueued = null;
  function requestDraw(p) {
    if (!zoomDialog.open) return;
    if (!drawQueued) {
      drawQueued = new Set();
      requestAnimationFrame(() => {
        const queued = drawQueued;
        drawQueued = null;
        queued.forEach(drawPanel);
      });
    }
    drawQueued.add(p);
  }

  const hasFrameCallback = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  function startDrawing() {
    if (hasFrameCallback) {
      shown().forEach((p) => {
        if (p.frameCallbackId) return;
        const onFrame = () => {
          p.frameCallbackId = 0;
          drawPanel(p);
          if (zoomDialog.open && state.shown.has(p.method.id)) {
            p.frameCallbackId = p.video.requestVideoFrameCallback(onFrame);
          }
        };
        p.frameCallbackId = p.video.requestVideoFrameCallback(onFrame);
      });
    }
    draw();
  }

  function stopDrawing() {
    players.forEach((p) => {
      if (p.frameCallbackId) p.video.cancelVideoFrameCallback(p.frameCallbackId);
      p.frameCallbackId = 0;
    });
  }

  // ---------- Synchronized magnification ----------

  // A plain click on a panel pauses, a drag pans, a two-finger pinch magnifies, and a double-click
  // resets the view and undoes the pause toggle from its first click.
  const pointers = new Map(); // pointers down on the panels: id -> { x, y }
  let drag = null;
  let suppressClick = false;
  let clickToggled = false; // the last single click on a panel toggled pause
  let pausedBeforeClick = false;

  // `fromDrag` is set by the drag itself; any other change (wheel, keys, buttons) mid-drag becomes
  // the drag's new starting point, so the next pointer move does not snap back.
  function setView(m, x, y, fromDrag = false) {
    const mag = clamp(m, 1, MAX_MAGNIFY);
    const span = 1 / mag;
    state.view = { m: mag, x: clamp(x, 0, 1 - span), y: clamp(y, 0, 1 - span) };
    zoomGrid.classList.toggle('is-magnified', mag > 1.001);
    magnifyValue.textContent = `${mag.toFixed(1)}×`;
    magnifyValue.setAttribute('aria-label', `${mag.toFixed(1)}×, reset magnification`);
    if (drag && !fromDrag) beginGesture(drag.stage, drag.moved);
    draw();
  }

  // Magnify by `factor`, keeping the point (px, py) of the visible window (0..1) fixed.
  function magnifyAround(factor, px = 0.5, py = 0.5) {
    const { m, x, y } = state.view;
    const next = clamp(m * factor, 1, MAX_MAGNIFY);
    setView(next, x + px / m - px / next, y + py / m - py / next);
  }

  const resetView = () => setView(1, 0, 0);

  const stagePoint = (stage, x, y) => {
    const rect = stage.getBoundingClientRect();
    return [clamp((x - rect.left) / rect.width, 0, 1), clamp((y - rect.top) / rect.height, 0, 1)];
  };

  const pointerCentre = () => {
    const [a, b] = pointers.values();
    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) } : { ...a, dist: 0 };
  };

  // (Re)starts the gesture from the current view, so adding or lifting a finger never makes it jump.
  function beginGesture(stage, moved) {
    const rect = stage.getBoundingClientRect();
    drag = { stage, start: pointerCentre(), view: { ...state.view }, rect, moved };
  }

  function endPointer(event) {
    if (!pointers.delete(event.pointerId) || !drag) return;
    if (pointers.size) {
      beginGesture(drag.stage, true);
      return;
    }
    // A moved or cancelled gesture gets no pause toggle. The flag is also cleared on the next
    // pointerdown, because touch browsers send no click at all after a moving touch.
    suppressClick = drag.moved || event.type === 'pointercancel';
    drag = null;
    zoomGrid.classList.remove('is-dragging');
  }

  players.forEach(({ stage }) => {
    stage.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * stage.clientHeight : event.deltaY;
      magnifyAround(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)), ...stagePoint(stage, event.clientX, event.clientY));
    }, { passive: false });

    // Desktop Safari reports a trackpad pinch as gesture events instead of ctrl+wheel. iOS fires
    // them for touch pinches too, which the pointer handlers below already cover.
    let gestureScale = 1;
    stage.addEventListener('gesturestart', (event) => {
      event.preventDefault();
      gestureScale = 1;
    });
    stage.addEventListener('gesturechange', (event) => {
      event.preventDefault();
      if (pointers.size) return;
      magnifyAround(event.scale / gestureScale, ...stagePoint(stage, event.clientX, event.clientY));
      gestureScale = event.scale;
    });
    stage.addEventListener('gestureend', (event) => event.preventDefault());

    stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.isPrimary || !pointers.size) {
        // A new gesture: drop anything the last one left behind.
        pointers.clear();
        suppressClick = false;
      } else if (pointers.size >= 2) {
        return;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      beginGesture(drag && pointers.size > 1 ? drag.stage : stage, pointers.size > 1);
      stage.setPointerCapture(event.pointerId);
    });

    stage.addEventListener('pointermove', (event) => {
      if (!drag || !pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const now = pointerCentre();
      const { start, view, rect } = drag;
      const pinching = pointers.size > 1;
      const slop = event.pointerType === 'mouse' ? 5 : 12;
      if (!drag.moved && Math.hypot(now.x - start.x, now.y - start.y) < slop) return;
      if (!pinching && view.m <= 1.001) return; // nothing to pan, so it still counts as a click
      drag.moved = true;
      zoomGrid.classList.add('is-dragging');
      // Keep the content under the gesture's starting centre under its current centre.
      const m = pinching && start.dist > 0 ? clamp(view.m * (now.dist / start.dist), 1, MAX_MAGNIFY) : view.m;
      setView(
        m,
        view.x + (start.x - rect.left) / rect.width / view.m - (now.x - rect.left) / rect.width / m,
        view.y + (start.y - rect.top) / rect.height / view.m - (now.y - rect.top) / rect.height / m,
        true,
      );
    });

    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('lostpointercapture', endPointer);

    stage.addEventListener('click', (event) => {
      if (suppressClick) {
        suppressClick = false;
        clickToggled = false;
        return;
      }
      if (event.detail > 1) return;
      pausedBeforeClick = state.userPaused;
      clickToggled = true;
      togglePause();
    });
    stage.addEventListener('dblclick', () => {
      if (clickToggled) setPaused(pausedBeforeClick);
      clickToggled = false;
      resetView();
    });
  });

  // ---------- Buttons and keyboard ----------

  const ACTIONS = {
    prev: () => step(-1),
    next: () => step(1),
    zoom: openZoom,
    close: closeZoom,
    restart,
    pause: togglePause,
    prompt: togglePrompt,
    'magnify-in': () => magnifyAround(MAGNIFY_STEP),
    'magnify-out': () => magnifyAround(1 / MAGNIFY_STEP),
    'magnify-reset': resetView,
  };

  document.addEventListener('click', (event) => {
    // Drop focus after a mouse click so Space pauses instead of re-pressing the last button. This
    // runs first so the zoom dialog does not remember the button and hand focus back on close.
    const button = event.target.closest('button');
    if (button && event.detail > 0) button.blur();
    const target = event.target.closest('[data-action]');
    if (target && ACTIONS[target.dataset.action]) ACTIONS[target.dataset.action](event);
  });

  const syncShortcuts = () => $('.shortcuts').classList.toggle('is-off', !shortcutToggle.checked);
  const shortcutToggleByPointer = pointerOperated(shortcutToggle.closest('label'));
  shortcutToggle.addEventListener('change', () => {
    syncShortcuts();
    if (shortcutToggleByPointer()) shortcutToggle.blur();
  });
  syncShortcuts();
  window.addEventListener('pageshow', syncShortcuts);

  const anchorByPointer = pointerOperated(anchorToggle.closest('label'));
  anchorToggle.addEventListener('change', () => {
    updateAnchorState();
    if (anchorByPointer()) anchorToggle.blur();
  });

  if (!canZoom) $$('[data-action="zoom"]').forEach((button) => { button.hidden = true; });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!shortcutToggle.checked) return;
    const el = event.target;
    const tag = el && el.tagName;
    const onRange = tag === 'INPUT' && el.type === 'range';
    const onCheckbox = tag === 'INPUT' && el.type === 'checkbox';
    if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && !onRange && !onCheckbox) || (el && el.isContentEditable)) return;
    const { key } = event;
    const settingKey = /^[1-9]$/.test(key) ? SETTINGS[Number(key) - 1] : null;

    if (zoomDialog.open && event.shiftKey && PAN_KEYS[key]) {
      if (onRange) return;
      const [dx, dy] = PAN_KEYS[key];
      const { m, x, y } = state.view;
      setView(m, x + (dx * PAN_STEP) / m, y + (dy * PAN_STEP) / m);
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (onRange) return; // let the slider step frame by frame
      step(key === 'ArrowRight' ? 1 : -1);
    } else if (key === ' ' || key === 'k' || key === 'K') {
      if ((tag === 'BUTTON' || onCheckbox) && key === ' ') return;
      togglePause();
    } else if (key === 'r' || key === 'R') {
      restart();
    } else if (key === 'z' || key === 'Z') {
      if (zoomDialog.open) closeZoom();
      else openZoom();
    } else if (key === '[' || key === '{') {
      jumpAnchor(-1);
    } else if (key === ']' || key === '}') {
      jumpAnchor(1);
    } else if (key === ',' || key === '<') {
      stepFrame(-1);
    } else if (key === '.' || key === '>') {
      stepFrame(1);
    } else if (settingKey) {
      show(settingKey, state.index[settingKey]);
    } else if (zoomDialog.open && (key === '+' || key === '=')) {
      magnifyAround(MAGNIFY_STEP);
    } else if (zoomDialog.open && (key === '-' || key === '_')) {
      magnifyAround(1 / MAGNIFY_STEP);
    } else if (zoomDialog.open && key === '0') {
      resetView();
    } else {
      return;
    }
    event.preventDefault();
  });

  document.addEventListener('visibilitychange', syncPlayback);

  // ---------- Frame loop ----------

  function tick() {
    syncPlayback();
    correctDrift();
    updateTransports();
    updateAnchorState();
    players.forEach(updateLoading);
    if (!hasFrameCallback && zoomDialog.open) {
      shown().forEach((p) => {
        if (p.video.currentTime === p.lastDrawn) return;
        p.lastDrawn = p.video.currentTime;
        drawPanel(p);
      });
    }
    requestAnimationFrame(tick);
  }

  // ---------- Start ----------

  setRate(1);
  const initial = fromHash() || [state.setting, 0];
  show(initial[0], initial[1]);
  applyMethods();
  window.addEventListener('resize', measurePrompt);
  requestAnimationFrame(tick);
})();
