/* 00 · Shared: draw the small wall clocks of this deck. Markup: <g class="oc-clock" data-clock="10:10"
   data-r="60" transform="translate(cx cy)"></g>. Drawn once at load; static markup otherwise. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  };
  const pt = (deg, len) => {
    const a = (deg * Math.PI) / 180;
    return [(Math.sin(a) * len).toFixed(2), (-Math.cos(a) * len).toFixed(2)];
  };
  document.querySelectorAll('#deck g.oc-clock[data-clock]').forEach((g) => {
    const [h, m] = g.dataset.clock.split(':').map(Number);
    const r = Number(g.dataset.r || 60);
    g.appendChild(mk('circle', { class: 'oc-face', r, 'stroke-width': (r * 0.08).toFixed(1) }));
    for (let i = 0; i < 12; i += 1) {
      const [x1, y1] = pt(i * 30, r * 0.66);
      const [x2, y2] = pt(i * 30, r * 0.8);
      g.appendChild(mk('line', { class: 'oc-tick', x1, y1, x2, y2, 'stroke-width': (r * (i % 3 ? 0.03 : 0.06)).toFixed(1) }));
    }
    const hour = (h % 12) * 30 + m * 0.5;
    const minute = m * 6;
    const [hx, hy] = pt(hour, r * 0.45);
    const [mx, my] = pt(minute, r * 0.7);
    g.appendChild(mk('line', { class: 'oc-hand', x1: 0, y1: 0, x2: hx, y2: hy, 'stroke-width': (r * 0.09).toFixed(1) }));
    g.appendChild(mk('line', { class: 'oc-hand oc-min', x1: 0, y1: 0, x2: mx, y2: my, 'stroke-width': (r * 0.06).toFixed(1) }));
    g.appendChild(mk('circle', { class: 'oc-cap', r: (r * 0.08).toFixed(1) }));
  });
})();
