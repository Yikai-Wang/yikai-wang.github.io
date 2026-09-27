/* Section 04c · s-walkthrough (storyboard S16). Builds the whole lane diagram in init() and renders any
   build from a single "time in rounds" value t: step 0 -> t = 0, step 1 -> t = 10 (planner done),
   step 2/3 -> t = 40 (all 27 chunks done). Forward steps animate t (planner ~2 s, renderer ~7 s).
   Planner allocation drawn: context parallel (FF-CP). Each of the 15 planner forwards is split across all four
   GPUs, so it is one box spanning the four lanes, drawn 2/3 of a round wide (illustrative gamma_plan = 1.5):
   planner rounds 0-10, then chunk i on GPU r at round 10 + r + i, last chunk done at round 40. */
(() => {
  'use strict';

  const S = FF.svg;
  const G = {
    x0: 260, p: 36, bw: 30,                 // round axis: x(round k) = x0 + p * k
    rounds: 40, planRounds: 10, chunks: 27, gpus: 4,
    planFwd: 15, split: 2 / 3, pbw: 20,     // planner: 15 split forwards, each 2/3 of a round (schematic)
    cellY: 50, cellH: 60, cellW: 104,       // planner (anchor) row
    laneY: 180, laneH: 54, lanePitch: 62,   // GPU lanes
    axisY: 440, filmY: 510, filmH: 54,      // round axis, filmstrip
  };
  const W = G.p * G.rounds;                  // 1440
  const xr = (k) => G.x0 + G.p * k;
  const cellCx = (a) => G.x0 + 60 + a * ((W - 120) / 8);
  const laneTop = (r) => G.laneY + r * G.lanePitch;
  const filmPitch = W / G.chunks;
  const planT = (k) => (k * 2) / 3;         // start round of planner forward k (k * split, exact at k = 15)
  const bandBot = laneTop(G.gpus - 1) + G.laneH;
  // Anchor window (3 anchor indices) read by chunk i, following the storyboard.
  const windowOf = (i) => (i <= 6 ? 0 : i <= 13 ? 2 : i <= 19 ? 4 : 6);

  function build(slide) {
    const svg = slide.querySelector('svg.fig');
    const refs = { plan: [], cells: [], rend: [], thumbs: [] };
    const add = (parent, tag, attrs, text) => {
      const n = S(tag, attrs);
      if (text != null) n.textContent = text;
      parent.appendChild(n);
      return n;
    };

    // --- static structure: labels, lanes, axis ---
    const base = add(svg, 'g', { class: 'base' });
    add(base, 'text', { class: 't-row t-plan', x: G.x0 - 20, y: G.cellY + 26, 'text-anchor': 'end' }, 'Planner');
    add(base, 'text', { class: 't-sub', x: G.x0 - 20, y: G.cellY + 56, 'text-anchor': 'end' }, 'anchor latents');
    for (let r = 0; r < G.gpus; r += 1) {
      add(base, 'rect', { class: 'lane', x: G.x0 - 4, y: laneTop(r), width: W + 8, height: G.laneH, rx: 6 });
      add(base, 'text', { class: 't-row', x: G.x0 - 20, y: laneTop(r) + G.laneH / 2 + 9, 'text-anchor': 'end' },
        `GPU ${r + 1} · stage ${G.gpus - r}`);
    }
    // planner phase: the four lanes merge into one shared band (every planner forward uses all four GPUs)
    add(base, 'rect', { class: 'lane', x: G.x0 - 4, y: laneTop(0), width: xr(G.planRounds) - G.x0 + 6,
      height: bandBot - laneTop(0), rx: 6 });
    add(base, 'line', { class: 'axis', x1: G.x0, x2: G.x0 + W, y1: G.axisY, y2: G.axisY });
    // Tick labels (and the axis name) are kept in refs.ticks so the live "round N" tag can hide the ones it covers.
    refs.ticks = [];
    for (let k = 0; k <= G.rounds; k += 5) {
      add(base, 'line', { class: 'axis', x1: xr(k), x2: xr(k), y1: G.axisY, y2: G.axisY + 8 });
      refs.ticks.push({ x: xr(k), r: 84, el: add(base, 'text', { class: 't-axis', x: xr(k), y: G.axisY + 36, 'text-anchor': 'middle' }, String(k)) });
    }
    refs.ticks.push({ x: G.x0 - 75, r: 128, el: add(base, 'text', { class: 't-axis t-axis-name', x: G.x0 - 20, y: G.axisY + 36, 'text-anchor': 'end' }, 'rounds →') });
    add(base, 'text', { class: 't-row', x: G.x0 - 20, y: G.filmY + G.filmH / 2 + 9, 'text-anchor': 'end' }, 'Video');
    add(base, 'text', { class: 't-film', x: G.x0, y: G.filmY + G.filmH + 32 }, '0 s');
    add(base, 'text', { class: 't-film', x: G.x0 + W, y: G.filmY + G.filmH + 32, 'text-anchor': 'end' }, '20 s');

    // --- anchor window highlight (behind the cells) and its link to the chunk on GPU 1 ---
    const win = add(svg, 'g', { class: 'win' });
    refs.winRect = add(win, 'rect', { class: 'win-rect', x: 0, y: G.cellY - 8, width: 2 * ((W - 120) / 8) + G.cellW + 20,
      height: G.cellH + 16, rx: 14 });
    refs.winLink = add(win, 'path', { class: 'win-link', d: 'M0 0' });
    refs.winText = add(win, 'text', { class: 't-win', x: 0, y: G.cellY + G.cellH + 40 }, '');
    refs.win = win;

    // --- links: planner block b (forwards 5b..5b+4) -> its three anchor cells (planner phase only) ---
    refs.links = [];
    const lk = add(svg, 'g', { class: 'links' });
    for (let b = 0; b < 3; b += 1) {
      const x1 = xr(planT(5 * b + 4) + G.split / 2);   // from the block's clean-KV forward (pale box)
      const y1 = laneTop(0) - 2;
      const x2 = cellCx(3 * b + 1);
      const y2 = G.cellY + G.cellH + 4;
      refs.links.push(add(lk, 'path', { class: 'plan-link',
        d: `M${x1} ${y1} C${x1} ${y1 - 40} ${x2} ${y2 + 40} ${x2} ${y2}` }));
    }

    // --- planner row: 3 blocks of 3 anchor cells (latent positions 0, 10, ..., 80) ---
    const prow = add(svg, 'g', { class: 'prow' });
    for (let b = 0; b < 3; b += 1) {
      const l = cellCx(3 * b) - G.cellW / 2;
      const rgt = cellCx(3 * b + 2) + G.cellW / 2;
      add(prow, 'path', { class: 'brk', d: `M${l} ${G.cellY - 12} v-8 H${rgt} v8` });
      add(prow, 'text', { class: 't-blk', x: (l + rgt) / 2, y: G.cellY - 26, 'text-anchor': 'middle' }, `block ${b + 1}`);
    }
    for (let a = 0; a < 9; a += 1) {
      const g = add(prow, 'g', { class: 'cell' });
      add(g, 'rect', { x: cellCx(a) - G.cellW / 2, y: G.cellY, width: G.cellW, height: G.cellH, rx: 8 });
      add(g, 'text', { x: cellCx(a), y: G.cellY + G.cellH / 2 + 9, 'text-anchor': 'middle' }, String(a * 10));
      refs.cells.push(g);
    }

    // --- planner forwards, rounds 0-10: per block 4 denoising + 1 clean-KV extraction; each spans all 4 lanes ---
    const boxes = add(svg, 'g', { class: 'boxes' });
    for (let k = 0; k < G.planFwd; k += 1) {
      refs.plan.push(add(boxes, 'rect', { class: k % 5 === 4 ? 'bx bx-plankv' : 'bx bx-plan',
        x: xr(planT(k)) + (G.p * G.split - G.pbw) / 2, y: laneTop(0) + 5, width: G.pbw, height: bandBot - laneTop(0) - 10, rx: 4 }));
    }
    // build-1 callout in the (still empty) renderer area right of the planner band (no label on the band itself,
    // so none of the 15 planner boxes is covered)
    refs.call = add(svg, 'g', { class: 'callout' });
    add(refs.call, 'text', { class: 't-call', x: xr(G.planRounds) + 36, y: laneTop(1) + 36 },
      '← each planner forward is split across all 4 GPUs');
    add(refs.call, 'text', { class: 't-call-sub', x: xr(G.planRounds) + 72, y: laneTop(2) + 20 },
      'context parallelism: not 4× faster (it costs communication); pays off at 720p');
    // --- renderer: chunk i on GPU r at round 10 + r + i ---
    for (let r = 0; r < G.gpus; r += 1) {
      const row = [];
      for (let i = 0; i < G.chunks; i += 1) {
        row.push(add(boxes, 'rect', { class: 'bx bx-ours', x: xr(G.planRounds + r + i) + (G.p - G.bw) / 2,
          y: laneTop(r) + 5, width: G.bw, height: G.laneH - 10, rx: 4 }));
      }
      refs.rend.push(row);
    }

    // --- filmstrip: 27 empty frames, thumbnails appear when GPU 4 finishes the chunk ---
    const film = add(svg, 'g', { class: 'film' });
    for (let i = 0; i < G.chunks; i += 1) {
      const x = G.x0 + i * filmPitch + 2;
      const w = filmPitch - 4;
      add(film, 'rect', { class: 'frame', x, y: G.filmY, width: w, height: G.filmH, rx: 4 });
      const img = add(film, 'image', { class: 'thumb', x, y: G.filmY, width: w, height: G.filmH,
        preserveAspectRatio: 'xMidYMid slice', href: `media/strip/bear-c${String(i).padStart(2, '0')}.jpg` });
      refs.thumbs.push(img);
    }

    // --- finish line + "now" line with a round tag ---
    const fx = xr(G.rounds);
    refs.fin = add(svg, 'g', { class: 'fin' });
    add(refs.fin, 'line', { class: 'finish', x1: fx, x2: fx, y1: G.laneY - 40, y2: G.axisY });
    add(refs.fin, 'rect', { class: 'film-done', x: G.x0 - 4, y: G.filmY - 6, width: W + 8, height: G.filmH + 12, rx: 8 });
    // green "done" flag, same look as s-race (the 40 is read off the axis below it)
    add(refs.fin, 'rect', { class: 'flag-bg', x: fx - 92, y: G.laneY - 44, width: 92, height: 38, rx: 7 });
    add(refs.fin, 'text', { class: 't-flag', x: fx - 46, y: G.laneY - 16, 'text-anchor': 'middle' }, 'done');
    refs.now = add(svg, 'g', { class: 'now' });
    add(refs.now, 'line', { x1: 0, x2: 0, y1: G.laneY - 10, y2: G.axisY });
    add(refs.now, 'rect', { class: 'tag', x: -66, y: G.axisY + 8, width: 132, height: 38, rx: 19 });
    refs.nowText = add(refs.now, 'text', { class: 't-tag', x: 0, y: G.axisY + 36, 'text-anchor': 'middle' }, 'round 0');

    return { svg, refs, add };
  }

  const POP = [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }];
  const POP_OPTS = { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1.25)' };

  // Show or hide one element; when `run` is given and the element is newly shown, pop it in.
  function vis(el, on, run, keys = POP, opts = POP_OPTS) {
    const was = !el.classList.contains('off');
    el.classList.toggle('off', !on);
    if (on && !was && run) FF.animate(el, keys, opts, run);
  }

  // Draw the diagram at time t (in rounds). `live` = animation in progress (now line + window shown).
  // `hold` = chunk index whose anchor window stays shown when not live (the end state of build 2).
  function draw(ctx, t, run, live, hold = -1) {
    const { refs } = ctx;
    refs.plan.forEach((el, k) => vis(el, t > planT(k), run));
    vis(refs.call, t > 0 && t <= G.planRounds, run, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
    refs.cells.forEach((el, a) => {
      const lit = t >= planT(5 * Math.floor(a / 3) + 5);
      const was = el.classList.contains('lit');
      el.classList.toggle('lit', lit);
      if (lit && !was && run) {
        FF.animate(el, [{ transform: 'scale(.6)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'none' }],
          { duration: 420, delay: (a % 3) * 70 }, run);
      }
    });
    refs.links.forEach((el, b) => vis(el, t >= planT(5 * b + 5) && t <= G.planRounds, run,
      [{ opacity: 0 }, { opacity: 1 }], { duration: 300 }));
    refs.rend.forEach((row, r) => row.forEach((el, i) => vis(el, t > G.planRounds + r + i, run)));
    refs.thumbs.forEach((el, i) => vis(el, t >= G.planRounds + G.gpus + i, run,
      [{ opacity: 0, transform: 'translateY(-26px) scale(.7)' }, { opacity: 1, transform: 'none' }],
      { duration: 340, easing: 'cubic-bezier(.3,.9,.3,1.15)' }));

    // anchor window of the chunk currently on GPU 1 (rounds 10-36)
    const c = live ? Math.floor(t) - G.planRounds : hold;
    const showWin = c >= 0 && c < G.chunks;
    refs.win.classList.toggle('off', !showWin);
    if (showWin) {
      const w = windowOf(c);
      refs.winRect.setAttribute('x', cellCx(w) - G.cellW / 2 - 10);
      const bx = xr(G.planRounds + c) + G.p / 2;
      const wx = cellCx(w + 1);
      const y1 = G.cellY + G.cellH + 8;
      const y2 = laneTop(0) + 4;
      refs.winLink.setAttribute('d', `M${wx} ${y1} C${wx} ${y1 + 26} ${bx} ${y2 - 26} ${bx} ${y2}`);
      // label on the side away from the link: "read by chunk N" (1-based)
      const left = bx > wx;
      refs.winText.setAttribute('x', left ? wx - 16 : wx + 16);
      refs.winText.setAttribute('text-anchor', left ? 'end' : 'start');
      refs.winText.textContent = `read by chunk ${c + 1}`;
    }
    // now line; its round tag hides the axis labels it would cover
    refs.now.classList.toggle('off', !live);
    if (live) {
      refs.now.setAttribute('transform', `translate(${xr(t)} 0)`);
      refs.nowText.textContent = `round ${Math.min(G.rounds, Math.floor(t))}`;
    }
    refs.ticks.forEach(({ x, r, el }) => el.classList.toggle('off', live && Math.abs(x - xr(t)) < r));
    vis(refs.fin, t >= G.rounds, run, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
  }

  // Drop every pop-in animation (they use fill: forwards and would override the .off class).
  function clearAnims(svg) {
    if (!document.getAnimations) return;
    document.getAnimations().forEach((a) => {
      const tg = a.effect && a.effect.target;
      if (tg && svg.contains(tg)) a.cancel();
    });
  }

  const T_OF_STEP = [0, G.planRounds, G.rounds, G.rounds];

  Deck.register('s-walkthrough', {
    steps: 3,
    init(slide) {
      slide._ff04c = build(slide);
    },
    update(slide, step, info) {
      const run = FF.run(slide);
      const ctx = slide._ff04c;
      clearAnims(ctx.svg);
      const tEnd = T_OF_STEP[step] ?? G.rounds;
      const tStart = step >= 1 && step <= 2 ? T_OF_STEP[step - 1] : tEnd;
      const hold = step === 2 ? G.chunks - 1 : -1;   // build 2 ends on the last chunk's window {60, 70, 80}
      if (!info.animate || tStart === tEnd) { draw(ctx, tEnd, null, false, hold); return; }

      draw(ctx, tStart, null, false);
      const dur = step === 1 ? 2000 : 7000;
      FF.tween({
        from: tStart, to: tEnd, dur, delay: 250, easing: FF.ease.linear, run,
        onUpdate: (t) => draw(ctx, t, run, t < tEnd),
      }).then((ok) => { if (!ok) return; draw(ctx, tEnd, run, false, hold); });
    },
    leave(slide) {
      FF.cancel(slide);
      if (slide._ff04c) clearAnims(slide._ff04c.svg);
    },
  });
})();

/* s-race (moved here from js/sec-03.js). The SVG markup in 04c-walkthrough.html holds the final state of every build
   (static mode, jumps, print); this only animates build 1: a shared "now" sweep over the round axis. Every box carries
   data-s = its start time in rounds (fractional for forwards split across 4 GPUs, drawn 2/3 of a round wide);
   every finish flag carries data-s = its finish round. Boxes are listed in the markup sorted by data-s. */
(() => {
  'use strict';

  const R = { x0: 328, p: 13.5, end: 90, dur: 5200 };   // x(round t) = x0 + p * t, as in the generated markup

  const clearInline = (els) => els.forEach((el) => {
    if (el.getAnimations) el.getAnimations().forEach((a) => a.cancel());
    el.style.opacity = '';
    el.style.transform = '';
  });

  // Build-2 stats ("· 212 forwards · 56 rounds") follow their track titles. The titles' width depends on the installed
  // system font, so measure them; the x in the markup is only the fallback (SF Pro) when nothing can be measured.
  function placeStats(slide) {
    ['sf', 'hiar', 'ours'].forEach((k) => {
      const title = slide.querySelector(`svg.fig .t-track-${k}`);
      const res = slide.querySelector(`svg.fig .t-res-${k}`);
      if (!title || !res || !title.getComputedTextLength) return;
      let w = 0;
      try { w = title.getComputedTextLength(); } catch (e) { w = 0; }
      if (w > 0) res.setAttribute('x', (+title.getAttribute('x') + w + 14).toFixed(1));
    });
  }

  Deck.register('s-race', {
    steps: 2,
    init(slide) { placeStats(slide); },
    update(slide, step, info) {
      const run = FF.run(slide);
      placeStats(slide);
      const rects = Array.from(slide.querySelectorAll('.race rect[data-s]'));
      const flags = Array.from(slide.querySelectorAll('.race .flag'));
      const now = slide.querySelector('.race .now');
      const reset = () => {
        rects.forEach((el) => el.classList.remove('is-pending'));
        flags.forEach((el) => { el.classList.remove('is-pending'); clearInline([el]); });
        clearInline([now]);
      };
      reset();
      if (!(step === 1 && info.animate)) return;

      run.onCancel(reset);
      rects.forEach((el) => el.classList.add('is-pending'));
      flags.forEach((el) => el.classList.add('is-pending'));
      const startOf = rects.map((el) => +el.dataset.s);
      let ptr = 0;
      const shown = new Set();
      now.style.opacity = '.55';
      FF.tween({
        from: 0,
        to: R.end,
        dur: R.dur,
        delay: 250,
        easing: FF.ease.linear,
        run,
        onUpdate: (t) => {
          const x = R.x0 + t * R.p;
          now.setAttribute('x1', x);
          now.setAttribute('x2', x);
          while (ptr < rects.length && startOf[ptr] < t) { rects[ptr].classList.remove('is-pending'); ptr += 1; }
          flags.forEach((el) => {
            if (shown.has(el) || +el.dataset.s > t) return;
            shown.add(el);
            el.classList.remove('is-pending');
            FF.animate(el, [{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }],
              { duration: 420 }, run);
          });
        },
      }).then((ok) => {
        if (ok) FF.animate(now, [{ opacity: 0.55 }, { opacity: 0 }], { duration: 400 }, run);
      });
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
