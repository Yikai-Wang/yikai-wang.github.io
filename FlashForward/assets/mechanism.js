(() => {
  'use strict';

  // An animated redrawing of the mechanism panel of the paper's teaser figure. The geometry below
  // is the figure's own, in centimetres x 100: a 9.00 x 4.52 cm panel becomes a 900 x 452 viewBox,
  // and every coordinate is the one the figure uses, with the sign of y flipped.

  const host = document.querySelector('[data-mechanism]');
  if (!host) return;

  const NS = 'http://www.w3.org/2000/svg';
  const W = 900;
  const H = 470;
  const PT = 3.5278; // one typographic point, in viewBox units
  const TW = 78; // tile width
  const TH = 41.6; // tile height
  const COLS = 7;
  const ROWS = 4; // one row per GPU
  const TIMES = [1, 4, 7, 10, 13, 16, 19]; // video time of each column, in the asset names
  const SIGMA = ['92', '65', '38', '18']; // noise level each GPU works at
  const PY_BOT = 94; // bottom edge of the planner strip
  const PY_TOP = PY_BOT - TH;
  const ARROW_Y = 73.2; // centre line of the planner strip
  const cx = (k) => 155 + k * 103.2; // centre of column k
  const rt = (r) => 155 + r * 57.6; // top edge of GPU row r
  const rc = (r) => 175.8 + r * 57.6; // centre line of GPU row r

  // All 36 frames are one 180 x 3456 strip, stacked in this order, so the panel costs a single
  // request: 44 separate tiles queued behind the video streams and left the diagram empty for
  // seconds. Each is cropped back out by a <symbol> viewBox and placed with <use>.
  const SPRITE = 'assets/mechanism/tiles.png';
  const SPRITE_W = 180;
  const SPRITE_H = 96;
  const SPRITE_TIMES = [1, 4, 7, 10, 13, 16, 19];
  const SPRITE_SIGMAS = ['92', '65', '38', '18', '00'];
  const tileId = (time, sigma) => {
    const index = time === 20 ? SPRITE_TIMES.length * SPRITE_SIGMAS.length
      : SPRITE_TIMES.indexOf(time) * SPRITE_SIGMAS.length + SPRITE_SIGMAS.indexOf(sigma);
    return `mech-t${index}`;
  };

  const C = {
    anchor: '#B45309',
    anchorBg: '#FEF3C7',
    anchorTxt: '#92400E',
    dense: '#2563B8',
    denseDone: '#7CA1D4', // denseln!60
    ribbon: '#DCE6F4', // denseln!16
    slate: '#475569',
    kv: '#E11D48',
    done: '#15803D',
    hairline: '#CBD5E1',
  };

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    if (attrs) {
      Object.keys(attrs).forEach((key) => node.setAttribute(key, String(attrs[key])));
    }
    return node;
  };
  const add = (parent, name, attrs) => parent.appendChild(el(name, attrs));
  const text = (parent, string, attrs) => {
    const node = add(parent, 'text', attrs);
    node.textContent = string;
    return node;
  };

  // ---------- Arrows ----------

  // Drawn as a line plus a separate head so the line can extend and the head land when it arrives.
  // Head size is the figure's Latex[length=0.58mm,width=0.46mm].
  const HEAD_L = 5.8;
  const HEAD_W = 4.6;

  function arrow(parent, x1, y1, x2, y2, { stroke, width, dash, className = '' }) {
    const group = add(parent, 'g', { class: `draw ${className}`.trim() });
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    // Stop the line where the head begins, so the two never stack up into a blob.
    const lx = x2 - ux * HEAD_L;
    const ly = y2 - uy * HEAD_L;
    const line = add(group, 'line', {
      class: 'line', x1, y1, x2: lx, y2: ly, stroke, 'stroke-width': width,
    });
    if (dash) line.setAttribute('stroke-dasharray', dash);
    else line.setAttribute('pathLength', 1);
    line.classList.toggle('is-dashed', Boolean(dash));
    const px = -uy;
    const py = ux;
    add(group, 'path', {
      class: 'head',
      fill: stroke,
      d: `M ${x2} ${y2} L ${lx + px * HEAD_W / 2} ${ly + py * HEAD_W / 2}`
        + ` L ${lx - px * HEAD_W / 2} ${ly - py * HEAD_W / 2} Z`,
    });
    return group;
  }

  // ---------- Build ----------

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'mech-svg',
    role: 'img',
    'aria-label': 'Animated diagram: the planner denoises anchors ahead of time while four GPUs '
      + 'render the video in between them, one denoising stage per GPU.',
  });

  const defs = add(svg, 'defs');
  const tileCount = SPRITE_TIMES.length * SPRITE_SIGMAS.length + 1;
  for (let i = 0; i < tileCount; i += 1) {
    const symbol = add(defs, 'symbol', {
      id: `mech-t${i}`,
      viewBox: `0 ${i * SPRITE_H} ${SPRITE_W} ${SPRITE_H}`,
      preserveAspectRatio: 'none',
    });
    add(symbol, 'image', {
      href: SPRITE, x: 0, y: 0, width: SPRITE_W, height: SPRITE_H * tileCount,
      preserveAspectRatio: 'none',
    });
  }
  const tile = (parent, time, sigma, box, attrs) => add(parent, 'use', {
    href: `#${tileId(time, sigma)}`, ...box, ...attrs,
  });

  // No panel card and no frame: the diagram sits straight on the section's background.

  const ribbon = add(svg, 'line', {
    class: 'ribbon', x1: cx(0), y1: rc(0), x2: cx(0), y2: rc(0),
    stroke: C.ribbon, 'stroke-width': 7.2 * PT, 'stroke-linecap': 'round',
  });

  // ----- renderer lattice -----

  const cells = [];
  const latticeLayer = add(svg, 'g', { class: 'lattice' });
  const arrowLayer = add(svg, 'g', { class: 'lattice-arrows' });

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const group = add(latticeLayer, 'g', { class: 'cell fade' });
      const box = { x: cx(c) - TW / 2, y: rt(r), width: TW, height: TH };
      tile(group, TIMES[c], SIGMA[r], box);
      // GPU 3 emits the finished frame, so its cells hold both states and cross-fade.
      const clean = r === ROWS - 1
        ? tile(group, TIMES[c], '00', box, { class: 'clean' })
        : null;
      const edge = add(group, 'rect', { ...box, fill: 'none' });
      cells.push({ c, r, group, clean, edge });

      const kvTo = cx(c + 1) - TW / 2 - 2;
      cells[cells.length - 1].kvArrow = c < COLS - 1
        ? arrow(arrowLayer, cx(c) + TW / 2 + 2, rc(r), kvTo, rc(r),
          { stroke: C.kv, width: 0.42 * PT, dash: '2.5 1.8' })
        : null;
      cells[cells.length - 1].stepArrow = r < ROWS - 1
        ? arrow(arrowLayer, cx(c), rt(r) + TH + 2, cx(c), rt(r + 1) - 2,
          { stroke: C.slate, width: 0.42 * PT })
        : null;
    }
  }
  const cellAt = (c, r) => cells[r * COLS + c];

  // ----- planner strip -----

  const planner = add(svg, 'g', { class: 'planner' });

  // The past anchor: four denoise steps of one anchor, stacked up and to the left so the noisiest
  // card is at the back and the clean one in front.
  const stack = add(planner, 'g', { class: 'anchor-stack' });
  ['92', '65', '38', '00'].forEach((sigma, i) => {
    const k = 3 - i; // k=3 is the back card
    const card = add(stack, 'g', { class: 'fade card', style: `--i:${i}` });
    const box = {
      x: cx(0) - TW / 2 - k * 5, y: PY_TOP - k * 5, width: TW, height: TH,
    };
    tile(card, 1, sigma, box);
    add(card, 'rect', { ...box, fill: 'none', stroke: C.anchor, 'stroke-width': 0.42 * PT });
  });

  // The future anchor, the same four steps unrolled one per column so the noise burns off.
  const unrolled = ['92', '65', '38', '00'].map((sigma, i) => {
    const group = add(planner, 'g', { class: 'fade' });
    const box = { x: cx(i + 2) - TW / 2, y: PY_TOP, width: TW, height: TH };
    tile(group, 19, sigma, box);
    add(group, 'rect', { ...box, fill: 'none', stroke: C.anchor, 'stroke-width': 0.42 * PT });
    return group;
  });

  // The two passes that publish a cache and produce no frame at all.
  const kvBox = (col) => {
    const group = add(planner, 'g', { class: 'fade' });
    add(group, 'rect', {
      x: cx(col) - TW / 2, y: PY_TOP, width: TW, height: TH, rx: 1.4 * PT,
      fill: C.anchorBg, stroke: C.anchor, 'stroke-width': 0.5 * PT,
    });
    text(group, 'clean KV', {
      x: cx(col), y: 66.5, class: 'mini', 'text-anchor': 'middle', fill: C.anchorTxt,
    });
    text(group, 'no frame', {
      x: cx(col), y: 88, class: 'mini bold', 'text-anchor': 'middle', fill: C.anchorTxt,
    });
    return group;
  };
  const kvLeft = kvBox(1);
  const kvRight = kvBox(6);

  // One arrow per gap along the strip, then a longer dashed one for the unbounded continuation.
  const planArrows = [];
  for (let k = 0; k < 6; k += 1) {
    planArrows.push(arrow(planner, cx(k) + TW / 2 + 4.1, ARROW_Y, cx(k + 1) - TW / 2 - 4.1, ARROW_Y,
      { stroke: C.anchor, width: 0.44 * PT }));
  }
  const streamArrow = arrow(planner, 817.3, ARROW_Y, 851.3, ARROW_Y,
    { stroke: C.anchor, width: 0.44 * PT, dash: '3 2' });

  // The tile the panel edge cuts in half: the video keeps going past the figure.
  const clipId = 'mech-stream-clip';
  const clip = add(defs, 'clipPath', { id: clipId });
  add(clip, 'rect', { x: 855.4, y: PY_TOP, width: 30.6, height: TH });
  const streamTile = add(planner, 'g', { class: 'fade', 'clip-path': `url(#${clipId})` });
  tile(streamTile, 20, '92', { x: 855.4, y: PY_TOP, width: TW, height: TH });
  add(streamTile, 'rect', {
    x: 855.4, y: PY_TOP, width: TW, height: TH, fill: 'none',
    stroke: C.anchor, 'stroke-width': 0.42 * PT,
  });

  // The anchor window: a bracket over the whole interval, feeding every column inside it.
  const bracket = add(svg, 'g', { class: 'fade bracket' });
  add(bracket, 'path', {
    d: `M ${cx(0)} 98 L ${cx(0)} 128 L ${cx(5)} 128 L ${cx(5)} 98`,
    fill: 'none', stroke: C.anchor, 'stroke-width': 0.46 * PT, 'stroke-dasharray': '1.8 1.8',
  });
  [1, 2, 3, 4].forEach((c) => {
    arrow(bracket, cx(c), 128, cx(c), 153,
      { stroke: C.anchor, width: 0.46 * PT, dash: '1.8 1.8', className: 'on' });
  });
  text(bracket, 'both anchors guide every chunk in between', {
    x: 413, y: 116, class: 'tny', 'text-anchor': 'middle', fill: C.anchorTxt,
  });

  // ----- chrome -----

  const labels = add(svg, 'g', { class: 'chrome' });
  const rowLabel = (string, x, y, cls) => text(labels, string, {
    x: 0, y: 0, class: `rowlbl fade ${cls}`, 'text-anchor': 'middle',
    'dominant-baseline': 'central', fill: C.slate,
    transform: `translate(${x} ${y}) rotate(-90)`,
  });
  const plannerLabel = rowLabel('Planner', 26, 80, 'planner-label');
  const rendererLabel = rowLabel('Renderer', 26, 262, 'renderer-label');

  const pastLabel = text(labels, 'past anchor', {
    x: cx(0), y: 26, class: 'lbl bold fade', 'text-anchor': 'middle', fill: C.anchorTxt,
  });
  const futureLabel = text(labels, 'future anchor', {
    x: cx(5), y: 26, class: 'lbl bold fade', 'text-anchor': 'middle', fill: C.anchorTxt,
  });
  const stepsLabel = text(labels, '4 denoise steps', {
    x: 516.2, y: 40, class: 'tny fade', 'text-anchor': 'middle', fill: C.anchorTxt,
  });

  const gpuLabels = [];
  for (let r = 0; r < ROWS; r += 1) {
    gpuLabels.push(text(labels, `GPU ${r}`, {
      x: 108, y: rc(r), class: 'tny fade', 'text-anchor': 'end',
      'dominant-baseline': 'central', fill: C.slate,
    }));
  }

  // The legend is laid out after the fonts resolve, so the four items keep even gaps.
  const legend = add(svg, 'g', { class: 'fade legend' });
  const legendItems = [
    { label: 'video time', draw: (g) => add(g, 'line', { x1: 0, y1: 0, x2: 28, y2: 0, stroke: C.slate, 'stroke-width': 0.42 * PT, 'marker-end': 'url(#mech-tip-slate)' }), w: 28 },
    { label: 'one round', draw: (g) => add(g, 'line', { x1: 0, y1: 5, x2: 22, y2: -9, stroke: C.ribbon, 'stroke-width': 2.6 * PT, 'stroke-linecap': 'round' }), w: 22 },
    { label: 'same-stage KV', draw: (g) => add(g, 'line', { x1: 0, y1: 0, x2: 24, y2: 0, stroke: C.kv, 'stroke-width': 0.42 * PT, 'stroke-dasharray': '2.5 1.8', 'marker-end': 'url(#mech-tip-kv)' }), w: 24 },
    { label: 'next stage', draw: (g) => add(g, 'line', { x1: 0, y1: -5, x2: 0, y2: 8, stroke: C.slate, 'stroke-width': 0.42 * PT, 'marker-end': 'url(#mech-tip-slate)' }), w: 0 },
  ];
  [['mech-tip-slate', C.slate], ['mech-tip-kv', C.kv]].forEach(([id, fill]) => {
    const marker = add(defs, 'marker', {
      id, viewBox: '0 0 6 5', refX: 5.4, refY: 2.5, markerWidth: 6, markerHeight: 5,
      orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse',
    });
    add(marker, 'path', { d: 'M 0 0 L 6 2.5 L 0 5 Z', fill });
  });

  const legendParts = legendItems.map((item) => {
    const group = add(legend, 'g');
    const mark = add(group, 'g');
    item.draw(mark);
    const node = text(group, item.label, {
      x: 0, y: 0, class: 'tny', fill: C.slate, 'dominant-baseline': 'central',
    });
    return { group, mark, node, item };
  });

  const closing = add(svg, 'g', { class: 'fade closing' });
  text(closing, 'Every renderer denoising forward advances generation and publishes', {
    x: 464.6, y: 424, class: 'tny bold', 'text-anchor': 'middle', fill: C.slate,
  });
  text(closing, 'same-stage KV: no renderer forward is spent only on a cache update', {
    x: 464.6, y: 450, class: 'tny bold', 'text-anchor': 'middle', fill: C.slate,
  });

  host.querySelector('[data-mech-stage]').appendChild(svg);

  function layoutLegend() {
    const gap = 26;
    const pad = 7;
    const widths = legendParts.map((part) => {
      let textW = 0;
      try {
        textW = part.node.getComputedTextLength();
      } catch (_) {
        textW = part.item.label.length * 7.4;
      }
      return { textW, total: part.item.w + pad + textW };
    });
    const total = widths.reduce((sum, w) => sum + w.total, 0) + gap * (legendParts.length - 1);
    let x = 464.6 - total / 2;
    legendParts.forEach((part, i) => {
      part.group.setAttribute('transform', `translate(${x} 385)`);
      part.node.setAttribute('x', part.item.w + pad);
      x += widths[i].total + gap;
    });
  }

  // ---------- Storyboard ----------

  // Round n has GPU r working on column n-1-r, so one anti-diagonal is one round. Rounds 1..6 walk
  // the wavefront out to the second-to-last column; the last rounds drain what is left.
  const liveCells = (round) => {
    const out = [];
    for (let r = 0; r < ROWS; r += 1) {
      const c = round - 1 - r;
      if (c >= 0 && c < COLS) out.push({ c, r });
    }
    return out;
  };

  const STEPS = [
    { caption: '' },
    { caption: 'The planner denoises a past anchor down to a clean frame.' },
    { caption: 'That pass publishes a KV cache and no frame at all.' },
    { caption: 'A future anchor starts from noise, four denoise steps ahead of the video.' },
    { caption: 'Step two: the scene starts to show through.' },
    { caption: 'Step three: almost clean.' },
    { caption: 'The future anchor is finished, at a video time nothing has been rendered for yet.' },
    { caption: 'It publishes its cache too — again with no frame to show for it.' },
    { caption: 'The renderer takes over: four GPUs, each pinned to one denoising stage.' },
    { caption: 'Round 1: GPU 0 takes the first chunk at the noisiest stage.' },
    { caption: 'Round 2: GPU 0 moves to the next chunk and hands the first one down to GPU 1.' },
    { caption: 'Round 3: the wavefront fills; every GPU that finishes passes its chunk down.' },
    { caption: 'Round 4: all four GPUs are busy and GPU 3 emits the first finished chunk.' },
    { caption: 'Round 5: one anti-diagonal, one round — the lattice advances a column at a time.' },
    { caption: 'Round 6: each pass publishes same-stage KV rightwards and its chunk downwards.' },
    { caption: 'Both anchors were clean before any of this, and guide every chunk between them.' },
    { caption: 'The planner is already running ahead to the next anchor while the renderer streams.' },
    { caption: 'Round 8: the wavefront runs off the right edge and starts to drain.' },
    { caption: 'Round 9: the last chunks fall through the remaining stages.' },
    { caption: 'Round 10: GPU 3 emits the final chunk. No renderer forward was spent only on a cache update.' },
  ];
  const LAST = STEPS.length - 1;

  const roundAt = (step) => {
    if (step < 9) return 0;
    if (step <= 14) return step - 8;
    if (step === 15) return 6;
    return step - 9;
  };

  const show = (node, on) => node.classList.toggle('on', on);

  function applyStep(step) {
    show(plannerLabel, step >= 1);
    show(pastLabel, step >= 1);
    stack.querySelectorAll('.card').forEach((card) => show(card, step >= 1));
    show(planArrows[0], step >= 2);
    show(kvLeft, step >= 2);
    unrolled.forEach((tile, i) => {
      show(planArrows[i + 1], step >= 3 + i);
      show(tile, step >= 3 + i);
    });
    show(futureLabel, step >= 6);
    show(stepsLabel, step >= 6);
    show(planArrows[5], step >= 7);
    show(kvRight, step >= 7);
    show(rendererLabel, step >= 8);
    show(legend, step >= 8);
    gpuLabels.forEach((node) => show(node, step >= 8));
    show(closing, step >= 8);
    show(bracket, step >= 15);
    show(streamArrow, step >= 16);
    show(streamTile, step >= 16);

    const round = roundAt(step);
    const live = liveCells(round);
    const isLive = (c, r) => live.some((cell) => cell.c === c && cell.r === r);

    cells.forEach((cell) => {
      const { c, r, edge } = cell;
      const reached = round > 0 && c <= round - 1 - r;
      const live1 = isLive(c, r);
      const finished = r === ROWS - 1 && reached && !live1;
      // A chunk that no GPU has touched yet is not drawn at all: the lattice grows behind the
      // wavefront instead of standing there as a grid of empty boxes.
      cell.group.classList.toggle('on', step >= 8 && reached);
      if (cell.clean) cell.clean.classList.toggle('on', finished);
      const colour = finished || (live1 && r === ROWS - 1) ? C.done
        : live1 ? C.dense : C.denseDone;
      const width = live1 ? 0.78 : finished ? 0.52 : 0.34;
      edge.setAttribute('stroke', colour);
      edge.setAttribute('stroke-width', width * PT);
      // The last column publishes no KV to the right, and GPU 3 has no next stage to drop into.
      if (cell.kvArrow) show(cell.kvArrow, live1);
      if (cell.stepArrow) show(cell.stepArrow, live1);
    });

    if (live.length) {
      const first = live[live.length - 1]; // lowest GPU row reached
      const last = live[0];
      ribbon.setAttribute('x1', cx(first.c));
      ribbon.setAttribute('y1', rc(first.r));
      ribbon.setAttribute('x2', cx(last.c));
      ribbon.setAttribute('y2', rc(last.r));
    }
    ribbon.classList.toggle('on', live.length > 0);

    host.querySelector('[data-mech-caption]').textContent = STEPS[step].caption;
    host.querySelector('[data-mech-step]').textContent = `${step} / ${LAST}`;
  }

  // ---------- Controls ----------

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { step: 0, playing: false, timer: 0 };
  const HOLD = 1100; // between steps

  function setStep(step) {
    state.step = Math.min(LAST, Math.max(0, step));
    applyStep(state.step);
  }

  function schedule() {
    clearTimeout(state.timer);
    if (!state.playing) return;
    if (state.step >= LAST) {
      // the walkthrough ends on its last step and stays there; it never replays by itself
      setPlaying(false);
      return;
    }
    state.timer = setTimeout(() => {
      setStep(state.step + 1);
      schedule();
    }, state.step === 0 ? HOLD * 0.6 : HOLD);
  }

  function setPlaying(playing) {
    state.playing = playing;
    host.querySelector('[data-mech="play"]').textContent = playing ? 'Pause' : 'Play';
    host.querySelector('[data-mech="play"]').classList.toggle('is-paused', !playing);
    schedule();
  }

  const MECH_ACTIONS = {
    play: () => {
      if (!state.playing && state.step >= LAST) setStep(0);
      setPlaying(!state.playing);
    },
    next: () => { setPlaying(false); setStep(state.step + 1); },
    prev: () => { setPlaying(false); setStep(state.step - 1); },
    restart: () => { setStep(0); setPlaying(true); },
  };

  let touched = false;
  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mech]');
    if (!button || !MECH_ACTIONS[button.dataset.mech]) return;
    touched = true;
    MECH_ACTIONS[button.dataset.mech]();
  });

  layoutLegend();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutLegend).catch(() => {});
  window.addEventListener('resize', layoutLegend);

  // The strip shares its URL with the <image> elements above, so this waits on the same single
  // request rather than making another one. Playing before it arrives would animate empty boxes.
  let spriteReady = false;
  let waitingToStart = false;
  const startWhenReady = () => {
    if (spriteReady) setPlaying(true);
    else waitingToStart = true;
  };
  const preload = new Image();
  preload.onload = () => {
    spriteReady = true;
    if (waitingToStart && !touched) {
      waitingToStart = false;
      setPlaying(true);
    }
  };
  preload.onerror = preload.onload;
  preload.src = SPRITE;

  if (reduced.matches) {
    setStep(LAST);
    setPlaying(false);
  } else {
    setStep(0);
    // Nothing runs until the panel is actually on screen, and it stops again when it leaves.
    if ('IntersectionObserver' in window) {
      let started = false;
      new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          // The callback can arrive after the first click, so a deliberate pause is never undone.
          if (entry.isIntersecting && !started && !touched) {
            started = true;
            startWhenReady();
          } else if (!entry.isIntersecting && state.playing) {
            setPlaying(false);
            waitingToStart = false;
            started = false;
          }
        });
        // the middle band of the viewport, so a diagram peeking in from the bottom while the
        // reader is still on the section above does not count as being looked at
      }, { threshold: 0.35, rootMargin: '-20% 0px -20% 0px' })
        .observe(host.querySelector('[data-mech-stage]'));
    } else {
      startWhenReady();
    }
  }
})();
