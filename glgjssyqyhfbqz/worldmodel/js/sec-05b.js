// 05b · Language: draws the stylised (schematic) 3D Gaussian field on s-reasongrounder (static, built once at load).
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => {
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(el);
    return el;
  };

  // Small deterministic PRNG so the field looks the same on every load.
  const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const build = () => {
    const svg = document.querySelector('#s-reasongrounder .rg-splat');
    if (!svg || svg.childNodes.length) return;
    const R = rng(7);
    const between = (a, b) => a + (b - a) * R();

    // Radial "splat" fills: solid core, soft rim.
    const defs = mk('defs', {}, svg);
    const palette = {
      tan: '#dcb37a', wood: '#b4864f', white: '#f4f5f7', fleece: '#cfd4da', brown: '#5b4031',
      dark: '#3a2a20', grey: '#6f7a88', red: '#e3393f', violet: '#a78bfa',
    };
    Object.keys(palette).forEach((k) => {
      const g = mk('radialGradient', { id: `rg-g-${k}` }, defs);
      mk('stop', { offset: '0%', 'stop-color': palette[k], 'stop-opacity': '1' }, g);
      mk('stop', { offset: '62%', 'stop-color': palette[k], 'stop-opacity': '0.85' }, g);
      mk('stop', { offset: '100%', 'stop-color': palette[k], 'stop-opacity': '0' }, g);
    });

    // Perspective box (front face solid edges, back face dashed).
    const F = { x0: 130, y0: 250, x1: 520, y1: 620 };
    const B = { x0: 230, y0: 170, x1: 620, y1: 540 };
    const box = mk('g', { fill: 'none', stroke: 'rgba(255,255,255,.2)', 'stroke-width': 2 }, svg);
    mk('rect', { x: B.x0, y: B.y0, width: B.x1 - B.x0, height: B.y1 - B.y0, 'stroke-dasharray': '6 8' }, box);
    [[F.x0, F.y0, B.x0, B.y0], [F.x1, F.y0, B.x1, B.y0], [F.x0, F.y1, B.x0, B.y1], [F.x1, F.y1, B.x1, B.y1]]
      .forEach(([x1, y1, x2, y2]) => mk('line', { x1, y1, x2, y2 }, box));

    const layer = mk('g', {}, svg);
    const splat = (cx, cy, rx, ry, rot, col, op) => mk('ellipse', {
      cx: cx.toFixed(1), cy: cy.toFixed(1), rx: rx.toFixed(1), ry: ry.toFixed(1),
      transform: `rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`,
      fill: `url(#rg-g-${col})`, opacity: op.toFixed(2),
    }, layer);
    const cluster = (n, cx, cy, sx, sy, rmin, rmax, cols, opMin) => {
      for (let i = 0; i < n; i += 1) {
        const a = R() * Math.PI * 2;
        const d = Math.sqrt(R());
        const r = between(rmin, rmax);
        splat(cx + Math.cos(a) * d * sx, cy + Math.sin(a) * d * sy, r, r * between(0.4, 0.85),
          between(-70, 70), cols[Math.floor(R() * cols.length)], between(opMin, 1));
      }
    };

    // Back to front: floor, table top, bear (behind), apple, sheep (between camera and apple).
    cluster(70, 380, 580, 240, 30, 7, 18, ['grey'], 0.25);
    for (let i = 0; i < 120; i += 1) {
      const u = R(); const v = R();
      const x = 175 + u * 330 + v * 90;
      const y = 470 - v * 80 + between(-5, 5);
      const r = between(12, 26);
      splat(x, y, r, r * between(0.22, 0.42), between(-16, 4), R() < 0.72 ? 'tan' : 'wood', between(0.6, 1));
    }
    cluster(70, 470, 320, 74, 84, 9, 24, ['brown', 'brown', 'dark'], 0.65);
    cluster(14, 398, 392, 15, 15, 5, 11, ['red'], 0.9);
    cluster(90, 300, 420, 58, 92, 8, 22, ['white', 'white', 'fleece'], 0.6);

    // The target Gaussian group (the apple): still part of the state.
    mk('circle', { cx: 398, cy: 392, r: 30, fill: 'none', stroke: '#ff40c8', 'stroke-width': 4 }, svg);

    // Two cameras, kept apart on purpose.
    // The LVLM's reference view (violet, right): it sees the apple with nothing in the way.
    const label = (x, y, text, fill, anchor) => {
      const t = mk('text', { x, y, fill, 'text-anchor': anchor, 'font-size': 24, 'font-weight': 600,
        stroke: '#11151d', 'stroke-width': 6, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }, svg);
      t.textContent = text;
      return t;
    };
    const ref = mk('g', {}, svg);
    mk('path', { d: 'M598 510 L424 396 M598 526 L420 416', stroke: palette.violet, 'stroke-width': 2.5,
      'stroke-dasharray': '5 7', fill: 'none' }, ref);
    mk('rect', { x: 614, y: 498, width: 48, height: 40, rx: 8, fill: palette.violet }, ref);
    mk('path', { d: 'M616 508 L598 500 L598 536 L616 528 Z', fill: palette.violet }, ref);
    mk('circle', { cx: 638, cy: 518, r: 9, fill: '#1c2230' }, ref);
    label(662, 454, 'reference', palette.violet, 'end');
    label(662, 482, 'view', palette.violet, 'end');

    // Any new view (grey, left): the sheep stands between it and the apple, so the apple is hidden.
    const grey = '#c3cad3';
    const nov = mk('g', {}, svg);
    mk('path', { d: 'M94 512 L376 372 M94 528 L376 412', stroke: grey, 'stroke-width': 2.5,
      'stroke-dasharray': '5 7', fill: 'none', opacity: 0.8 }, nov);
    mk('rect', { x: 30, y: 500, width: 48, height: 40, rx: 8, fill: grey }, nov);
    mk('path', { d: 'M76 510 L94 502 L94 538 L76 530 Z', fill: grey }, nov);
    mk('circle', { cx: 54, cy: 520, r: 9, fill: '#1c2230' }, nov);
    label(30, 576, 'new view', grey, 'start');
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
