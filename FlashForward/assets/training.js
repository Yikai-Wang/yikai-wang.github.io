(() => {
  'use strict';

  // An animated walk through the two training phases, in the palette and vocabulary of the
  // paper's framework figure. The diagram is split into three scenes, one visible at a time, so
  // the active one always fits the window instead of running off the bottom of a tall canvas.

  const host = document.querySelector('[data-training]');
  if (!host) return;

  const NS = 'http://www.w3.org/2000/svg';
  const PT = 3.5278;

  const C = {
    anchor: '#B45309',
    anchorBg: '#FEF3C7',
    dense: '#2563B8',
    denseBg: '#E0F2FE',
    loss: '#BE123C',
    lossBg: '#FFF1F2',
    slate: '#475569',
    hairline: '#CBD5E1',
    maskAnc: '#FBDF93',
    maskDen: '#A8CFF0',
    drop: '#94A3B8',
  };

  // The 25 sampled frames of the example clip, one 180 x 2600 strip.
  const FRAMES = 'assets/training/frames.png';
  const FRAME_W = 180;
  const FRAME_H = 104;
  const FRAME_N = 25;

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach((k) => node.setAttribute(k, String(attrs[k])));
    return node;
  };
  const add = (parent, name, attrs) => parent.appendChild(el(name, attrs));
  const text = (parent, string, attrs) => {
    const node = add(parent, 'text', attrs);
    node.textContent = string;
    return node;
  };

  const HEAD_L = 5.2;
  const HEAD_W = 4.2;

  // Same construction as the mechanism panel: the shaft extends, then the head lands on it.
  function arrow(parent, x1, y1, x2, y2, { stroke = C.slate, width = 0.5 * PT, dash, cls = '' } = {}) {
    const g = add(parent, 'g', { class: `draw ${cls}`.trim() });
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const lx = x2 - ux * HEAD_L;
    const ly = y2 - uy * HEAD_L;
    const line = add(g, 'line', { class: 'line', x1, y1, x2: lx, y2: ly, stroke, 'stroke-width': width });
    if (dash) {
      line.setAttribute('stroke-dasharray', dash);
      line.classList.add('is-dashed');
    } else {
      line.setAttribute('pathLength', 1);
    }
    add(g, 'path', {
      class: 'head',
      fill: stroke,
      d: `M ${x2} ${y2} L ${lx - uy * HEAD_W / 2} ${ly + ux * HEAD_W / 2}`
        + ` L ${lx + uy * HEAD_W / 2} ${ly - ux * HEAD_W / 2} Z`,
    });
    return g;
  }

  // A latent: a rounded chip that can be anchor-coloured or renderer-coloured, clean or noised.
  function chip(parent, x, y, w, h, { role = 'anchor', cls = '' } = {}) {
    const g = add(parent, 'g', { class: `chip fade ${cls}`.trim() });
    const box = { x, y, width: w, height: h, rx: 2 };
    const body = add(g, 'rect', { ...box, class: 'chip-body' });
    const noise = add(g, 'rect', { ...box, class: 'chip-noise', fill: 'url(#tr-noise)' });
    g.dataset.role = role;
    return { g, body, noise, x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }

  const setRole = (c, role) => { c.g.dataset.role = role; };
  const setNoisy = (c, on) => c.g.classList.toggle('is-noisy', on);

  // ---------- scene plumbing ----------

  const stage = host.querySelector('[data-train-stage]');
  const scenes = [];
  const parts = [];

  let defsBuilt = false;
  function newScene(w, h, label, title) {
    // plain HTML, not add(): add() builds SVG-namespaced nodes, and an SVG <div> renders as nothing
    const part = document.createElement('div');
    part.className = 'train-part';
    stage.appendChild(part);
    parts.push(part);
    const heading = document.createElement('h3');
    heading.className = 'train-part-title';
    heading.textContent = title;
    part.appendChild(heading);
    const holder = document.createElement('div');
    holder.className = 'train-part-stage';
    part.appendChild(holder);
    const svg = el('svg', {
      viewBox: `0 0 ${w} ${h}`, class: 'train-svg', role: 'img', 'aria-label': label,
    });
    // The patterns and frame symbols are shared by every scene, so only the first one defines
    // them; ids must stay unique across the document.
    if (!defsBuilt) buildDefs(add(svg, 'defs'));
    holder.appendChild(svg);
    scenes.push(svg);
    return svg;
  }

  function buildDefs(defs) {
    defsBuilt = true;
    // Speckle that marks a latent as noised.
    const speckle = (id, background) => {
      const pat = add(defs, 'pattern', {
        id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)',
      });
      add(pat, 'rect', { width: 6, height: 6, fill: background });
      add(pat, 'line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#0f172a', 'stroke-width': 1.4, opacity: 0.30 });
    };
    speckle('tr-noise', 'none');
    speckle('tr-mask-anchor-noisy', C.maskAnc);
    speckle('tr-mask-dense-noisy', C.maskDen);
    // One symbol per sampled frame, cropped out of the single strip.
    for (let i = 0; i < FRAME_N; i += 1) {
      const sym = add(defs, 'symbol', {
        id: `tr-f${i}`, viewBox: `0 ${i * FRAME_H} ${FRAME_W} ${FRAME_H}`, preserveAspectRatio: 'none',
      });
      add(sym, 'image', {
        href: FRAMES, x: 0, y: 0, width: FRAME_W, height: FRAME_H * FRAME_N, preserveAspectRatio: 'none',
      });
    }
  }

  const frame = (parent, index, x, y, w, h, cls = '') => {
    const g = add(parent, 'g', { class: `frame ${cls}`.trim() });
    add(g, 'use', { href: `#tr-f${index}`, x, y, width: w, height: h });
    add(g, 'rect', { x, y, width: w, height: h, fill: 'none', class: 'frame-edge' });
    return g;
  };

  // ======================================================================
  // Scene 1 - building the packed training input
  // ======================================================================

  const S1W = 900;
  const S1H = 432;
  const s1 = newScene(S1W, S1H, 'Building the packed training input: frames, VAE, latents, and the '
    + 'packed sequence of clean anchors, noisy anchors and renderer latents.',
  '1 · Building the packed training input');

  const BLOCKS = 7;
  const PITCH = 56;
  const THUMB_W = 48;
  const THUMB_H = 28;
  const OFF = 3.2; // offset between stacked frames of one latent
  const LEFT_X = 40;
  const RIGHT_X = 490;
  const FRAME_Y = 76; // bottom edge of the front frame of a block
  const ANCHORS = [0, 3, 6]; // illustration only: blocks 1, 4 and 7 are the anchors

  // frame index of the j-th frame of block b (block 0 holds one frame, the rest hold four)
  const frameIndex = (b, j) => (b === 0 ? 0 : 1 + (b - 1) * 4 + j);

  function buildStrip(parent, x0, { dropFirst = false } = {}) {
    const blocks = [];
    for (let b = 0; b < BLOCKS; b += 1) {
      const count = b === 0 ? 1 : 4;
      const g = add(parent, 'g', { class: 'block fade' });
      const thumbs = [];
      for (let j = 0; j < count; j += 1) {
        const k = count - 1 - j; // k=0 is the front card
        const fx = x0 + b * PITCH + k * OFF;
        const fy = FRAME_Y - THUMB_H - k * OFF;
        thumbs.push(frame(g, frameIndex(b, j), fx, fy, THUMB_W, THUMB_H, 'fade on'));
      }
      blocks.push({ g, thumbs, b, x: x0 + b * PITCH, cx: x0 + b * PITCH + THUMB_W / 2 });
    }
    return blocks;
  }

  const leftBlocks = buildStrip(s1, LEFT_X);
  const rightBlocks = buildStrip(s1, RIGHT_X);

  const headLeft = text(s1, 'Real video', {
    x: LEFT_X, y: 26, class: 'h fade', fill: C.slate,
  });
  const headRight = text(s1, 'Same video, time-rebased', {
    x: RIGHT_X, y: 26, class: 'h fade', fill: C.slate,
  });
  const noteStride = text(s1, 'anchor stride shown for illustration only — not the stride we train with', {
    x: S1W / 2, y: 418, class: 'tny fade', fill: C.slate, 'text-anchor': 'middle',
  });

  // ----- VAE -----

  const vaeBox = (x0, cls) => {
    const g = add(s1, 'g', { class: `fade ${cls}`.trim() });
    const w = BLOCKS * PITCH - (PITCH - THUMB_W);
    add(g, 'rect', {
      x: x0, y: 108, width: w, height: 22, rx: 3,
      fill: '#fff', stroke: C.slate, 'stroke-width': 0.55 * PT,
    });
    text(g, 'causal VAE', {
      x: x0 + w / 2, y: 123, class: 'sm', fill: C.slate, 'text-anchor': 'middle',
    });
    return g;
  };
  const vaeLeft = vaeBox(LEFT_X, 'vae-left');
  const vaeRight = vaeBox(RIGHT_X, 'vae-right');

  const vaeArrowsLeft = leftBlocks.map((b) => arrow(s1, b.cx, 84, b.cx, 104, { width: 0.42 * PT }));
  const vaeArrowsRight = rightBlocks.map((b) => arrow(s1, b.cx, 84, b.cx, 104, { width: 0.42 * PT }));

  // ----- latents, one per block -----

  const LAT_W = 34;
  const LAT_H = 24;
  const LAT_Y = 150;

  const makeLatents = (blocks) => blocks.map((b, i) => {
    const c = chip(s1, b.cx - LAT_W / 2, LAT_Y, LAT_W, LAT_H, {
      role: ANCHORS.includes(i) ? 'anchor' : 'dense',
    });
    c.index = i;
    return c;
  });
  const latLeft = makeLatents(leftBlocks);
  const latRight = makeLatents(rightBlocks);
  const latArrowsLeft = leftBlocks.map((b) => arrow(s1, b.cx, 134, b.cx, LAT_Y - 4, { width: 0.42 * PT }));
  const latArrowsRight = rightBlocks.map((b) => arrow(s1, b.cx, 134, b.cx, LAT_Y - 4, { width: 0.42 * PT }));

  // ----- the three streams the left branch contributes -----

  const TOK_W = 26;
  const TOK_H = 24;
  const TOK_GAP = 3;
  const TOK_PITCH = TOK_W + TOK_GAP;
  const ROW_Y = 250;
  const AUG_KEEP = [1, 2, 3, 4, 5, 6]; // column 1 loses all its frames, so it has no latent
  const AUG_ANCHORS = [1, 4];

  const rowWidth = (n) => n * TOK_PITCH - TOK_GAP;

  function tokenRow(x0, n, role) {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      out.push(chip(s1, x0 + i * TOK_PITCH, ROW_Y, TOK_W, TOK_H, { role }));
    }
    out.x0 = x0;
    out.cx = x0 + rowWidth(n) / 2;
    return out;
  }

  const GROUP_GAP = 20;
  const g1x = LEFT_X;
  const g2x = g1x + rowWidth(3) + GROUP_GAP;
  const g3x = g2x + rowWidth(3) + GROUP_GAP;
  const cleanAnc = tokenRow(g1x, 3, 'anchor');
  const noisyAnc = tokenRow(g2x, 3, 'anchor');
  const rendToks = tokenRow(g3x, 7, 'anchor'); // recoloured to renderer in its own step

  // The rebased groups sit under the anchors they come from, in the middle of the right half.
  const rightSpan = (latRight[0].cx + latRight[BLOCKS - 1].cx) / 2;
  const augTotal = rowWidth(1) + GROUP_GAP + rowWidth(2);
  const g4x = rightSpan - augTotal / 2;
  const g5x = g4x + rowWidth(1) + GROUP_GAP;
  const augClean = tokenRow(g4x, 1, 'anchor');
  const augNoisy = tokenRow(g5x, 2, 'anchor');

  // Labels sit under their group: above the row they would sit in the path of the feed arrows.
  const groupLabel = (string, row) => text(s1, string, {
    x: row.cx, y: ROW_Y + TOK_H + 15, class: 'tny fade', fill: C.slate, 'text-anchor': 'middle',
  });
  const labClean = groupLabel('clean', cleanAnc);
  const labNoisy = groupLabel('noisy', noisyAnc);
  const labRend = groupLabel('renderer latents', rendToks);
  const labAugClean = groupLabel('clean', augClean);
  const labAugNoisy = groupLabel('noisy', augNoisy);

  // A gather bus rather than one arrow per latent: seven crossing diagonals into three groups is
  // unreadable, and they ran straight through the labels.
  const BUS_Y = 202;
  function busFor(sources, targets) {
    const xs = sources.map((s) => s.cx).concat(targets.map((t) => t.cx));
    const g = add(s1, 'g', { class: 'fade bus' });
    add(g, 'line', {
      x1: Math.min(...xs), y1: BUS_Y, x2: Math.max(...xs), y2: BUS_Y,
      stroke: C.hairline, 'stroke-width': 0.5 * PT, 'stroke-linecap': 'round',
    });
    sources.forEach((s) => add(g, 'line', {
      x1: s.cx, y1: s.y + s.h, x2: s.cx, y2: BUS_Y, stroke: C.hairline, 'stroke-width': 0.42 * PT,
    }));
    return g;
  }
  const busLeft = busFor(latLeft, [cleanAnc, noisyAnc, rendToks]);
  const busRight = busFor(AUG_ANCHORS.map((a) => latRight[a]), [augClean, augNoisy]);
  const drop = (row) => arrow(s1, row.cx, BUS_Y, row.cx, ROW_Y - 3, { width: 0.42 * PT, stroke: C.hairline });
  const dropClean = drop(cleanAnc);
  const dropNoisy = drop(noisyAnc);
  const dropRend = drop(rendToks);
  const dropAugClean = drop(augClean);
  const dropAugNoisy = drop(augNoisy);

  // ----- the packed sequence -----

  const PACK_Y = 340;
  const PACK_PLAN = [
    { n: 3, role: 'anchor', noisy: false, src: cleanAnc },
    { n: 3, role: 'anchor', noisy: true, src: noisyAnc },
    { n: 7, role: 'dense', noisy: true, src: rendToks },
    { n: 1, role: 'anchor', noisy: false, src: augClean },
    { n: 2, role: 'anchor', noisy: true, src: augNoisy },
  ];
  const PACK_N = PACK_PLAN.reduce((sum, g) => sum + g.n, 0);
  const packWidth = rowWidth(PACK_N) + (PACK_PLAN.length - 1) * 12;
  const packed = [];
  const packFeeds = [];
  let px = (S1W - packWidth) / 2;
  PACK_PLAN.forEach((group) => {
    const first = px;
    for (let i = 0; i < group.n; i += 1) {
      const c = chip(s1, px + i * TOK_PITCH, PACK_Y, TOK_W, TOK_H, { role: group.role });
      c.plan = group;
      packed.push(c);
    }
    px += rowWidth(group.n);
    // one arrow per group, not per token
    packFeeds.push(arrow(s1, group.src.cx, ROW_Y + TOK_H + 22, first + rowWidth(group.n) / 2, PACK_Y - 3,
      { width: 0.36 * PT, stroke: C.hairline }));
    px += 12;
  });
  const packLabel = text(s1, 'one packed sequence, one forward', {
    x: S1W / 2, y: PACK_Y + TOK_H + 18, class: 'lab fade', fill: C.slate, 'text-anchor': 'middle',
  });

  // ======================================================================
  // Scene 2 - one packed forward: the backbone, the mask, the loss
  // ======================================================================

  const S2W = 900;
  const S2H = 604;
  const s2 = newScene(S2W, S2H, 'One packed forward: the shared backbone with role embedding and '
    + 'LoRA adapters, the block attention mask over the packed sequence, and the flow matching loss.',
  '2 · Phase 1: one packed SFT forward');

  // ----- the packed sequence, carried over from scene 1 -----

  const P2_N = PACK_N;
  const p2Width = rowWidth(P2_N) + (PACK_PLAN.length - 1) * 12;
  const p2 = [];
  let p2x = (S2W - p2Width) / 2;
  PACK_PLAN.forEach((group) => {
    for (let i = 0; i < group.n; i += 1) {
      const c = chip(s2, p2x + i * TOK_PITCH, 36, TOK_W, TOK_H, { role: group.role });
      setNoisy(c, group.noisy);
      c.plan = group;
      p2.push(c);
    }
    p2x += rowWidth(group.n) + 12;
  });
  const p2Label = text(s2, 'packed sequence', {
    x: S2W / 2, y: 26, class: 'tny fade', fill: C.slate, 'text-anchor': 'middle',
  });

  // ----- (a) the shared backbone -----

  const MX = 56;
  const MW = 330;
  const model = {};
  const modelBox = (y, h, label, opts = {}) => {
    const g = add(s2, 'g', { class: 'fade' });
    add(g, 'rect', {
      x: MX + 10, y, width: MW - 20, height: h, rx: 2.4,
      fill: '#fff', stroke: opts.stroke || `${C.slate}bf`, 'stroke-width': 0.55 * PT,
    });
    text(g, label, {
      x: MX + MW / 2, y: y + h / 2 + 5, class: 'sm', fill: C.slate, 'text-anchor': 'middle',
    });
    return g;
  };

  model.emb = add(s2, 'g', { class: 'fade' });
  add(model.emb, 'rect', {
    x: MX, y: 104, width: MW, height: 24, rx: 2.4,
    fill: '#fff', stroke: C.slate, 'stroke-width': 0.55 * PT,
  });
  const embText = text(model.emb, 'timestep emb', {
    x: MX + MW / 2, y: 121, class: 'lab', fill: C.slate, 'text-anchor': 'middle',
  });
  model.embArrow = arrow(s2, MX + MW / 2, 130, MX + MW / 2, 146, { width: 0.42 * PT });

  model.shell = add(s2, 'g', { class: 'fade' });
  add(model.shell, 'rect', {
    x: MX, y: 150, width: MW, height: 148, rx: 3,
    fill: 'none', stroke: C.hairline, 'stroke-width': 0.5 * PT,
  });
  text(model.shell, 'shared DiT block', {
    x: MX + MW / 2, y: 167, class: 'tny', fill: C.slate, 'text-anchor': 'middle',
  });
  model.adaln = modelBox(174, 22, 'AdaLN');
  model.selfAttn = modelBox(204, 22, 'Self-Attn  Q, K, V, O');
  model.crossAttn = modelBox(234, 22, 'Cross-Attn  Q, O');
  model.ffn = modelBox(264, 22, 'FFN');

  // The two LoRA badges that give each role its own projection.
  const badge = (letter, x, y, colour) => {
    const g = add(s2, 'g', { class: 'fade badge' });
    add(g, 'rect', { x, y, width: 20, height: 20, rx: 4, fill: '#fff', stroke: colour, 'stroke-width': 0.5 * PT });
    text(g, letter, {
      x: x + 10, y: y + 10, class: 'tny bold', fill: colour,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
    });
    return g;
  };
  model.loras = [
    badge('P', MX + MW - 56, 205, C.anchor), badge('R', MX + MW - 33, 205, C.dense),
    badge('P', MX + MW - 56, 235, C.anchor), badge('R', MX + MW - 33, 235, C.dense),
  ];

  model.outArrow = arrow(s2, MX + MW / 2, 298, MX + 76, 316, { width: 0.42 * PT });
  model.outArrow2 = arrow(s2, MX + MW / 2, 298, MX + MW - 76, 316, { width: 0.42 * PT });
  const roleChip = (label, x, colour, bg) => {
    const g = add(s2, 'g', { class: 'fade' });
    add(g, 'rect', { x, y: 320, width: 132, height: 26, rx: 2.4, fill: bg, stroke: colour, 'stroke-width': 0.6 * PT });
    text(g, label, { x: x + 66, y: 338, class: 'lab bold', fill: colour, 'text-anchor': 'middle' });
    return g;
  };
  model.planner = roleChip('Planner', MX + 10, C.anchor, C.anchorBg);
  model.renderer = roleChip('Renderer', MX + MW - 142, C.dense, C.denseBg);

  const toModel = arrow(s2, 300, 66, MX + MW / 2, 100, { width: 0.42 * PT });

  // ----- (b) the block mask over the packed sequence -----

  const CELL = 18;
  const GX = 520;
  const GY = 150;
  const QX = GX - CELL - 6; // the query chips, down the left edge
  // Derived from PACK_PLAN rather than hard-coded offsets: the group sizes have changed once
  // already, and stale boundaries silently mislabel a token as clean when it is noised.
  const GROUP_OF = PACK_PLAN.flatMap((group, gi) => Array(group.n).fill(gi));
  const maskGroupOf = (i) => GROUP_OF[i];
  const isAnchorTok = (i) => PACK_PLAN[maskGroupOf(i)].role === 'anchor';

  const toMask = arrow(s2, 640, 66, GX + 13 * CELL, 120, { width: 0.42 * PT });
  const maskHead = text(s2, 'attention inside the packed forward', {
    x: 880, y: 26, class: 'tny fade', fill: C.slate, 'text-anchor': 'end',
  });

  const maskAxes = add(s2, 'g', { class: 'fade' });
  const miniChip = (parent, x, y, i) => {
    // the speckle is shown by the .is-noisy class, not by an opacity attribute: the stylesheet's
    // `.chip-noise { opacity: 0 }` outranks a presentation attribute and would hide it
    const noisy = PACK_PLAN[maskGroupOf(i)].noisy;
    const g = add(parent, 'g', {
      class: `chip${noisy ? ' is-noisy' : ''}`, 'data-role': isAnchorTok(i) ? 'anchor' : 'dense',
    });
    add(g, 'rect', { x, y, width: CELL - 3, height: CELL - 3, rx: 1.6, class: 'chip-body' });
    add(g, 'rect', { x, y, width: CELL - 3, height: CELL - 3, rx: 1.6, class: 'chip-noise', fill: 'url(#tr-noise)' });
    return g;
  };
  for (let i = 0; i < P2_N; i += 1) {
    miniChip(maskAxes, GX + i * CELL, GY - CELL - 4, i); // keys, across the top
    miniChip(maskAxes, QX, GY + i * CELL, i); // queries, down the side
  }
  text(maskAxes, 'key', { x: GX + P2_N * CELL / 2, y: GY - CELL - 10, class: 'tny', fill: C.slate, 'text-anchor': 'middle' });
  text(maskAxes, 'query', {
    x: 0, y: 0, class: 'tny', fill: C.slate, 'text-anchor': 'middle',
    transform: `translate(${QX - 10} ${GY + P2_N * CELL / 2}) rotate(-90)`,
  });

  const maskGrid = add(s2, 'g', { class: 'fade' });
  const cells2 = [];
  for (let q = 0; q < P2_N; q += 1) {
    cells2.push([]);
    for (let k = 0; k < P2_N; k += 1) {
      const rect = add(maskGrid, 'rect', {
        x: GX + k * CELL, y: GY + q * CELL, width: CELL, height: CELL,
        class: 'mask-cell', fill: '#fff', stroke: C.hairline, 'stroke-width': 0.8,
      });
      cells2[q].push(rect);
    }
  }

  // Who each query is allowed to see. Groups: 0 clean anchors, 1 noisy anchors,
  // 2 renderer latents, 3 rebased clean, 4 rebased noisy.
  const CA = [0, 1, 2];
  const NA = [3, 4, 5];
  const RD = [6, 7, 8, 9, 10, 11, 12];
  const RBC = [13];
  const RBN = [14, 15];
  const WINDOW = [[0, 1], [0, 1], [0, 1], [0, 1], [1, 2], [1, 2], [1, 2]]; // clean anchors each chunk sees
  const HISTORY = 3;

  function allowed(q) {
    if (CA.includes(q)) return CA.slice(0, CA.indexOf(q) + 1);
    if (NA.includes(q)) {
      const i = NA.indexOf(q);
      return CA.slice(0, i).concat([q]);
    }
    if (RD.includes(q)) {
      const j = RD.indexOf(q);
      return WINDOW[j].map((a) => CA[a]).concat(RD.slice(Math.max(0, j - HISTORY), j + 1));
    }
    if (RBC.includes(q)) return RBC.slice(0, RBC.indexOf(q) + 1);
    // a noisy rebased anchor sees the clean anchors before it, never its own clean copy
    return RBC.slice(0, RBN.indexOf(q)).concat([q]);
  }
  // Which reveal step lights a given cell.
  function cellStage(q, k) {
    if (CA.includes(q)) return 21;
    if (NA.includes(q)) return 22;
    if (RD.includes(q)) {
      if (CA.includes(k)) return RD.indexOf(q) <= 3 ? 23 : 24;
      return 25;
    }
    return 26;
  }
  const MASK_PLAN = [];
  for (let q = 0; q < P2_N; q += 1) {
    const keys = allowed(q);
    keys.forEach((k) => MASK_PLAN.push({
      q, k, stage: cellStage(q, k), anchor: isAnchorTok(k), noisy: PACK_PLAN[maskGroupOf(k)].noisy,
    }));
  }

  const windowNote = text(s2, 'sliding window — chunks 1–4: anchors 1, 4', {
    x: GX + P2_N * CELL / 2, y: GY + P2_N * CELL + 22, class: 'tny fade', fill: C.slate, 'text-anchor': 'middle',
  });
  const histNote = text(s2, 'chunks 5–7: anchors 4, 7, plus 3-chunk history (5 in model)', {
    x: GX + P2_N * CELL / 2, y: GY + P2_N * CELL + 44, class: 'tny fade', fill: C.slate, 'text-anchor': 'middle',
  });

  // ----- the loss -----

  const hatchNote = text(s2, 'solid = clean key · hatched = noised key', {
    x: GX + P2_N * CELL / 2, y: GY + P2_N * CELL + 66, class: 'tny fade', fill: C.slate, 'text-anchor': 'middle',
  });

  const lossG = add(s2, 'g', { class: 'fade' });
  add(lossG, 'rect', {
    x: 342, y: 536, width: 156, height: 28, rx: 3.5,
    fill: C.lossBg, stroke: C.loss, 'stroke-width': 0.65 * PT,
  });
  text(lossG, 'flow matching', { x: 420, y: 555, class: 'lab bold', fill: C.loss, 'text-anchor': 'middle' });
  const lossFromModel = arrow(s2, MX + MW / 2, 348, 388, 532, { width: 0.45 * PT });
  const lossFromMask = arrow(s2, GX + P2_N * CELL / 2, GY + P2_N * CELL + 78, 466, 532, { width: 0.45 * PT });

  // ======================================================================
  // Scene 3 - phase 2: self-rollout distillation
  // ======================================================================

  const S3W = 900;
  const S3H = 530;
  const s3 = newScene(S3W, S3H, 'Phase 2: the planner and renderer roll out the video themselves, '
    + 'the rollout is cut at re-encoded image heads, and distribution matching scores each piece.',
  '3 · Phase 2: self-rollout distillation');

  const ROLE_X = 40;
  const ROLL_X = 196;
  const PLAN_Y = 40;
  const REND_Y = 120;
  const CHUNK_W = 22;
  const CHUNK_GAP = 2.6;
  const CHUNK_PITCH = CHUNK_W + CHUNK_GAP;
  const GROUPS = 3;
  const PER_GROUP = 6;
  const groupSpan = PER_GROUP * CHUNK_PITCH;

  // A dashed elbow, so a gradient can run back up the free channel on the left instead of cutting
  // diagonally across everything between the loss and the roles.
  function elbow(parent, points, { stroke, width, dash }) {
    const g = add(parent, 'g', { class: 'draw' });
    const d = points.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
    const line = add(g, 'path', {
      class: 'line', d, fill: 'none', stroke, 'stroke-width': width, 'stroke-linejoin': 'round',
    });
    if (dash) {
      line.setAttribute('stroke-dasharray', dash);
      line.classList.add('is-dashed');
    } else {
      line.setAttribute('pathLength', 1);
    }
    const [a, b] = points.slice(-2);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    add(g, 'path', {
      class: 'head', fill: stroke,
      d: `M ${b[0]} ${b[1]} L ${b[0] - ux * HEAD_L - uy * HEAD_W / 2} ${b[1] - uy * HEAD_L + ux * HEAD_W / 2}`
        + ` L ${b[0] - ux * HEAD_L + uy * HEAD_W / 2} ${b[1] - uy * HEAD_L - ux * HEAD_W / 2} Z`,
    });
    return g;
  }

  const roleTag = (label, y, colour, bg) => {
    const g = add(s3, 'g', { class: 'fade' });
    add(g, 'rect', { x: ROLE_X, y, width: 112, height: 26, rx: 2.4, fill: bg, stroke: colour, 'stroke-width': 0.6 * PT });
    text(g, label, { x: ROLE_X + 56, y: y + 18, class: 'lab bold', fill: colour, 'text-anchor': 'middle' });
    return g;
  };
  const tagPlanner = roleTag('Planner', PLAN_Y, C.anchor, C.anchorBg);
  const tagRenderer = roleTag('Renderer', REND_Y, C.dense, C.denseBg);

  // ----- the planner's own rollout -----

  const planGroups = [];
  const arArrows = [];
  for (let g = 0; g < GROUPS; g += 1) {
    const gx = ROLL_X + g * groupSpan;
    const node = add(s3, 'g', { class: 'fade' });
    for (let i = 0; i < 3; i += 1) {
      add(node, 'circle', {
        cx: gx + 18 + i * 26, cy: PLAN_Y + 13, r: 9.5,
        fill: C.anchorBg, stroke: C.anchor, 'stroke-width': 0.55 * PT,
      });
    }
    planGroups.push({ node, cx: gx + 44, left: gx + 8.5, right: gx + 79.5 });
  }
  const detachMarks = [];
  for (let g = 1; g < GROUPS; g += 1) {
    // the planner is autoregressive, so the intervals are joined by a plain arrow; the // that
    // stops a gradient is drawn on top of it only when a gradient actually arrives
    const from = planGroups[g - 1].right + 5;
    const to = planGroups[g].left - 5;
    arArrows.push(arrow(s3, from, PLAN_Y + 13, to, PLAN_Y + 13, { stroke: C.anchor, width: 0.5 * PT }));
    const mid = (from + to) / 2;
    const mark = add(s3, 'g', { class: 'fade' });
    [0, 6].forEach((o) => add(mark, 'line', {
      x1: mid + o - 4, y1: PLAN_Y + 21, x2: mid + o + 4, y2: PLAN_Y + 5,
      stroke: C.loss, 'stroke-width': 0.62 * PT,
    }));
    detachMarks.push(mark);
  }

  // ----- the renderer's rollout -----

  const chunks = [];
  for (let i = 0; i < GROUPS * PER_GROUP; i += 1) {
    const x = ROLL_X + i * CHUNK_PITCH;
    const g = add(s3, 'g', { class: 'fade' });
    add(g, 'rect', {
      x, y: REND_Y, width: CHUNK_W, height: 26, rx: 1.6,
      fill: C.denseBg, stroke: C.dense, 'stroke-width': 0.5 * PT,
    });
    chunks.push({ g, x, cx: x + CHUNK_W / 2 });
  }
  const rollEnd = ROLL_X + GROUPS * groupSpan - CHUNK_GAP;

  const fwdArrows = planGroups.map((g, i) => arrow(s3, g.cx,
    PLAN_Y + 28, ROLL_X + (i * PER_GROUP + PER_GROUP / 2) * CHUNK_PITCH - CHUNK_GAP / 2, REND_Y - 5,
    { stroke: C.anchor, width: 0.5 * PT }));

  // ----- decode the head of the rollout, re-encode two frames as image heads -----

  const DET_Y = 200;
  const BRACKET_CX = ROLL_X + (12 * CHUNK_PITCH - CHUNK_GAP) / 2;
  const detour = add(s3, 'g', { class: 'fade' });
  const cutAt = [PER_GROUP - 1, 2 * PER_GROUP - 1]; // the two split points inside the first twelve
  add(detour, 'path', {
    d: `M ${ROLL_X} ${REND_Y + 32} L ${ROLL_X} ${REND_Y + 40}`
      + ` L ${ROLL_X + 12 * CHUNK_PITCH - CHUNK_GAP} ${REND_Y + 40}`
      + ` L ${ROLL_X + 12 * CHUNK_PITCH - CHUNK_GAP} ${REND_Y + 32}`,
    fill: 'none', stroke: C.hairline, 'stroke-width': 0.5 * PT,
  });

  const plainBox = (parent, x, w, label) => {
    add(parent, 'rect', {
      x, y: DET_Y, width: w, height: 28, rx: 2.4, fill: '#fff', stroke: C.slate, 'stroke-width': 0.55 * PT,
    });
    text(parent, label, { x: x + w / 2, y: DET_Y + 19, class: 'tny', fill: C.slate, 'text-anchor': 'middle' });
  };
  plainBox(detour, BRACKET_CX - 59, 118, 'VAE decoder');
  // the two frames the split points land on, taken straight from the clip
  const detFrames = [0, 1].map((i) => {
    const fx = BRACKET_CX + 84 + i * 58;
    const g = add(detour, 'g', { class: 'frame' });
    add(g, 'use', { href: `#tr-f${i === 0 ? 11 : 17}`, x: fx, y: DET_Y - 1, width: 52, height: 30 });
    add(g, 'rect', { x: fx, y: DET_Y - 1, width: 52, height: 30, fill: 'none', class: 'frame-edge' });
    return g;
  });
  plainBox(detour, BRACKET_CX + 218, 118, 'VAE encoder');
  const headChips = [0, 1].map((i) => {
    const g = add(detour, 'g');
    add(g, 'rect', {
      x: BRACKET_CX + 366 + i * 30, y: DET_Y, width: CHUNK_W, height: 28, rx: 1.6,
      fill: '#CBD5E1', stroke: '#94A3B8', 'stroke-width': 0.5 * PT,
    });
    return g;
  });
  text(detour, 'image heads', { x: BRACKET_CX + 430, y: DET_Y + 19, class: 'tny', fill: C.slate, 'text-anchor': 'start' });
  arrow(detour, BRACKET_CX, REND_Y + 62, BRACKET_CX, DET_Y - 5, { width: 0.42 * PT, cls: 'on' });
  arrow(detour, BRACKET_CX + 63, DET_Y + 14, BRACKET_CX + 78, DET_Y + 14, { width: 0.42 * PT, cls: 'on' });
  arrow(detour, BRACKET_CX + 200, DET_Y + 14, BRACKET_CX + 214, DET_Y + 14, { width: 0.42 * PT, cls: 'on' });
  arrow(detour, BRACKET_CX + 340, DET_Y + 14, BRACKET_CX + 360, DET_Y + 14, { width: 0.42 * PT, cls: 'on' });

  // ----- the rollout, split into three scored pieces -----

  const PIECE_Y = 296;
  const pieces = [];
  let pxCursor = ROLL_X;
  for (let g = 0; g < GROUPS; g += 1) {
    const node = add(s3, 'g', { class: 'fade' });
    const start = pxCursor;
    if (g > 0) {
      add(node, 'rect', {
        x: pxCursor, y: PIECE_Y, width: CHUNK_W, height: 26, rx: 1.6,
        fill: '#CBD5E1', stroke: '#94A3B8', 'stroke-width': 0.5 * PT,
      });
      pxCursor += CHUNK_PITCH;
    }
    for (let i = 0; i < PER_GROUP; i += 1) {
      add(node, 'rect', {
        x: pxCursor, y: PIECE_Y, width: CHUNK_W, height: 26, rx: 1.6,
        fill: C.denseBg, stroke: C.dense, 'stroke-width': 0.5 * PT,
      });
      pxCursor += CHUNK_PITCH;
    }
    const end = pxCursor - CHUNK_GAP;
    pieces.push({ node, cx: (start + end) / 2, start, end });
    pxCursor += 30;
  }
  const headToPiece = [1, 2].map((g) => arrow(s3, BRACKET_CX + 377 + (g - 1) * 30, DET_Y + 32,
    pieces[g].start + CHUNK_W / 2, PIECE_Y - 5, { width: 0.4 * PT, stroke: C.hairline }));

  // ----- scoring -----

  const BUS_Y3 = 348;
  const scoreBus = add(s3, 'g', { class: 'fade' });
  add(scoreBus, 'line', {
    x1: pieces[0].cx, y1: BUS_Y3, x2: pieces[GROUPS - 1].cx, y2: BUS_Y3,
    stroke: C.hairline, 'stroke-width': 0.5 * PT, 'stroke-linecap': 'round',
  });
  pieces.forEach((p) => add(scoreBus, 'line', {
    x1: p.cx, y1: PIECE_Y + 26, x2: p.cx, y2: BUS_Y3, stroke: C.hairline, 'stroke-width': 0.42 * PT,
  }));

  const scoreChip = (label, x) => {
    const g = add(s3, 'g', { class: 'fade' });
    add(g, 'rect', { x, y: 378, width: 116, height: 28, rx: 2.4, fill: '#fff', stroke: C.slate, 'stroke-width': 0.55 * PT });
    text(g, label, { x: x + 58, y: 397, class: 'lab bold', fill: C.slate, 'text-anchor': 'middle' });
    return { g, cx: x + 58 };
  };
  const realChip = scoreChip('real', 300);
  const fakeChip = scoreChip('fake', 486);
  const toReal = arrow(s3, realChip.cx, BUS_Y3, realChip.cx, 374, { width: 0.45 * PT, stroke: C.hairline });
  const toFake = arrow(s3, fakeChip.cx, BUS_Y3, fakeChip.cx, 374, { width: 0.45 * PT, stroke: C.hairline });

  const dmdG = add(s3, 'g', { class: 'fade' });
  add(dmdG, 'rect', {
    x: 339, y: 448, width: 228, height: 30, rx: 3.5,
    fill: C.lossBg, stroke: C.loss, 'stroke-width': 0.65 * PT,
  });
  text(dmdG, 'distribution matching', {
    x: 453, y: 468, class: 'lab bold', fill: C.loss, 'text-anchor': 'middle',
  });
  const realToDmd = arrow(s3, realChip.cx, 410, 428, 444, { width: 0.45 * PT });
  const fakeToDmd = arrow(s3, fakeChip.cx, 410, 478, 444, { width: 0.45 * PT });

  // ----- gradients, up the free channel on the left -----

  const gradRenderer = elbow(s3, [[335, 458], [184, 458], [184, REND_Y + 13], [ROLL_X - 6, REND_Y + 13]],
    { stroke: C.loss, width: 0.6 * PT, dash: '5 3.5' });
  const gradPlanner = planGroups.map((g, i) => arrow(s3,
    ROLL_X + (i * PER_GROUP + PER_GROUP / 2) * CHUNK_PITCH + 12, REND_Y - 5,
    g.cx + 12, PLAN_Y + 28, { stroke: C.loss, width: 0.55 * PT, dash: '5 3.5' }));
  const gradNote = text(s3, 'the planner chain is detached between blocks; within the renderer, gradients still flow from later to earlier chunks', {
    x: S3W / 2, y: 512, class: 'tny fade', fill: C.slate, 'text-anchor': 'middle',
  });
  // ======================================================================
  // Storyboard
  // ======================================================================

  const show = (node, on) => (node.classList ? node : node.g).classList.toggle('on', on);
  const showAll = (list, on) => list.forEach((n) => show(n, on));

  const STEPS = [
    { caption: '' },
    { caption: 'A real clip: the first latent covers one frame, every later latent covers four.' },
    { caption: 'Blocks 1, 4 and 7 are the anchors — a short stride, drawn only to keep the figure readable.' },
    { caption: 'One causal VAE encodes the clip.' },
    { caption: 'Seven latents: three anchors, four in between.' },
    { caption: 'The anchors are packed together twice: one clean copy…' },
    { caption: '…and one noisy copy. The planner learns to denoise anchors against clean history.' },
    { caption: 'The renderer stream takes every latent, anchors included, as ordinary chunks…' },
    { caption: '…and all of them are noised.' },
    { caption: 'Time rebasing: the same clip again, with the first frame dropped…' },
    { caption: '…and three more, so the second block collapses to a single image frame.' },
    { caption: 'The same VAE re-encodes it, on a different frame phase.' },
    { caption: 'Its renderer latents are thrown away; only two anchors survive.' },
    { caption: 'One clean copy of the first rebased anchor, and a noisy copy of each of the two.' },
    { caption: 'Everything concatenates into one packed sequence — sixteen latents, one forward.' },
    { caption: 'That sequence is what the backbone sees.' },
    { caption: 'A standard DiT block: AdaLN, self-attention, cross-attention, FFN.' },
    { caption: 'A role embedding rides along with the timestep, telling each latent which role it is in.' },
    { caption: 'Token-routed LoRA gives the planner and the renderer their own projections.' },
    { caption: 'One backbone, two roles — and a single set of shared weights underneath.' },
    { caption: 'The same sequence indexes an attention mask: queries down, keys across.' },
    { caption: 'A clean anchor attends to itself and to the clean anchors before it.' },
    { caption: 'A noisy anchor attends to the clean anchors before it — never to its own clean copy.' },
    { caption: 'Renderer chunks 1–4 read the clean anchors that bracket them: anchors 1 and 4.' },
    { caption: 'Chunks 5–7 read the next window: anchors 4 and 7. That is the sliding window.' },
    { caption: 'Each renderer chunk also reads its recent same-stage noisy history (three chunks here; up to five in the model), and itself.' },
    { caption: 'The rebased sample is packed alongside but never attends across to the first one.' },
    { caption: 'Both roles are supervised by one flow matching loss, in one backward pass.' },
    { caption: 'Phase 2: both roles keep running, but there is no real video left to read.' },
    { caption: 'The planner samples its first three anchors.' },
    { caption: 'It plans the next anchors, reading the clean KV of the blocks before it.' },
    { caption: 'The planner finishes the whole anchor rollout before any chunk is rendered.' },
    { caption: 'The renderer then denoises every chunk in one block-causal forward per stage: a long video the student produced entirely by itself.' },
    { caption: 'The first twelve latents are decoded; the frames at the split points are re-encoded on their own into image heads.' },
    { caption: 'The rollout splits into score-window pieces (three here; four tiles in the model), each later piece starting from an image head.' },
    { caption: 'Every piece is scored by the real model and by the fake model.' },
    { caption: 'Distribution matching turns the gap between the two scores into the distillation gradient.' },
    { caption: 'It flows back into the renderer…' },
    { caption: '…and from the renderer into the planner — and no further: the // stops it at each interval boundary.' },
  ];
  const LAST = STEPS.length - 1;

  // Each part is its own walkthrough, so its block is applied from its own local step.
  // OFFSET turns a local step back into the global numbering the blocks were written in.
  const OFFSET = [0, 14, 27];
  const PART_LAST = [14, 13, 11];
  const CAPTIONS = [
    STEPS.slice(0, 15).map((s) => s.caption),
    [''].concat(STEPS.slice(15, 28).map((s) => s.caption)),
    [''].concat(STEPS.slice(28).map((s) => s.caption)),
  ];

  function applyPart0(local) {
    const step = local === 0 ? OFFSET[0] : OFFSET[0] + local;
    show(headLeft, step >= 1);
    showAll(leftBlocks.map((b) => b.g), step >= 1);
    show(noteStride, step >= 2);
    latLeft.forEach((c, i) => setRole(c, ANCHORS.includes(i) ? 'anchor' : 'dense'));
    leftBlocks.forEach((b, i) => {
      b.g.classList.toggle('is-anchor', step >= 2 && ANCHORS.includes(i));
      b.g.classList.toggle('is-dense', step >= 2 && !ANCHORS.includes(i));
    });

    showAll(vaeArrowsLeft, step >= 3);
    show(vaeLeft, step >= 3);
    showAll(latArrowsLeft, step >= 4);
    showAll(latLeft, step >= 4);

    show(busLeft, step >= 5);
    show(dropClean, step >= 5);
    showAll(cleanAnc, step >= 5);
    show(labClean, step >= 5);
    show(dropNoisy, step >= 6);
    showAll(noisyAnc, step >= 6);
    show(labNoisy, step >= 6);
    noisyAnc.forEach((c) => setNoisy(c, step >= 6));

    show(dropRend, step >= 7);
    showAll(rendToks, step >= 7);
    show(labRend, step >= 7);
    // anchors stay anchor-coloured until they are recoloured as ordinary chunks
    rendToks.forEach((c, i) => {
      setRole(c, step >= 8 || !ANCHORS.includes(i) ? 'dense' : 'anchor');
      setNoisy(c, step >= 8);
    });

    // ----- the rebased branch -----
    show(headRight, step >= 9);
    showAll(rightBlocks.map((b) => b.g), step >= 9);
    rightBlocks.forEach((b, i) => {
      b.g.classList.toggle('is-anchor', step >= 9 && AUG_ANCHORS.includes(i));
      b.g.classList.toggle('is-dense', step >= 9 && AUG_KEEP.includes(i) && !AUG_ANCHORS.includes(i));
    });
    // step 9 drops the single first frame, step 10 the three that leave block 2 with one image
    rightBlocks[0].thumbs.forEach((t) => t.classList.toggle('is-dropped', step >= 9));
    rightBlocks[1].thumbs.forEach((t, j) => t.classList.toggle('is-dropped', step >= 10 && j < 3));

    // the block time rebasing drops feeds nothing into the VAE
    vaeArrowsRight.forEach((a, i) => show(a, step >= 11 && i > 0));
    show(vaeRight, step >= 11);
    showAll(latArrowsRight, step >= 11);
    latRight.forEach((c, i) => {
      show(c, step >= 11 && AUG_KEEP.includes(i) && (step < 12 || AUG_ANCHORS.includes(i)));
      setRole(c, AUG_ANCHORS.includes(i) ? 'anchor' : 'dense');
    });
    latArrowsRight.forEach((a, i) => show(a,
      step >= 11 && AUG_KEEP.includes(i) && (step < 12 || AUG_ANCHORS.includes(i))));

    show(busRight, step >= 13);
    show(dropAugClean, step >= 13);
    showAll(augClean, step >= 13);
    show(labAugClean, step >= 13);
    show(dropAugNoisy, step >= 13);
    showAll(augNoisy, step >= 13);
    show(labAugNoisy, step >= 13);
    augNoisy.forEach((c) => setNoisy(c, step >= 13));

    showAll(packFeeds, step >= 14);
    packed.forEach((c) => {
      show(c, step >= 14);
      setRole(c, c.plan.role);
      setNoisy(c, c.plan.noisy);
    });
    show(packLabel, step >= 14);

  }

  function applyPart1(local) {
    const step = local === 0 ? OFFSET[1] : OFFSET[1] + local;
    show(p2Label, step >= 15);
    showAll(p2, step >= 15);
    show(toModel, step >= 16);
    show(model.emb, step >= 16);
    show(model.embArrow, step >= 16);
    show(model.shell, step >= 16);
    show(model.adaln, step >= 16);
    show(model.selfAttn, step >= 16);
    show(model.crossAttn, step >= 16);
    show(model.ffn, step >= 16);
    embText.textContent = step >= 17 ? 'timestep emb  +  role emb' : 'timestep emb';
    showAll(model.loras, step >= 18);
    show(model.outArrow, step >= 19);
    show(model.outArrow2, step >= 19);
    show(model.planner, step >= 19);
    show(model.renderer, step >= 19);

    show(toMask, step >= 20);
    show(maskHead, step >= 20);
    show(maskAxes, step >= 20);
    show(maskGrid, step >= 20);
    cells2.forEach((row) => row.forEach((cell) => cell.classList.remove('is-on', 'is-dense', 'is-noisy')));
    MASK_PLAN.forEach((m) => {
      if (step < m.stage) return;
      const cell = cells2[m.q][m.k];
      cell.classList.add('is-on');
      cell.classList.toggle('is-dense', !m.anchor);
      cell.classList.toggle('is-noisy', m.noisy);
    });
    show(windowNote, step >= 24);
    show(hatchNote, step >= 22);
    show(histNote, step >= 25);
    show(lossFromModel, step >= 27);
    show(lossFromMask, step >= 27);
    show(lossG, step >= 27);

  }

  function applyPart2(local) {
    const step = local === 0 ? OFFSET[2] : OFFSET[2] + local;
    show(tagPlanner, step >= 28);
    show(tagRenderer, step >= 28);
    planGroups.forEach((g, i) => show(g.node, step >= 29 + i));
    arArrows.forEach((a, i) => show(a, step >= 30 + i));
    // The planner rolls out every anchor first; the renderer only starts once they all exist.
    showAll(fwdArrows, step >= 32);
    showAll(chunks.map((c) => c.g), step >= 32);
    show(detour, step >= 33);
    showAll(pieces.map((p) => p.node), step >= 34);
    showAll(headToPiece, step >= 34);
    show(scoreBus, step >= 35);
    show(toReal, step >= 35);
    show(toFake, step >= 35);
    show(realChip, step >= 35);
    show(fakeChip, step >= 35);
    show(dmdG, step >= 36);
    show(realToDmd, step >= 36);
    show(fakeToDmd, step >= 36);
    show(gradRenderer, step >= 37);
    showAll(gradPlanner, step >= 38);
    showAll(detachMarks, step >= 38);
    show(gradNote, step >= 38);

  }

  const APPLY = [applyPart0, applyPart1, applyPart2];
  // ---------- one independent player per part ----------

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const HOLD = 1500;

  let ready = false;
  const players = parts.map((part, i) => {
    const last = PART_LAST[i];
    const bar = document.createElement('div');
    bar.className = 'mech-bar train-bar';
    bar.innerHTML = `
      <div class="mech-actions">
        <button type="button" class="pill" data-act="restart">Restart</button>
        <button type="button" class="pill" data-act="prev" aria-label="Back one step">Back</button>
        <button type="button" class="pill" data-act="play">Play</button>
        <button type="button" class="pill" data-act="next" aria-label="Next step">Next</button>
        <output class="mech-step" aria-label="Step">0 / ${last}</output>
      </div>
      <p class="mech-caption" aria-live="polite"></p>`;
    part.appendChild(bar);

    const player = {
      i,
      last,
      step: 0,
      playing: false,
      timer: 0,
      done: false,
      held: false, // set only by an explicit Pause
      visible: false,
      stepOut: bar.querySelector('.mech-step'),
      caption: bar.querySelector('.mech-caption'),
      playButton: bar.querySelector('[data-act="play"]'),
    };

    player.setStep = (step) => {
      player.step = Math.min(last, Math.max(0, step));
      APPLY[i](player.step);
      player.stepOut.textContent = `${player.step} / ${last}`;
      player.caption.textContent = CAPTIONS[i][player.step] || '';
    };

    player.setPlaying = (playing) => {
      player.playing = playing;
      player.playButton.textContent = playing ? 'Pause' : 'Play';
      player.playButton.classList.toggle('is-paused', !playing);
      player.schedule();
    };

    player.schedule = () => {
      clearTimeout(player.timer);
      if (!player.playing) return;
      if (player.step >= last) {
        // a part ends on its last step and stays there; it never replays by itself
        player.done = true;
        player.setPlaying(false);
        return;
      }
      player.timer = setTimeout(() => {
        player.setStep(player.step + 1);
        player.schedule();
      }, player.step === 0 ? HOLD * 0.5 : HOLD);
    };

    const ACTIONS = {
      play: () => {
        player.held = player.playing;
        if (!player.playing && player.step >= last) player.setStep(0);
        player.setPlaying(!player.playing);
      },
      next: () => { player.setPlaying(false); player.setStep(player.step + 1); },
      prev: () => { player.setPlaying(false); player.setStep(player.step - 1); },
      restart: () => { player.setStep(0); player.setPlaying(true); },
    };
    bar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-act]');
      if (button && ACTIONS[button.dataset.act]) ACTIONS[button.dataset.act]();
    });

    player.autoStart = () => {
      if (player.held || player.done || player.playing || !ready || !player.visible) return;
      if (player.step >= last) return;
      player.setPlaying(true);
    };

    player.setStep(0);
    return player;
  });

  // The strip is one request shared by all three parts; nothing plays before it lands.
  const preload = new Image();
  preload.onload = () => {
    ready = true;
    players.forEach((p) => p.autoStart());
  };
  preload.onerror = preload.onload;
  preload.src = FRAMES;

  if (reduced.matches) {
    players.forEach((p) => p.setStep(p.last));
  } else if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const player = players[parts.indexOf(entry.target)];
        if (!player) return;
        player.visible = entry.isIntersecting;
        if (entry.isIntersecting) player.autoStart();
        else if (player.playing) player.setPlaying(false);
      });
      // the middle band of the viewport, so a diagram peeking in from the bottom while the
      // reader is still on the part above it does not count as being looked at
    }, { threshold: 0.35, rootMargin: '-20% 0px -20% 0px' });
    parts.forEach((part) => observer.observe(part));
  } else {
    players.forEach((p) => p.setPlaying(true));
  }
})();
