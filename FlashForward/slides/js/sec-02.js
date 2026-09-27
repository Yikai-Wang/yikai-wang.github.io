/* Section 02 · Problem: forward-budget ticks (s-extra-cost) and the two baseline lane diagrams
   (s-self-forcing, s-hiar). Every update() renders its step directly; animation only when info.animate. */
(() => {
  'use strict';

  const S = FF.svg;

  // One chunk-sized forward in the lane style: solid method color with a white chunk number, or a
  // memory-only forward (white + rose hatch + 2 px rose outline). Drawn at local (0,0), placed by transform.
  const makeBox = (parent, { w, h, kind, label, hatch }) => {
    const g = S('g', { class: `lbox ${kind}` });
    if (kind === 'mem') {
      g.appendChild(S('rect', { x: 1, y: 1, width: w - 2, height: h - 2, rx: 5, class: 'mem-fill', fill: `url(#${hatch})` }));
      g.appendChild(S('rect', { x: 1, y: 1, width: w - 2, height: h - 2, rx: 5, class: 'mem-line' }));
    } else {
      g.appendChild(S('rect', { x: 0, y: 0, width: w, height: h, rx: 6, class: `bx ${kind}` }));
      if (label) g.appendChild(S('text', { x: w / 2, y: h / 2 + 1, class: 'bx-num', text: label }));
    }
    parent.appendChild(g);
    return g;
  };

  const place = (node, x, y, s = 1, w = 0, h = 0) => {
    if (s === 1) node.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    else {
      const dx = x + (w * (1 - s)) / 2;
      const dy = y + (h * (1 - s)) / 2;
      node.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${s.toFixed(3)})`);
    }
  };

  // ------------------------------------------------------------------ s-extra-cost
  // The 50-step footnote strip: 50 thin denoising ticks and one memory-only tick (= +2%).
  Deck.register('s-extra-cost', {
    init(slide) {
      const g = slide.querySelector('#s02-ec-ticks');
      if (!g) return;
      const x0 = 330;
      const y = 616;
      const h = 46;
      for (let i = 0; i < 50; i += 1) {
        g.appendChild(S('rect', { x: x0 + i * 10, y, width: 7, height: h, rx: 2, class: 'tick' }));
      }
      const xm = x0 + 50 * 10 + 4;
      g.appendChild(S('rect', { x: xm + 1, y: y + 1, width: 10, height: h - 2, rx: 2, class: 'mem-fill' }));
      g.appendChild(S('rect', { x: xm + 1, y: y + 1, width: 10, height: h - 2, rx: 2, class: 'mem-line' }));
    },
  });

  // ------------------------------------------------------------------ s-self-forcing
  // Single row, 3 toy chunks: 4 denoising forwards + 1 memory-only re-encode per chunk (the last
  // re-encode is omitted because nothing reads it). Step 1: chunk 1. Step 2: chunks 2 and 3.
  const SF = { x0: 280, pitch: 92, w: 84, y: 170, h: 120, slotMs: 120 };

  Deck.register('s-self-forcing', {
    steps: 3,
    init(slide) {
      const lanes = slide.querySelector('.lanes');
      const items = [];
      for (let c = 0; c < 3; c += 1) {
        const base = c * 5;
        const step = c === 0 ? 1 : 2;
        for (let k = 0; k < 4; k += 1) items.push({ slot: base + k, kind: 'sf', label: String(c + 1), step });
        if (c < 2) items.push({ slot: base + 4, kind: 'mem', step });
      }
      items.forEach((it) => {
        it.x = SF.x0 + it.slot * SF.pitch;
        it.node = makeBox(lanes, { w: SF.w, h: SF.h, kind: it.kind, label: it.label, hatch: 's02-hatch-sf' });
        place(it.node, it.x, SF.y);
      });
      const now = S('line', { class: 'now', x1: 0, x2: 0, y1: SF.y - 22, y2: SF.y + SF.h + 22 });
      lanes.appendChild(now);
      slide._s02 = { items, now };
    },
    update(slide, step, info) {
      const st = slide._s02;
      if (!st) return;
      const run = FF.run(slide);
      const fresh = info.animate ? st.items.filter((it) => it.step === step) : [];
      st.now.style.opacity = '0';
      st.items.forEach((it) => {
        const on = it.step <= step && !fresh.includes(it);
        it.node.style.opacity = on ? '1' : '0';
        place(it.node, it.x, SF.y);
      });
      if (!fresh.length) return;
      const xs = fresh[0].x - 6;
      const xe = fresh[fresh.length - 1].x + SF.w + 6;
      const reveal = SF.pitch * 0.85;
      FF.tween({
        dur: fresh.length * SF.slotMs,
        easing: FF.ease.linear,
        run,
        onUpdate: (v) => {
          const nx = FF.lerp(xs, xe, v);
          st.now.setAttribute('x1', nx);
          st.now.setAttribute('x2', nx);
          st.now.style.opacity = v < 1 ? '.55' : '0';
          fresh.forEach((it) => {
            const p = FF.clamp((nx - it.x) / reveal);
            it.node.style.opacity = String(p);
            place(it.node, it.x, SF.y + (1 - FF.ease.out(p)) * 16);
          });
        },
      });
      run.onCancel(() => { st.now.style.opacity = '0'; });
    },
    leave(slide) { FF.cancel(slide); },
  });

  // ------------------------------------------------------------------ s-hiar
  // Four GPUs (row r = stage 4 - r), 4 toy chunks.
  //   ideal (step 0): chunk i on GPU r at slot r + i (a pure assembly line, drawn faint).
  //   real  (step 1): chunk i denoises at slot r + 2i; for i >= 1 a memory-only forward sits at r + 2i - 1.
  //   Finish: slot 10 = 2*4 - 1 + (4 - 1) rounds (paper Eq. phase-loads, R_HiAR).
  const HI = { x0: 280, pitch: 136, w: 124, y0: 100, row: 100, h: 80, n: 4, rows: 4 };

  Deck.register('s-hiar', {
    steps: 2,
    init(slide) {
      const lanes = slide.querySelector('.lanes');
      const rounds = slide.querySelector('.rounds');
      for (let k = 0; k < 10; k += 1) {
        rounds.appendChild(S('text', { class: 'round-num', x: HI.x0 + k * HI.pitch + HI.w / 2, y: 554, text: String(k + 1) }));
      }
      const den = [];
      const mem = [];
      for (let r = 0; r < HI.rows; r += 1) {
        for (let i = 0; i < HI.n; i += 1) {
          const y = HI.y0 + r * HI.row;
          if (i >= 1) {
            const m = { r, i, y, slot: r + 2 * i - 1 };
            m.node = makeBox(lanes, { w: HI.w, h: HI.h, kind: 'mem', hatch: 's02-hatch-hi' });
            mem.push(m);
          }
          const d = { r, i, y, ideal: r + i, real: r + 2 * i };
          d.node = makeBox(lanes, { w: HI.w, h: HI.h, kind: 'hiar', label: String(i + 1) });
          den.push(d);
        }
      }
      slide._s02 = { den, mem };
    },
    update(slide, step, info) {
      const st = slide._s02;
      if (!st) return;
      const run = FF.run(slide);
      const xOf = (slot) => HI.x0 + slot * HI.pitch;
      // t = 0: ideal pipeline (faint), t = 1: real HiAR schedule.
      const apply = (t, memT, intro = 1) => {
        st.den.forEach((d) => {
          const p = intro >= 1 ? 1 : FF.clamp(intro * 8 - d.ideal);
          place(d.node, FF.lerp(xOf(d.ideal), xOf(d.real), t), d.y + (1 - p) * 12);
          d.node.style.opacity = String(FF.lerp(0.35, 1, t) * p);
        });
        st.mem.forEach((m) => {
          const q = FF.clamp(memT);
          place(m.node, xOf(m.slot), m.y, FF.lerp(0.6, 1, FF.ease.out(q)), HI.w, HI.h);
          m.node.style.opacity = String(q);
        });
      };
      const target = step >= 1 ? 1 : 0;
      apply(target, target);
      if (!info.animate) return;
      if (step === 0) {
        apply(0, 0, 0);
        FF.tween({ dur: 900, easing: FF.ease.linear, run, onUpdate: (v) => apply(0, 0, v) });
      } else if (step === 1) {
        apply(0, 0);
        FF.tween({
          dur: 1300,
          easing: FF.ease.inOut,
          run,
          onUpdate: (v) => apply(v, (v - 0.2) / 0.8),
        });
      }
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
