/* Section 05 · Results: native SVG charts and diagrams, drawn once in init() from the paper's numbers
   (main.tex, Tab. generation-time, Tab. vbench, Tab. vbench-long), then animated per build. */
(() => {
  'use strict';

  const S = (tag, attrs, kids) => FF.svg(tag, attrs, kids);
  const add = (parent, tag, attrs, kids) => parent.appendChild(S(tag, attrs, kids));
  const rect = (p, x, y, w, h, cls, extra) => add(p, 'rect', { x, y, width: w, height: h, class: cls, ...extra });
  const text = (p, x, y, str, cls, extra) => add(p, 'text', { x, y, class: cls, ...extra, text: str });
  const tspan = (str, cls, extra) => S('tspan', { class: cls, ...extra, text: str });
  const line = (p, x1, y1, x2, y2, cls, extra) => add(p, 'line', { x1, y1, x2, y2, class: cls, ...extra });
  const group = (p, attrs) => add(p, 'g', attrs || {});
  const fmt2 = (v) => v.toFixed(2);

  // Filled triangular arrow head with its tip at (x, y), pointing along angle (radians).
  const head = (p, x, y, ang, cls, size = 14) => {
    const w = size * 0.62;
    const bx = x - Math.cos(ang) * size;
    const by = y - Math.sin(ang) * size;
    const nx = -Math.sin(ang) * w;
    const ny = Math.cos(ang) * w;
    return add(p, 'path', { class: cls, d: `M${x},${y} L${bx + nx},${by + ny} L${bx - nx},${by - ny} Z` });
  };

  const textWidth = (node, fallbackChars, size) => {
    try {
      const w = node.getComputedTextLength();
      if (w > 0) return w;
    } catch (e) { /* not rendered yet */ }
    return fallbackChars * size * 0.56;
  };

  const fadeSet = (nodes, on) => nodes.forEach((n) => n.classList.toggle('on', on));

  /* =====================================================================
     s-training: shared backbone + two phases
     ===================================================================== */

  const FRAMES = '../../FlashForward/assets/training/frames.png'; // 25 frames, 180 x 104 each, stacked vertically
  const STRIP = (i) => `media/strip/bear-c${String(i).padStart(2, '0')}.jpg`;

  const sprite = (p, x, y, w, h, idx) => {
    const box = add(p, 'svg', { x, y, width: w, height: h, viewBox: `0 ${idx * 104} 180 104`, preserveAspectRatio: 'xMidYMid slice' });
    add(box, 'image', { href: FRAMES, x: 0, y: 0, width: 180, height: 2600 });
    return box;
  };

  const disc = (p, cx, cy, n) => {
    add(p, 'circle', { cx, cy, r: 25, class: 'tr-disc' });
    text(p, cx, cy + 10, n, 't-white t-b', { 'text-anchor': 'middle', 'font-size': 28 });
  };

  function buildTraining(slide) {
    const svg = slide.querySelector('.tr-svg');
    if (!svg || svg.childNodes.length) return;

    // ---- Step 0: the shared backbone and its two role adapters (x 0..430; centred while alone)
    const g0 = group(svg, { class: 'tr-base tr-solo' });
    slide._trBase = g0;
    rect(g0, 0, 96, 430, 262, 'f-slate', { rx: 22 });
    text(g0, 215, 162, 'Wan2.1-T2V-1.3B', 't-white t-b', { 'text-anchor': 'middle', 'font-size': 36 });
    text(g0, 215, 204, 'one shared backbone', 't-white', { 'text-anchor': 'middle', 'font-size': 26, opacity: 0.85 });
    for (let i = 0; i < 4; i += 1) rect(g0, 40, 238 + i * 26, 350, 14, 'tr-layer', { rx: 7 });

    text(g0, 215, 404, '+', 't-slate t-b', { 'text-anchor': 'middle', 'font-size': 44 });

    const badge = (y, cls, title, tcls, dense) => {
      rect(g0, 0, y, 430, 108, cls, { rx: 16 });
      text(g0, 28, y + 46, title, `${tcls} t-b`, { 'font-size': 32 });
      text(g0, 28, y + 86, 'role embedding + LoRA', tcls, { 'font-size': 26 });
      // Glyph: sparse anchors for the planner, dense chunks for the renderer.
      const gx = 330;
      for (let i = 0; i < 3; i += 1) {
        const x = dense ? gx + i * 26 : gx + i * 34;
        rect(g0, x - (dense ? 0 : 6), y + 26, 22, 22, dense ? 'f-ours' : 'f-anchor', { rx: 4 });
      }
    };
    badge(428, 'tr-badge-p', 'planner', 't-anchor', false);
    badge(556, 'tr-badge-r', 'renderer', 't-ours', true);
    text(g0, 215, 708, 'LoRA rank 256 per role', 't-mut', { 'text-anchor': 'middle', 'font-size': 26 });

    // ---- Step 1: phase 1 card (x 500..1700, y 0..340)
    const g1 = group(svg, { 'data-step': '1', class: 'tr-p1' });
    const cx = 500;
    add(g1, 'path', { class: 'tr-link', d: 'M430,227 H462 V170 H486' });
    head(g1, 498, 170, 0, 'tr-head', 16);
    rect(g1, cx, 0, 1200, 340, 'tr-card', { rx: 20 });
    disc(g1, cx + 62, 58, '1');
    text(g1, cx + 104, 70, 'Learn both roles from real videos', 't-b', { 'font-size': 36 });
    text(g1, cx + 104, 112, '256K clips · 1,800 steps · batch 128', 't-mut', { 'font-size': 28 });

    // Film strip of one real training clip.
    const fx = cx + 40;
    rect(g1, fx, 138, 858, 96, 'tr-film', { rx: 8 });
    for (let i = 0; i < 42; i += 1) {
      rect(g1, fx + 10 + i * 20.2, 144, 10, 7, 'tr-hole', { rx: 2 });
      rect(g1, fx + 10 + i * 20.2, 221, 10, 7, 'tr-hole', { rx: 2 });
    }
    [0, 3, 7, 10, 14, 17, 21, 24].forEach((idx, k) => sprite(g1, fx + 7 + k * 106, 157, 100, 58, idx));

    // One packed training sequence: planner anchors + renderer chunks.
    rect(g1, fx, 258, 858, 68, 'tr-seq', { rx: 14 });
    for (let i = 0; i < 3; i += 1) rect(g1, fx + 18 + i * 50, 272, 40, 40, 'f-anchor', { rx: 6 });
    for (let i = 0; i < 13; i += 1) rect(g1, fx + 196 + i * 50, 272, 40, 40, 'f-ours', { rx: 6 });
    rect(g1, fx + 22, 244, 290, 28, 'tr-card');
    text(g1, fx + 34, 266, 'one packed sequence', 't-mut', { 'font-size': 26 });

    // Time rebasing: the same ruler, cropped from a random start offset.
    const rx0 = cx + 944;
    text(g1, rx0, 170, 'time rebasing', 't-anchor t-b', { 'font-size': 28 });
    text(g1, rx0, 204, 'random start offset', 't-mut', { 'font-size': 26 });
    const ruler = (x, y, cls) => {
      line(g1, x, y, x + 180, y, cls);
      for (let i = 0; i <= 6; i += 1) line(g1, x + i * 30, y, x + i * 30, y - (i % 3 === 0 ? 26 : 15), cls);
    };
    ruler(rx0, 262, 'tr-ruler');
    ruler(rx0 + 52, 322, 'tr-ruler-shift');
    add(g1, 'path', { class: 'tr-ruler-shift', d: `M${rx0 + 2},${270} C${rx0 + 6},${300} ${rx0 + 26},${306} ${rx0 + 40},${308}` });
    head(g1, rx0 + 52, 310, 0.2, 'f-anchor', 16);

    // ---- Step 2: phase 2 card (y 380..720)
    const g2 = group(svg, { 'data-step': '2' });
    const cy = 380;
    add(g2, 'path', { class: 'tr-link', d: 'M462,227 V550 H486' });
    head(g2, 498, 550, 0, 'tr-head', 16);
    rect(g2, cx, cy, 1200, 340, 'tr-card', { rx: 20 });
    disc(g2, cx + 62, cy + 58, '2');
    text(g2, cx + 104, cy + 70, 'Distill to 4 steps on its own rollouts', 't-b', { 'font-size': 36 });
    text(g2, cx + 104, cy + 112, '14B teacher · 100 steps · gradients cross chunks and roles', 't-mut', { 'font-size': 28 });

    // Own rollout: planner anchor blocks, then the renderer's generated chunks.
    const tx = cx + 48;
    const TW = 72;
    const TH = 42;
    const TP = 80;
    [0, 3, 6].forEach((k) => {
      const bx = tx + k * TP;
      rect(g2, bx, cy + 146, TW * 2 + (TP - TW), 30, 'f-anchor', { rx: 6 });
      for (let j = 1; j < 3; j += 1) line(g2, bx + j * (TW * 2 + TP - TW) / 3, cy + 148, bx + j * (TW * 2 + TP - TW) / 3, cy + 174, '', { stroke: '#fff', 'stroke-width': 2 });
      head(g2, bx + TW, cy + 196, Math.PI / 2, 'f-anchor', 12);
      line(g2, bx + TW, cy + 178, bx + TW, cy + 186, '', { stroke: 'var(--anchor)', 'stroke-width': 3 });
    });
    [0, 4, 8, 12, 15, 19, 22, 26].forEach((c, k) => {
      const x = tx + k * TP;
      add(g2, 'image', { href: STRIP(c), x, y: cy + 200, width: TW, height: TH, preserveAspectRatio: 'xMidYMid slice' });
      rect(g2, x, cy + 200, TW, TH, 'tr-thumb-frame', { rx: 3 });
    });

    // Judges.
    const jx = cx + 790;
    add(g2, 'path', { class: 'tr-link', d: `M${tx + 7 * TP + TW + 14},${cy + 200} H${jx - 16}` });
    head(g2, jx - 4, cy + 200, 0, 'tr-head', 16);
    rect(g2, jx, cy + 140, 330, 54, 'f-slate', { rx: 12 });
    text(g2, jx + 165, cy + 176, 'teacher · Wan 14B', 't-white t-b', { 'text-anchor': 'middle', 'font-size': 26 });
    rect(g2, jx, cy + 206, 330, 54, 'tr-judge', { rx: 12 });
    text(g2, jx + 165, cy + 242, 'critic', 't-slate t-b', { 'text-anchor': 'middle', 'font-size': 26 });

    // Gradients (dashed slate) come from the teacher-critic pair and flow back through the renderer into the planner.
    const gy = cy + 290;
    const bxR = jx + 330;
    add(g2, 'path', { class: 'tr-grad tr-grad-solid', d: `M${bxR + 2},${cy + 167} H${bxR + 22} V${cy + 233} H${bxR + 2}` });
    add(g2, 'path', { class: 'tr-grad', d: `M${bxR + 22},${cy + 200} H${bxR + 44} V${gy} H${cx + 24} V${cy + 161} H${tx - 16}` });
    head(g2, tx - 2, cy + 161, 0, 'tr-grad-head', 16);
    add(g2, 'path', { class: 'tr-grad', d: `M${tx + 4 * TP - 4},${gy} V${cy + 258}` });
    head(g2, tx + 4 * TP - 4, cy + 246, -Math.PI / 2, 'tr-grad-head', 16);
    text(g2, tx + 4 * TP + 22, gy + 34, 'gradients', 't-slate t-b', { 'font-size': 26 });

    rect(g2, jx, cy + 36, 330, 48, 'tr-chip', { rx: 24 });
    text(g2, jx + 165, cy + 69, '4 steps · no guidance', 't-white t-b', { 'text-anchor': 'middle', 'font-size': 26 });
  }

  Deck.register('s-training', {
    steps: 2,
    init: buildTraining,
    update(slide, step, info) {
      FF.run(slide);
      const g0 = slide._trBase;
      if (!g0) return;
      // Alone on step 0 the backbone sits centred; it slides left as phase 1 appears.
      if (!info.animate) {
        g0.style.transition = 'none';
        g0.classList.toggle('tr-solo', step === 0);
        g0.getBoundingClientRect();
        requestAnimationFrame(() => { g0.style.transition = ''; });
      } else {
        g0.classList.toggle('tr-solo', step === 0);
      }
    },
    leave(slide) { FF.cancel(slide); },
  });

  /* =====================================================================
     s-latency: four groups of horizontal bars (65 s video, 4 GPUs)
     ===================================================================== */

  // Each method's fastest setup with up to 4 GPUs (65 s). Self-Forcing at 1.3B·480p is fastest on 1 GPU (57.89 s vs 65.14 s).
  const LAT = [
    { title: '1.3B · 480p', sf: 57.89, sfTag: '1 GPU', hiar: 24.67, ff: 21.29, cp: false, x: '1.16' },
    { title: '1.3B · 720p', sf: 97.68, hiar: 86.85, ff: 58.89, cp: true, x: '1.47' },
    { title: '14B · 480p', sf: 137.89, hiar: 73.03, ff: 52.18, cp: true, x: '1.40' },
    { title: '14B · 720p', sf: 269.41, hiar: 304.35, ff: 181.25, cp: true, x: '1.68' },
  ];

  function buildLatency(slide) {
    const svg = slide.querySelector('.lat-svg');
    if (!svg || svg.childNodes.length) return null;
    const bars = [];
    const late = [];
    const chips = [];
    const PW = 810;
    const BX = 226;
    const BMAX = 420;
    const tag = (g, x, y, str, boxCls, txtCls, wBox) => {
      const tg = group(g, { class: 'fade-in' });
      rect(tg, x, y + 10, wBox, 34, boxCls, { rx: 8 });
      text(tg, x + wBox / 2, y + 35, str, `${txtCls} t-b`, { 'text-anchor': 'middle', 'font-size': 22 });
      late.push(tg);
    };
    LAT.forEach((d, i) => {
      const px = (i % 2) * 890;
      const py = Math.floor(i / 2) * 318;
      const g = group(svg);
      text(g, px, py + 38, d.title, 't-b', { 'font-size': 36 });
      const max = Math.max(d.sf, d.hiar, d.ff);
      const rows = [
        { k: 'Self-Forcing', v: d.sf, f: 'f-sf', t: 't-sf', tag: d.sfTag },
        { k: 'HiAR', v: d.hiar, f: 'f-hiar', t: 't-hiar' },
        { k: 'FlashForward', v: d.ff, f: 'f-ours', t: 't-ours t-b', ours: true },
      ];
      rows.forEach((r, j) => {
        const y = py + 68 + j * 70;
        text(g, px + BX - 16, y + 37, r.k, r.t, { 'text-anchor': 'end', 'font-size': 28 });
        const w = (r.v / max) * BMAX;
        const bar = rect(g, px + BX, y, 0, 54, r.f, { rx: 6 });
        const val = text(g, px + BX + w + 12, y + 38, `${fmt2(r.v)} s`, `${r.ours ? 't-ours t-b' : 't-lbl'} fade-in`, { 'font-size': r.ours ? 32 : 30 });
        bars.push({ bar, w, val, x0: px + BX });
        late.push(val);
        const vw = textWidth(val, 7, r.ours ? 32 : 30);
        if (r.ours && d.cp) tag(g, px + BX + w + 12 + vw + 12, y, 'CP', 'lat-cp', 't-ours', 58);
        if (r.tag) tag(g, px + BX + w + 12 + vw + 12, y, r.tag, 'lat-tag', 't-mut', 96);
      });
      line(g, px + BX, py + 60, px + BX, py + 270, 'axis');
      // Speedup chip vs HiAR.
      const cg = group(g, { class: 'fade-in' });
      rect(cg, px + PW - 250, py + 2, 250, 50, 'lat-chip', { rx: 25 });
      add(cg, 'text', { x: px + PW - 125, y: py + 37, 'text-anchor': 'middle', class: 't-ours' }, [
        tspan(`${d.x}×`, 't-b', { 'font-size': 32 }),
        tspan(' vs HiAR', '', { 'font-size': 26 }),
      ]);
      chips.push(cg);
    });
    return { bars, late, chips };
  }

  Deck.register('s-latency', {
    steps: 1,
    init(slide) { slide._lat = buildLatency(slide); },
    update(slide, step, info) {
      const run = FF.run(slide);
      const L = slide._lat;
      if (!L) return;
      const final = () => {
        L.bars.forEach((b) => b.bar.setAttribute('width', b.w));
        fadeSet(L.late, true);
        fadeSet(L.chips, true);
      };
      if (!(info.animate && step === 0)) { final(); return; }
      L.bars.forEach((b) => b.bar.setAttribute('width', 0));
      fadeSet(L.late, false);
      fadeSet(L.chips, false);
      FF.tween({
        dur: 850, easing: FF.ease.out, run,
        onUpdate: (t) => L.bars.forEach((b) => b.bar.setAttribute('width', b.w * t)),
      }).then((ok) => {
        if (!ok) return;
        fadeSet(L.late, true);
        FF.wait(250, run).then((go) => { if (go) fadeSet(L.chips, true); });
      });
      run.onCancel(final);
    },
    leave(slide) { FF.cancel(slide); },
  });

  /* =====================================================================
     s-scaling: speedup vs HiAR across video lengths
     ===================================================================== */

  const SC = [
    { name: '14B · 720p', v: [1.33, 1.68, 1.69, 1.68], big: true, dash: false, dy: 0 },
    { name: '1.3B · 720p', v: [1.18, 1.45, 1.52, 1.47], big: false, dash: false, dy: -5 },
    { name: '14B · 480p', v: [1.18, 1.45, 1.43, 1.40], big: true, dash: true, dy: 6 },
    { name: '1.3B · 480p', v: [0.93, 1.21, 1.23, 1.16], big: false, dash: true, dy: 0 },
  ];
  const SC_X = [320, 690, 1060, 1430];
  const SC_T = ['5 s', '20 s', '35 s', '65 s'];
  const SC_LIM = [1.58, 1.72, 1.75, 1.76];
  const scY = (v) => 620 - (v - 0.8) * 560;

  function buildScaling(slide) {
    const svg = slide.querySelector('.sc-svg');
    if (!svg || svg.childNodes.length) return null;
    const X0 = 150;
    const XR = 1470;
    const defs = add(svg, 'defs');
    const clip = add(defs, 'clipPath', { id: 'sc-clip' });
    const clipRect = rect(clip, 0, 0, XR + 40, 720, '');

    // Step 2 band sits behind everything.
    const band = group(svg, { 'data-step': '2', 'data-anim': 'fade' });
    rect(band, SC_X[0] - 110, scY(1.46), 220, scY(0.8) - scY(1.46), 'sc-band', { rx: 12 }); // 5 s column, below its limit dash

    // Grid and axes.
    const ga = group(svg);
    [0.8, 1.0, 1.2, 1.4, 1.6, 1.8].forEach((v) => {
      if (v !== 1.0) line(ga, X0, scY(v), XR, scY(v), 'grid');
      text(ga, X0 - 18, scY(v) + 9, `${v.toFixed(1)}×`, 't-mut', { 'text-anchor': 'end', 'font-size': 26 });
    });
    line(ga, X0, scY(1.0), XR, scY(1.0), 'sc-even');
    text(ga, XR, scY(1.0) - 12, 'break-even', 't-slate', { 'text-anchor': 'end', 'font-size': 24 });
    SC_X.forEach((x, i) => text(ga, x, 664, SC_T[i], 't-mut', { 'text-anchor': 'middle', 'font-size': 26 }));
    text(ga, (SC_X[0] + SC_X[3]) / 2, 708, 'video length', 't-mut', { 'text-anchor': 'middle', 'font-size': 26 });
    text(ga, X0, 26, 'speedup vs HiAR', 't-mut', { 'font-size': 26 });

    // Step 1: forward-count limit, one dash per length (HiAR / FlashForward forwards:
    // 52/33, 212/123, 372/213, 692/393). The 65 s dash is clipped at the grid edge.
    const lim = group(svg, { 'data-step': '1', 'data-anim': 'fade' });
    SC_LIM.forEach((v, i) => {
      const x1 = SC_X[i] - 100;
      const x2 = Math.min(SC_X[i] + 100, XR);
      line(lim, x1, scY(v), x2, scY(v), 'sc-limit');
      const lbl = i === 1 ? `forward-count limit ${fmt2(v)}×` : `${fmt2(v)}×`;
      text(lim, (x1 + x2) / 2, scY(v) - 14, lbl, `t-slate sc-lim-t${i === 1 ? ' t-b' : ''}`,
        { 'text-anchor': 'middle', 'font-size': i === 1 ? 28 : 24 });
    });

    // Lines (solid first, dashed on top so overlapping segments stay visible).
    const gl = group(svg, { 'clip-path': 'url(#sc-clip)' });
    const order = [...SC].sort((a, b) => Number(a.dash) - Number(b.dash));
    order.forEach((d) => {
      const pts = d.v.map((v, i) => `${SC_X[i]},${scY(v)}`).join(' ');
      add(gl, 'polyline', { points: pts, class: `sc-line ${d.big ? 'sc-c14' : 'sc-c13'}${d.dash ? ' sc-dash' : ''}` });
    });
    order.forEach((d) => {
      d.v.forEach((v, i) => {
        if (d.dash) add(gl, 'circle', { cx: SC_X[i], cy: scY(v), r: 7, class: `sc-hollow ${d.big ? 'sc-c14' : 'sc-c13'}` });
        else add(gl, 'circle', { cx: SC_X[i], cy: scY(v), r: 10, class: d.big ? 'sc-m14' : 'sc-m13', stroke: '#fff', 'stroke-width': 3 });
      });
    });

    // End labels.
    const labels = [];
    SC.forEach((d) => {
      const y = scY(d.v[3]) + 10 + d.dy;
      const t = add(svg, 'text', { x: SC_X[3] + 30, y, class: `${d.big ? 'sc-t14' : 'sc-t13'} fade-in` }, [
        tspan(`${fmt2(d.v[3])}×`, 't-b', { 'font-size': 30 }),
        tspan(`  ${d.name}`, '', { 'font-size': 28 }),
      ]);
      labels.push(t);
    });

    // Step 2: the short-clip exception.
    const ex = group(svg, { 'data-step': '2', 'data-anim': 'fade' });
    add(ex, 'circle', { cx: SC_X[0], cy: scY(0.93), r: 22, class: 'sc-ring' });
    text(ex, SC_X[0] - 32, scY(0.93) + 9, '0.93×', 't-kv t-b', { 'text-anchor': 'end', 'font-size': 26 });
    text(ex, SC_X[0] + 34, scY(0.93) + 52, '5 s: warm-up not amortized', 't-kv t-b', { 'font-size': 28 });

    return { clipRect, labels, full: XR + 40 };
  }

  Deck.register('s-scaling', {
    steps: 2,
    init(slide) { slide._sc = buildScaling(slide); },
    update(slide, step, info) {
      const run = FF.run(slide);
      const C = slide._sc;
      if (!C) return;
      const final = () => { C.clipRect.setAttribute('width', C.full); fadeSet(C.labels, true); };
      if (!(info.animate && step === 0)) { final(); return; }
      C.clipRect.setAttribute('width', 150);
      fadeSet(C.labels, false);
      FF.tween({
        from: 150, to: C.full, dur: 950, easing: FF.ease.inOut, run,
        onUpdate: (v) => C.clipRect.setAttribute('width', v),
      }).then((ok) => { if (ok) fadeSet(C.labels, true); });
      run.onCancel(final);
    },
    leave(slide) { FF.cancel(slide); },
  });

  /* =====================================================================
     s-streaming: dedicated planner GPU + four-stage renderer wavefront
     ===================================================================== */

  const ST = { x0: 232, w: 22, bw: 18.5, bh: 56, py: 106, ry: [236, 308, 380, 452] };

  function buildStreaming(slide) {
    const svg = slide.querySelector('.st-svg');
    if (!svg || svg.childNodes.length) return null;
    const { x0, w, bw, bh, py, ry } = ST;
    const X = (r) => x0 + r * w;
    const boxes = []; // {node, round}

    // Row labels.
    text(svg, x0 - 18, py + 37, 'GPU 5 · planner', 't-anchor t-b', { 'text-anchor': 'end', 'font-size': 26 });
    ['GPU 1 · stage 4', 'GPU 2 · stage 3', 'GPU 3 · stage 2', 'GPU 4 · stage 1'].forEach((s, i) => {
      text(svg, x0 - 18, ry[i] + 37, s, 't-mut', { 'text-anchor': 'end', 'font-size': 26 });
    });

    // Planner: 3 anchor blocks, each 4 denoising forwards + 1 clean-KV forward.
    for (let b = 0; b < 3; b += 1) {
      for (let k = 0; k < 5; k += 1) {
        const r = b * 5 + k;
        const node = rect(svg, X(r) + 1.75, py, bw, bh, k < 4 ? 'f-anchor' : 'st-kv', { rx: 4 });
        boxes.push({ node, round: r });
      }
      text(svg, X(b * 5) + 2.5 * w, py - 14, `block ${b + 1}`, 't-anchor', { 'text-anchor': 'middle', 'font-size': 24 });
    }
    // Renderer wavefront: chunk i at GPU g in round 5 + i + g.
    for (let i = 0; i < 27; i += 1) {
      for (let g = 0; g < 4; g += 1) {
        const r = 5 + i + g;
        const node = rect(svg, X(r) + 1.75, ry[g], bw, bh, 'f-ours', { rx: 4 });
        boxes.push({ node, round: r });
      }
    }

    // First anchors ready -> rendering starts.
    const dep = group(svg, { class: 'fade-in' });
    add(dep, 'path', { class: 'st-dep', d: `M${X(4.5)},${py + bh + 4} C${X(4.5)},${py + bh + 30} ${X(5.5)},${ry[0] - 36} ${X(5.5)},${ry[0] - 16}` });
    head(dep, X(5.5), ry[0] - 3, Math.PI / 2, 'f-anchor', 13);

    // Wait bracket over the empty start of the first renderer row, labelled once above it.
    const wait = group(svg, { class: 'fade-in' });
    add(wait, 'path', { class: 'st-wait', d: `M${X(0) + 2},${ry[0] + 8} V${ry[0] - 6} H${X(5) - 2} V${ry[0] + 8}` });
    text(wait, X(3.8), ry[0] - 16, 'wait ≈ 0.5 s', 't-mut t-b', { 'text-anchor': 'end', 'font-size': 26 });

    // Time axis.
    const axisY = ry[3] + bh + 28;
    line(svg, x0, axisY, X(46) - 2, axisY, 'st-axis');
    head(svg, X(46) + 12, axisY, 0, 'st-axis-head', 16);
    text(svg, X(46) + 12, axisY + 38, 'time', 't-mut', { 'text-anchor': 'end', 'font-size': 26 });

    // Finish lines.
    const fin = group(svg, { class: 'fade-in' });
    line(fin, X(35), 44, X(35), axisY + 10, 'st-finish');
    text(fin, X(35), 30, '5 GPUs: done', 't-slate t-b', { 'text-anchor': 'middle', 'font-size': 26 });

    const ghost = group(svg, { 'data-step': '1', 'data-anim': 'fade' });
    line(ghost, X(45), 44, X(45), axisY + 10, 'st-ghost');
    text(ghost, X(45), 30, '4 GPUs', 't-mut t-b', { 'text-anchor': 'middle', 'font-size': 26 });

    const now = line(svg, x0, 44, x0, axisY, 'st-now');
    return { boxes, dep, wait, fin, now };
  }

  Deck.register('s-streaming', {
    steps: 1,
    init(slide) { slide._st = buildStreaming(slide); },
    update(slide, step, info) {
      const run = FF.run(slide);
      const D = slide._st;
      const count = slide.querySelector('.st-count');
      if (!D) return;
      const final = () => {
        D.boxes.forEach((b) => { b.node.style.opacity = 1; });
        fadeSet([D.dep, D.wait, D.fin], true);
        D.now.style.opacity = 0;
        if (count) count.textContent = '14.5';
      };
      if (!(info.animate && step === 0)) { final(); return; }
      D.boxes.forEach((b) => { b.node.style.opacity = 0; });
      fadeSet([D.dep, D.wait, D.fin], false);
      D.now.style.opacity = 1;
      const END = 35;
      FF.tween({
        from: 0, to: END, dur: 2300, easing: FF.ease.linear, run,
        onUpdate: (t) => {
          D.boxes.forEach((b) => { b.node.style.opacity = b.round < t ? 1 : 0; });
          const x = ST.x0 + t * ST.w;
          D.now.setAttribute('x1', x);
          D.now.setAttribute('x2', x);
          if (t > 5) fadeSet([D.dep, D.wait], true);
        },
      }).then((ok) => {
        if (!ok) return;
        D.now.style.opacity = 0;
        fadeSet([D.fin], true);
      });
      if (count) FF.countUp(count, 14.5, { decimals: 1, dur: 2300, easing: FF.ease.linear, run });
      run.onCancel(final);
    },
    leave(slide) { FF.cancel(slide); },
  });

  /* =====================================================================
     s-vbench: VBench Total, sorted bars (axis starts at 0.74)
     ===================================================================== */

  const VB = [
    { k: 'FlashForward', v: 0.838, c: 'ours' },
    { k: 'HiAR', v: 0.821, c: 'hiar' },
    { k: 'Causal Forcing', v: 0.810, c: 'other' },
    { k: 'Self-Forcing', v: 0.805, c: 'sf' },
    { k: 'Wan2.1-1.3B', v: 0.802, c: 'other', bi: true },
    { k: 'SkyReels-V2', v: 0.788, c: 'other' },
    { k: 'Pyramid Flow', v: 0.775, c: 'other' },
    { k: 'NOVA', v: 0.773, c: 'other' },
    { k: 'LTX-Video', v: 0.766, c: 'other', bi: true },
    { k: 'CausVid', v: 0.764, c: 'other' },
    { k: 'MAGI-1', v: 0.757, c: 'other' },
  ];

  function buildVbench(slide) {
    const svg = slide.querySelector('.vb-svg');
    if (!svg || svg.childNodes.length) return null;
    const BX = 262;
    const LO = 0.74;
    const HI = 0.85;
    const SPAN = 800;
    const X = (v) => BX + ((v - LO) / (HI - LO)) * SPAN;
    const P = 52;
    const BH = 36;
    const top = 8;
    const bottom = top + VB.length * P;

    rect(svg, 0, top - 8, 1180, P, 'vb-band', { rx: 12 });
    [0.74, 0.76, 0.78, 0.80, 0.82, 0.84].forEach((v) => {
      line(svg, X(v), top - 8, X(v), bottom, 'grid');
      text(svg, X(v), bottom + 34, v.toFixed(2), 't-mut', { 'text-anchor': 'middle', 'font-size': 26 });
    });
    text(svg, BX, bottom + 70, 'axis starts at 0.74', 't-mut', { 'font-size': 22 });

    const bars = [];
    const late = [];
    VB.forEach((d, i) => {
      const y = top + i * P;
      const ours = d.c === 'ours';
      const tcls = ours ? 't-ours t-b' : d.c === 'hiar' ? 't-hiar' : d.c === 'sf' ? 't-sf' : 't-mut';
      text(svg, BX - 16, y + 28, d.k, tcls, { 'text-anchor': 'end', 'font-size': ours ? 28 : 26 });
      const w = X(d.v) - BX;
      const bar = rect(svg, BX, y, 0, BH, `f-${d.c}`, { rx: 6 });
      const val = text(svg, BX + w + 12, y + 29, d.v.toFixed(3), `${ours ? 't-ours t-b' : 't-lbl'} fade-in`, { 'font-size': ours ? 32 : 28 });
      bars.push({ bar, w });
      late.push(val);
      if (d.bi) {
        const vw = textWidth(val, 5, 28);
        const tg = group(svg, { class: 'fade-in' });
        rect(tg, BX + w + 12 + vw + 14, y + 3, 58, 30, 'vb-tagbox', { rx: 7 });
        text(tg, BX + w + 12 + vw + 43, y + 26, '5 s', 't-mut t-b', { 'text-anchor': 'middle', 'font-size': 22 });
        late.push(tg);
      }
    });
    line(svg, BX, top - 8, BX, bottom, 'axis');
    return { bars, late };
  }

  Deck.register('s-vbench', {
    steps: 1,
    init(slide) { slide._vb = buildVbench(slide); },
    update(slide, step, info) {
      const run = FF.run(slide);
      const V = slide._vb;
      if (!V) return;
      const final = () => { V.bars.forEach((b) => b.bar.setAttribute('width', b.w)); fadeSet(V.late, true); };
      if (!(info.animate && step === 0)) { final(); return; }
      V.bars.forEach((b) => b.bar.setAttribute('width', 0));
      fadeSet(V.late, false);
      FF.tween({
        dur: 850, easing: FF.ease.out, run,
        onUpdate: (t) => V.bars.forEach((b) => b.bar.setAttribute('width', b.w * t)),
      }).then((ok) => { if (ok) fadeSet(V.late, true); });
      run.onCancel(final);
    },
    leave(slide) { FF.cancel(slide); },
  });

  /* =====================================================================
     s-vbench-long: VBench-Long Total at 20 / 35 / 65 s
     ===================================================================== */

  const VL = [
    { k: 'FlashForward', v: [0.8404, 0.8401, 0.8395], c: 'ours' },
    { k: 'HiAR', v: [0.8265, 0.8230, 0.8219], c: 'hiar' },
    { k: 'Self-Forcing', v: [0.8258, 0.8087, 0.7806], c: 'sf' },
    { k: 'Causal Forcing', v: [0.8178, 0.7906, 0.7539], c: 'cf' },
  ];
  const VL_S = [20, 35, 65];
  const vlX = (s) => 230 + ((s - 20) / 45) * 920;
  const vlY = (v) => 40 + ((0.85 - v) / 0.11) * 580;

  function buildVbenchLong(slide) {
    const svg = slide.querySelector('.vl-svg');
    if (!svg || svg.childNodes.length) return null;
    const X0 = 150;
    const XR = 1180;
    const defs = add(svg, 'defs');
    const clip = add(defs, 'clipPath', { id: 'vl-clip' });
    const clipRect = rect(clip, 0, 0, XR + 20, 720, '');

    // Step 1 area: what Self-Forcing loses (behind the lines).
    const loss = group(svg, { 'data-step': '1', 'data-anim': 'fade' });
    const sf = VL[2].v;
    add(loss, 'path', {
      class: 'vl-badge-sf',
      d: `M${vlX(20)},${vlY(sf[0])} L${vlX(65)},${vlY(sf[0])} L${vlX(65)},${vlY(sf[2])} L${vlX(35)},${vlY(sf[1])} Z`,
      opacity: 0.75,
    });
    line(loss, vlX(20), vlY(sf[0]), vlX(65), vlY(sf[0]), 'vl-ref');

    const ga = group(svg);
    [0.74, 0.76, 0.78, 0.80, 0.82, 0.84].forEach((v) => {
      line(ga, X0, vlY(v), XR, vlY(v), 'grid');
      text(ga, X0 - 18, vlY(v) + 9, v.toFixed(2), 't-mut', { 'text-anchor': 'end', 'font-size': 26 });
    });
    line(ga, X0, vlY(0.74), XR, vlY(0.74), 'axis');
    VL_S.forEach((s) => text(ga, vlX(s), vlY(0.74) + 44, `${s} s`, 't-mut', { 'text-anchor': 'middle', 'font-size': 26 }));
    text(ga, (vlX(20) + vlX(65)) / 2, vlY(0.74) + 86, 'video length', 't-mut', { 'text-anchor': 'middle', 'font-size': 26 });
    text(ga, X0, 18, 'VBench-Long Total', 't-mut', { 'font-size': 26 });
    text(ga, XR, 18, 'axis starts at 0.74', 't-mut', { 'text-anchor': 'end', 'font-size': 22 });

    const gl = group(svg, { 'clip-path': 'url(#vl-clip)' });
    [...VL].reverse().forEach((d) => {
      const pts = d.v.map((v, i) => `${vlX(VL_S[i])},${vlY(v)}`).join(' ');
      const dim = d.c === 'hiar' || d.c === 'cf' ? ' vl-dim' : '';
      add(gl, 'polyline', { points: pts, class: `vl-line vl-${d.c}${dim}` });
      d.v.forEach((v, i) => {
        add(gl, 'circle', { cx: vlX(VL_S[i]), cy: vlY(v), r: d.c === 'ours' ? 11 : 8, class: `vl-m-${d.c}${dim}`, stroke: d.c === 'cf' ? undefined : '#fff', 'stroke-width': d.c === 'cf' ? undefined : 3 });
      });
    });

    const labels = [];
    const tc = { ours: 't-ours t-b', hiar: 't-hiar t-b', sf: 't-sf t-b', cf: 't-mut t-b' };
    VL.forEach((d) => {
      const t = add(svg, 'text', { x: XR + 22, y: vlY(d.v[2]) + 10, class: `fade-in ${tc[d.c]}${d.c === 'hiar' || d.c === 'cf' ? ' vl-dim' : ''}` }, [
        tspan(d.k, '', { 'font-size': d.c === 'ours' ? 32 : 28 }),
        tspan(`  ${d.v[2].toFixed(4)}`, 't-lbl', { 'font-size': 26, 'font-weight': 500 }),
      ]);
      labels.push(t);
    });

    // Step 1 badges.
    const bg = group(svg, { 'data-step': '1' });
    const BXL = 1540;
    text(bg, BXL + 70, vlY(VL[0].v[2]) - 44, '20 s → 65 s', 't-mut', { 'text-anchor': 'middle', 'font-size': 24 });
    const badge = (y, str, cls, tcls) => {
      rect(bg, BXL, y - 26, 140, 52, cls, { rx: 26 });
      text(bg, BXL + 70, y + 11, str, `${tcls} t-b`, { 'text-anchor': 'middle', 'font-size': 30 });
    };
    badge(vlY(VL[0].v[2]), '−0.001', 'vl-badge-ours', 't-ours');
    badge(vlY(VL[2].v[2]), '−0.045', 'vl-badge-sf', 't-kv');

    return { clipRect, labels, full: XR + 20 };
  }

  Deck.register('s-vbench-long', {
    steps: 1,
    init(slide) { slide._vl = buildVbenchLong(slide); },
    update(slide, step, info) {
      const run = FF.run(slide);
      const C = slide._vl;
      if (!C) return;
      // Build 1 focuses on FlashForward vs Self-Forcing; the other two lines recede.
      slide.querySelector('.vl-svg').classList.toggle('vl-focus', step >= 1);
      const final = () => { C.clipRect.setAttribute('width', C.full); fadeSet(C.labels, true); };
      if (!(info.animate && step === 0)) { final(); return; }
      C.clipRect.setAttribute('width', 150);
      fadeSet(C.labels, false);
      FF.tween({
        from: 150, to: C.full, dur: 950, easing: FF.ease.inOut, run,
        onUpdate: (v) => C.clipRect.setAttribute('width', v),
      }).then((ok) => { if (ok) fadeSet(C.labels, true); });
      run.onCancel(final);
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
