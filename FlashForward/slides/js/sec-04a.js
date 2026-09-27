/* Section 04a · Clean anchors (s-anchors, storyboard S14).
   init() generates the 81-cell timeline; update() renders any build directly and, for a single forward step,
   animates the transition: 1 = planner blocks, 2 = latents 6-8 read anchors 0/10/20, 3 = shared anchor windows. */
(() => {
  'use strict';

  const S = FF.svg;
  const N = 81;                 // latent positions 0..80 (20 s)
  const X0 = 250;               // left edge of cell 0
  const P = 17.8;               // cell pitch
  const CW = 14;                // cell width
  const ROW = { y: 400, h: 56 }; // neutral cells
  const ANC = { y: 384, h: 88 }; // anchor cells (taller)
  const CHUNK = [6, 7, 8];
  const BLOCKS = [[0, 10, 20], [30, 40, 50], [60, 70, 80]];
  const WINS = [[0, 10, 20], [20, 30, 40], [40, 50, 60], [60, 70, 80]];
  const Y = { blk: 58, mini: 80, sub: 144, brk: 176, tick: 484, tnum: 524, win: 590, wlab: 638 };

  const left = (i) => X0 + i * P;
  const cx = (i) => left(i) + CW / 2;

  // Per-slide handles, filled by init().
  const G = {};

  const build = (slide) => {
    const svg = slide.querySelector('svg.fig');
    const gRow = svg.querySelector('.g-row');
    const gAxis = svg.querySelector('.g-axis');
    const gBlocks = svg.querySelector('.g-blocks');
    const gArcs = svg.querySelector('.g-arcs');
    const gWins = svg.querySelector('.g-wins');

    // Row label and the 81 neutral cells.
    gRow.appendChild(S('text', { class: 't-row', x: 225, y: ROW.y + 22, 'text-anchor': 'end', text: '81 latents' }));
    gRow.appendChild(S('text', { class: 't-row', x: 225, y: ROW.y + 54, 'text-anchor': 'end', text: '(20 s)' }));
    for (let i = 0; i < N; i += 1) {
      gRow.appendChild(S('rect', { class: 'cell', x: left(i), y: ROW.y, width: CW, height: ROW.h, rx: 3 }));
    }

    // Renderer chunk 6-8 overlay (build 2) and a ring around it.
    G.chunk = CHUNK.map((i) => gRow.appendChild(S('rect', {
      class: 'cell-o', x: left(i), y: ROW.y, width: CW, height: ROW.h, rx: 3, opacity: 0,
    })));
    G.ring = gRow.appendChild(S('rect', {
      class: 'ring-o', x: left(6) - 5, y: ROW.y - 5, width: left(8) + CW - left(6) + 10, height: ROW.h + 10, rx: 7, opacity: 0,
    }));

    // Empty anchor slots (build 0): dashed amber outlines every 10 latents, filled by the planner in build 1.
    G.slots = {};
    BLOCKS.flat().forEach((i) => {
      G.slots[i] = gRow.appendChild(S('rect', { class: 'slot-a', x: left(i) - 1, y: ANC.y, width: CW + 2, height: ANC.h, rx: 3 }));
    });
    G.hint = gRow.appendChild(S('text', { class: 't-hint', x: cx(40), y: 330, 'text-anchor': 'middle',
      text: 'one clean anchor every 10 latents = 2.5 s' }));

    // Anchor overlays (build 1), one per anchor, grown from the neutral cell.
    G.anchors = {};
    BLOCKS.flat().forEach((i) => {
      G.anchors[i] = gRow.appendChild(S('rect', { class: 'cell-a', x: left(i) - 1, width: CW + 2, rx: 3, opacity: 0 }));
    });

    // Axis: ticks every 10 and the axis name.
    for (let i = 0; i < N; i += 10) {
      gAxis.appendChild(S('line', { class: 'tick', x1: cx(i), x2: cx(i), y1: Y.tick, y2: Y.tick + 10 }));
      G[`tn${i}`] = gAxis.appendChild(S('text', { class: 't-axis t-axis-slot', x: cx(i), y: Y.tnum, 'text-anchor': 'middle', text: String(i) }));
    }
    gAxis.appendChild(S('text', { class: 't-axis t-axis-name', x: 225, y: Y.tnum, 'text-anchor': 'end', text: 'position' }));

    // Unit caption (builds 0-2); the windows of build 3 take its place.
    const ux = cx(40);
    G.unit = gAxis.appendChild(S('g', { class: 'unit' }));
    G.unit.appendChild(S('rect', { class: 'cell', x: ux - 250, y: Y.wlab - 34, width: CW, height: 40, rx: 3 }));
    G.unit.appendChild(S('text', { class: 't-unit', x: ux - 222, y: Y.wlab - 5, text: '1 cell = 1 latent = 4 frames = 0.25 s' }));

    buildBlocks(gBlocks);
    buildArcs(gArcs);
    buildWins(gWins);
  };

  // Build 1: three planner blocks, each "4 denoising + 1 clean-KV forward", bracketed over its anchors.
  const buildBlocks = (g) => {
    G.planner = g.appendChild(S('text', { class: 't-row t-row-a', x: 225, y: Y.mini + 20, 'text-anchor': 'end', text: 'Planner', opacity: 0 }));
    G.blk = BLOCKS.map((anc, b) => {
      const c = cx(anc[1]);
      const x1 = left(anc[0]) - 3;
      const x2 = left(anc[2]) + CW + 3;
      const grp = g.appendChild(S('g', { class: 'blk', opacity: 0 }));
      grp.appendChild(S('text', { class: 't-blk', x: c, y: Y.blk, 'text-anchor': 'middle', text: `block ${b + 1}` }));
      const minis = [0, 1, 2, 3, 4].map((k) => g.appendChild(S('rect', {
        class: k < 4 ? 'mini-d' : 'mini-c', x: c - 78 + k * 32, y: Y.mini, width: 24, height: 24, rx: 5, opacity: 0,
      })));
      grp.appendChild(S('text', { class: 't-blk-sub', x: c, y: Y.sub, 'text-anchor': 'middle', text: '4 denoising + 1 clean-KV forward' }));
      grp.appendChild(S('path', {
        class: 'brk', d: `M${x1} ${Y.brk + 14} V${Y.brk} H${x2} V${Y.brk + 14} M${c} ${Y.brk} V${Y.brk - 9}`,
      }));
      return { grp, minis, anc };
    });
  };

  // Build 2: curved amber reads from anchors 0 (behind), 10 and 20 (ahead) into chunk 6-8.
  const ARCS = [[0, 6, 262], [10, 8, 312], [20, 7, 232]];
  const buildArcs = (g) => {
    G.arcs = ARCS.map(([from, to, peak]) => {
      const x1 = cx(from);
      const x2 = cx(to);
      const y1 = ANC.y - 3;
      const y2 = ROW.y - 12;
      return g.appendChild(S('path', {
        class: 'arc', d: `M${x1} ${y1} C${x1} ${peak} ${x2} ${peak} ${x2} ${y2}`,
        pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1,
      }));
    });
    const t = S('text', { class: 't-read', x: 668, y: 322, opacity: 0 });
    t.appendChild(S('tspan', { class: 'o', text: 'latents 6–8' }));
    t.appendChild(S('tspan', { text: ' read ' }));
    t.appendChild(S('tspan', { class: 'a', text: 'anchors 0, 10, 20:' }));
    t.appendChild(S('tspan', { text: ' behind and ahead' }));
    G.read = g.appendChild(t);
  };

  // Build 3: four local windows under the row; adjacent windows share an end anchor (double tick).
  const buildWins = (g) => {
    const shared = new Set([20, 40, 60]);
    G.wins = WINS.map((w) => {
      const x1 = cx(w[0]) + (shared.has(w[0]) ? 4 : -CW / 2 - 2);
      const x2 = cx(w[2]) - (shared.has(w[2]) ? 4 : -CW / 2 - 2);
      const grp = g.appendChild(S('g', { class: 'wn', opacity: 0 }));
      grp.appendChild(S('path', { class: 'win', d: `M${x1} ${Y.win - 16} V${Y.win} H${x2} V${Y.win - 16}` }));
      grp.appendChild(S('text', { class: 't-win', x: cx(w[1]), y: Y.wlab, 'text-anchor': 'middle', text: `{${w.join(', ')}}` }));
      return grp;
    });
    G.shared = g.appendChild(S('text', { class: 't-shared', x: cx(20), y: Y.wlab, 'text-anchor': 'middle', text: 'shared', opacity: 0 }));
  };

  // ---------- state setters: t in [0, 1] is the progress of a build ----------
  const op = (el, v) => el.setAttribute('opacity', FF.clamp(v).toFixed(3));

  const setBlock = (b, t) => {
    const blk = G.blk[b];
    blk.minis.forEach((m, k) => op(m, (t - k * 0.09) / 0.1));
    const a = FF.clamp((t - 0.45) / 0.55);
    const e = FF.ease.outBack(a);
    blk.anc.forEach((i) => {
      const r = G.anchors[i];
      const h = ROW.h + (ANC.h - ROW.h) * e;
      r.setAttribute('y', (ROW.y + ROW.h / 2 - h / 2).toFixed(2));
      r.setAttribute('height', Math.max(0, h).toFixed(2));
      op(r, a * 1.6);
      op(G.slots[i], 1 - a * 2);
      G[`tn${i}`].classList.toggle('t-axis-a', a > 0.5);
    });
    op(blk.grp, a * 1.3);
    if (b === 0) { op(G.planner, 0.4 + t * 2); op(G.hint, 1 - t * 3); }
  };

  const setRead = (t) => {
    const c = FF.clamp(t / 0.3);
    G.chunk.forEach((r) => op(r, c));
    op(G.ring, c);
    G.arcs.forEach((p, j) => {
      const k = FF.clamp((t - 0.25 - j * 0.1) / 0.5);
      p.setAttribute('stroke-dashoffset', (1 - FF.ease.out(k)).toFixed(3));
      if (k >= 0.97) p.setAttribute('marker-end', 'url(#s04a-ah)'); else p.removeAttribute('marker-end');
    });
    op(G.read, (t - 0.6) / 0.4);
  };

  const setWins = (t) => {
    G.wins.forEach((w, k) => op(w, (t - k * 0.2) / 0.25));
    op(G.unit, 1 - t * 4);
    op(G.shared, (t - 0.3) / 0.3);
  };

  const render = (step) => {
    G.blk.forEach((_, b) => setBlock(b, step >= 1 ? 1 : 0));
    setRead(step >= 2 ? 1 : 0);
    setWins(step >= 3 ? 1 : 0);
  };

  Deck.register('s-anchors', {
    steps: 3,
    init(slide) { build(slide); },
    async update(slide, step, info) {
      const run = FF.run(slide);
      if (!G.blk) build(slide);
      if (!info.animate || step === 0) { render(step); return; }
      render(step - 1);
      const tw = (dur, fn) => FF.tween({ dur, easing: FF.ease.linear, run, onUpdate: fn });
      if (step === 1) {
        for (let b = 0; b < BLOCKS.length; b += 1) {
          if (!(await tw(560, (t) => setBlock(b, t)))) return;
        }
      } else if (step === 2) {
        await tw(1300, setRead);
      } else if (step === 3) {
        await tw(1100, setWins);
      }
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
