/* Section 07 · Backup slides (Q&A only). Diagrams are built once in init; bars grow when a build appears. */
(() => {
  'use strict';

  const S = (tag, attrs, kids) => FF.svg(tag, attrs, kids);

  /* ------------------------------------------------------------------
     s-bk-rate: planner lane (5 forwards per anchor block) vs renderer lane
     (one chunk per round, 7 chunks per three-anchor window).
     ------------------------------------------------------------------ */
  const RATE = { x0: 262, pitch: 71.5, w: 63, h: 56, yP: 66, yR: 232, slots: 20 };
  const sx = (i) => RATE.x0 + RATE.pitch * i;

  const buildRate = (slide) => {
    const g = slide.querySelector('.rate-rows');
    if (!g || g.childNodes.length) return;
    const { w, h, yP, yR } = RATE;

    // Row labels.
    g.appendChild(S('text', { x: 232, y: yP + 38, class: 'r-lab r-lab-pl', 'text-anchor': 'end' }, 'Planner · 1 GPU'));
    g.appendChild(S('text', { x: 232, y: yR + 24, class: 'r-lab', 'text-anchor': 'end' }, 'Renderer · 4 GPUs'));
    g.appendChild(S('text', { x: 232, y: yR + 54, class: 'r-lab r-lab-s', 'text-anchor': 'end' }, '1 chunk / round'));

    // Planner: blocks of 4 denoising forwards + 1 clean-KV forward.
    for (let b = 0; b < 4; b += 1) {
      for (let k = 0; k < 5; k += 1) {
        const i = b * 5 + k;
        g.appendChild(S('rect', {
          x: sx(i), y: yP, width: w, height: h, rx: 6,
          class: k < 4 ? 'r-pl' : 'r-plkv',
        }));
      }
      g.appendChild(S('text', {
        x: sx(b * 5) + (5 * RATE.pitch - (RATE.pitch - w)) / 2, y: yP - 16,
        class: 'r-blk', 'text-anchor': 'middle',
      }, `anchor block ${b + 1}`));
    }

    // Renderer: waits for block 1 only, then one chunk per round.
    const waitW = sx(5) - sx(0) - (RATE.pitch - w);
    g.appendChild(S('rect', { x: sx(0), y: yR, width: waitW, height: h, rx: 6, class: 'r-wait' }));
    g.appendChild(S('text', { x: sx(0) + waitW / 2, y: yR + 37, class: 'r-waitt', 'text-anchor': 'middle' }, 'waits for block 1 only'));
    for (let i = 5; i < RATE.slots; i += 1) {
      g.appendChild(S('rect', { x: sx(i), y: yR, width: w, height: h, rx: 6, class: 'r-rd' }));
      g.appendChild(S('text', { x: sx(i) + w / 2, y: yR + 37, class: 'r-num', 'text-anchor': 'middle' }, String(i - 4)));
    }

    // Window brackets under the renderer (7 chunks each), third window starts at the edge.
    const bracket = (i0, i1, label) => {
      const xa = sx(i0) + 2;
      const xb = sx(i1) + w - 2;
      const y = yR + h + 14;
      g.appendChild(S('path', { d: `M${xa},${y} v10 H${xb} v-10`, class: 'r-brk' }));
      g.appendChild(S('text', { x: (xa + xb) / 2, y: y + 44, class: 'r-brkt', 'text-anchor': 'middle' }, label));
    };
    bracket(5, 11, 'window 1 · 7 chunks');
    bracket(12, 18, 'window 2 · 7 chunks');

    // Publish arrows: block k is ready before window k starts.
    const arrow = (iFrom, iTo) => {
      const x1 = sx(iFrom) + w / 2;
      const x2 = sx(iTo) + w / 2;
      g.appendChild(S('path', {
        d: `M${x1},${yP + h + 4} C${x1},${yP + h + 40} ${x2},${yR - 44} ${x2},${yR - 6}`,
        class: 'r-arrow', 'marker-end': 'url(#bk-rate-arrow)',
      }));
    };
    arrow(4, 5);
    arrow(9, 12);
    arrow(14, 19);
    g.appendChild(S('text', { x: sx(5) + 30, y: (yP + h + yR) / 2 + 9, class: 'r-ahead' }, 'ready before its window starts'));

    // Time axis: a thin arrow under the window brackets, labelled at its right end.
    const yAx = yR + h + 80;
    const xEnd = sx(RATE.slots - 1) + w;
    g.appendChild(S('path', { d: `M${sx(0)},${yAx} H${xEnd - 176}`, class: 'r-brk', 'marker-end': 'url(#bk-rate-axis)' }));
    g.appendChild(S('text', { x: xEnd, y: yAx + 8, class: 'r-axis', 'text-anchor': 'end' }, 'time (rounds)'));
  };

  Deck.register('s-bk-rate', {
    init(slide) { buildRate(slide); },
    update(slide) { buildRate(slide); },
  });

  /* ------------------------------------------------------------------
     s-bk-memory: grouped bars, Bidirectional vs HiAR vs FlashForward, 1.3B 480p 1 GPU.
     ------------------------------------------------------------------ */
  const MEM = {
    lengths: ['5 s', '20 s', '35 s', '65 s'],
    bid: [22.1, 31.7, 41.2, 60.3],
    hiar: [24.9, 24.9, 25.0, 25.1],
    ours: [24.9, 25.0, 25.2, 25.4],
    max: 70,
    left: 92, right: 850, top: 40, bottom: 500,
  };
  const memY = (v) => MEM.bottom - (v / MEM.max) * (MEM.bottom - MEM.top);

  const buildMem = (slide) => {
    const g = slide.querySelector('.mem-plot');
    if (!g || g.childNodes.length) return;
    [0, 20, 40, 60].forEach((t) => {
      const y = memY(t);
      g.appendChild(S('line', { x1: MEM.left, x2: MEM.right, y1: y, y2: y, class: t === 0 ? 'm-axis' : 'm-grid' }));
      g.appendChild(S('text', { x: MEM.left - 14, y: y + 9, class: 'm-tick', 'text-anchor': 'end' }, String(t)));
    });
    g.appendChild(S('text', { x: MEM.left - 14, y: MEM.top - 14, class: 'm-unit', 'text-anchor': 'end' }, 'GiB'));
    const gw = (MEM.right - MEM.left) / MEM.lengths.length;
    const bw = 54;
    MEM.lengths.forEach((len, i) => {
      const cx = MEM.left + gw * (i + 0.5);
      [['bid', MEM.bid[i], cx - 86], ['hiar', MEM.hiar[i], cx - 27], ['ours', MEM.ours[i], cx + 32]].forEach(([cls, v, x]) => {
        g.appendChild(S('rect', { x, y: memY(v), width: bw, height: MEM.bottom - memY(v), rx: 4, class: `m-bar m-${cls}`, 'data-v': v }));
        g.appendChild(S('text', { x: x + bw / 2, y: memY(v) - 12, class: `m-val m-val-${cls}`, 'text-anchor': 'middle' }, v.toFixed(1)));
      });
      g.appendChild(S('text', { x: cx, y: MEM.bottom + 42, class: 'm-len', 'text-anchor': 'middle' }, len));
    });
    g.appendChild(S('text', { x: (MEM.left + MEM.right) / 2, y: MEM.bottom + 88, class: 'm-xlab', 'text-anchor': 'middle' }, 'video length'));
  };

  const setMem = (slide, t) => {
    slide.querySelectorAll('.m-bar').forEach((r) => {
      const v = parseFloat(r.getAttribute('data-v')) * t;
      r.setAttribute('y', memY(v));
      r.setAttribute('height', MEM.bottom - memY(v));
    });
    slide.querySelectorAll('.m-val').forEach((n) => { n.style.opacity = t > 0.85 ? 1 : 0; });
  };

  Deck.register('s-bk-memory', {
    init(slide) { buildMem(slide); },
    update(slide, step, info) {
      buildMem(slide);
      const run = FF.run(slide);
      if (!info.animate) { setMem(slide, 1); return; }
      setMem(slide, 0);
      FF.tween({ dur: 800, easing: FF.ease.out, run, onUpdate: (t) => setMem(slide, t) });
    },
    leave(slide) { FF.cancel(slide); setMem(slide, 1); },
  });

  /* ------------------------------------------------------------------
     s-bk-seams: luminance-gap bars grow when the numbers build appears.
     ------------------------------------------------------------------ */
  const GAP_MAX = 6.244;
  const setGap = (slide, t) => {
    slide.querySelectorAll('.seam-track i').forEach((bar) => {
      const v = parseFloat(bar.getAttribute('data-v'));
      bar.style.width = `${Math.max(0.6, (v / GAP_MAX) * 100 * t)}%`;
    });
  };

  Deck.register('s-bk-seams', {
    steps: 1,
    update(slide, step, info) {
      const run = FF.run(slide);
      if (step < 1) return;
      if (!info.animate) { setGap(slide, 1); return; }
      setGap(slide, 0);
      FF.tween({ dur: 800, delay: 250, easing: FF.ease.out, run, onUpdate: (t) => setGap(slide, t) });
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
