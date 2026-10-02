/* Section 01 · Background: scripted builds for s-hook, s-diffusion, s-chunks and s-memory.
   Every update() renders its step directly; motion only happens when info.animate is true. */
(() => {
  'use strict';

  const hideIn = [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }];

  // Staggered entrance for a list of elements (only used on the animated path). fill 'backwards'
  // hides each element during its delay and leaves no override behind once it has finished.
  const stagger = (els, run, { gap = 120, dur = 420, delay = 0, frames = hideIn } = {}) => {
    els.forEach((el, i) => {
      FF.animate(el, frames, { duration: dur, delay: delay + i * gap, fill: 'backwards' }, run);
    });
  };

  // Cancel this script's Web Animations only; CSS animations/transitions (e.g. the KV flow) stay.
  const isCss = (a) => (window.CSSAnimation && a instanceof window.CSSAnimation)
    || (window.CSSTransition && a instanceof window.CSSTransition);
  const clearAnims = (els) => els.forEach((el) => el.getAnimations().forEach((a) => { if (!isCss(a)) a.cancel(); }));

  /* ---------------------------------------------------------------------------------------------
     S02 · hook: a real-time race. Measured denoising-path latency for the 65 s video
     (Wan2.1-1.3B, 480p, 4 x H100; main.tex Tab. generation-time).
     ------------------------------------------------------------------------------------------- */
  const RACE = [
    { m: 'sf', t: 65.14 },
    { m: 'hiar', t: 24.67 },
    { m: 'ours', t: 21.29 },
  ];
  let racing = null;

  const lanesOf = (slide) => RACE.map((r) => {
    const col = slide.querySelector(`.h2-col[data-m="${r.m}"]`);
    return { t: r.t, col, bar: col.querySelector('.h2-track i'), time: col.querySelector('.h2-time') };
  });

  const setLane = (lane, frac, elapsed) => {
    const done = frac >= 1;
    lane.bar.style.transform = `scaleX(${FF.clamp(frac)})`;
    lane.col.classList.toggle('is-done', done);
    // Finish labels carry the table's two decimals, matching the speed-up grid below.
    lane.time.textContent = done ? `✓ ${lane.t.toFixed(2)} s` : `${elapsed.toFixed(1)} s`;
  };

  const restartVideos = (slide) => {
    slide.querySelectorAll('.h2-grid video').forEach((v) => {
      try { v.currentTime = 0; } catch (e) { /* not seekable yet */ }
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    });
  };

  const startRace = (slide, lanes) => {
    const run = FF.run(slide);
    racing = run;
    restartVideos(slide);
    lanes.forEach((l) => setLane(l, 0, 0));
    let t0 = 0;
    let raf = 0;
    const frame = (now) => {
      if (!run.alive) return;
      if (!t0) t0 = now;
      const elapsed = (now - t0) / 1000;
      let finished = true;
      lanes.forEach((l) => {
        const f = Math.min(1, elapsed / l.t);
        setLane(l, f, elapsed);
        if (f < 1) finished = false;
      });
      if (finished) { if (racing === run) racing = null; return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    run.onCancel(() => { cancelAnimationFrame(raf); if (racing === run) racing = null; });
  };

  // Step 1: speed-ups over HiAR count up from 1.00x. Its own run key, so it never cancels the race.
  const countScale = (slide, animate) => {
    const scale = slide.querySelector('.h2-scale');
    const run = FF.run(scale);
    Array.from(scale.querySelectorAll('.h2-x')).forEach((el, i) => {
      const to = parseFloat(el.dataset.x);
      el.textContent = `${el.dataset.x}\u00d7`;
      if (!animate) return;
      el.textContent = '1.00\u00d7';
      FF.wait(250 + i * 140, run).then((ok) => {
        if (ok) FF.countUp(el, to, { from: 1, dur: 900, decimals: 2, suffix: '\u00d7', run });
      });
    });
  };

  Deck.register('s-hook', {
    steps: 2,
    update(slide, step, info) {
      const lanes = lanesOf(slide);
      countScale(slide, info.animate && step === 1 && info.prev === 0);
      // The race starts when the slide is entered and keeps running through every later build.
      if (racing && racing.alive && !info.entering) return;
      if (info.animate && info.entering && step === 0) { startRace(slide, lanes); return; }
      FF.cancel(slide);
      racing = null;
      lanes.forEach((l) => setLane(l, 1, l.t));
    },
    leave(slide) {
      FF.cancel(slide);
      FF.cancel(slide.querySelector('.h2-scale'));
      racing = null;
    },
  });

  /* ---------------------------------------------------------------------------------------------
     S03 · diffusion: noise-to-image row, then ~50 thin steps collapse into 4 denoising stages.
     Generic stages are neutral slate (as on s-extra-cost); blue stays reserved for FlashForward.
     ------------------------------------------------------------------------------------------- */
  const D = {
    x0: 380, w: 950, n: 50,
    tickW: 7, tickY: 24, tickH: 62,
    blkY: 140, blkH: 80, gap: 14,
    fade: 0.35, // opacity of the ~50 ticks once the 4 stage blocks exist
  };
  D.bw = (D.w - 3 * D.gap) / 4;
  const blockX = (b) => D.x0 + b * (D.bw + D.gap);
  const tickX = (i) => D.x0 + i * (D.w / D.n) + (D.w / D.n - D.tickW) / 2;
  const blockOf = (i) => Math.floor((i * 4) / D.n);

  const diffusion = {
    init(slide) {
      const svg = slide.querySelector('.d3-steps');
      const ticks = svg.querySelector('.ticks');
      const blocks = svg.querySelector('.blocks');
      for (let i = 0; i < D.n; i += 1) {
        ticks.appendChild(FF.svg('rect', {
          class: 'tick', x: tickX(i).toFixed(1), y: D.tickY, width: D.tickW, height: D.tickH, rx: 3,
        }));
      }
      ['4', '3', '2', '1'].forEach((label, b) => {
        const x = blockX(b);
        blocks.appendChild(FF.svg('g', { class: 'blk-g' }, [
          FF.svg('rect', { class: 'blk', x, y: D.blkY, width: D.bw, height: D.blkH, rx: 6 }),
          FF.svg('text', { class: 'blk-num', x: x + D.bw / 2, y: D.blkY + D.blkH / 2 + 13 }, [
            FF.svg('tspan', { class: 'blk-cap' }, 'stage\u00a0'),
            label,
          ]),
        ]));
      });
    },
    parts(slide) {
      const svg = slide.querySelector('.d3-steps');
      return {
        svg,
        ticks: Array.from(svg.querySelectorAll('.tick')),
        tickG: svg.querySelector('.ticks'),
        movers: svg.querySelector('.movers'),
        blocks: svg.querySelector('.blocks'),
        rowB: Array.from(svg.querySelectorAll('.lbl-big.few, .lbl-big.few + .lbl-sub, .right')),
        rowA: Array.from(svg.querySelectorAll('.lbl-big:not(.few), .lbl-big:not(.few) + .lbl-sub')),
      };
    },
    final(slide, step) {
      const p = this.parts(slide);
      p.movers.textContent = '';
      clearAnims([p.tickG, p.blocks, ...p.ticks, ...p.rowA, ...p.rowB]);
      const on = step >= 1;
      p.tickG.style.opacity = on ? String(D.fade) : '0';
      p.ticks.forEach((t) => { t.style.opacity = ''; });
      [...p.rowA, ...p.rowB, p.blocks].forEach((el) => { el.style.opacity = on ? '1' : '0'; });
    },
    async collapse(slide, run) {
      const p = this.parts(slide);
      p.movers.textContent = '';
      p.tickG.style.opacity = '1';
      p.blocks.style.opacity = '0';
      p.rowB.forEach((el) => { el.style.opacity = '0'; });
      p.rowA.forEach((el) => { el.style.opacity = '1'; });
      stagger(p.ticks, run, { gap: 9, dur: 220, frames: [{ opacity: 0 }, { opacity: 1 }] });
      stagger(p.rowA, run, { gap: 80, dur: 360, frames: [{ opacity: 0 }, { opacity: 1 }] });
      if (!(await FF.wait(D.n * 9 + 380, run))) return;
      // Copies of the ticks slide down and widen into the four stage blocks.
      const counts = [0, 0, 0, 0];
      for (let i = 0; i < D.n; i += 1) counts[blockOf(i)] += 1;
      const firstOf = [0, counts[0], counts[0] + counts[1], counts[0] + counts[1] + counts[2]];
      const movers = [];
      for (let i = 0; i < D.n; i += 1) {
        const b = blockOf(i);
        const k = i - firstOf[b];
        const sw = D.bw / counts[b];
        const r = FF.svg('rect', { x: tickX(i), y: D.tickY, width: D.tickW, height: D.tickH, rx: 3, fill: FF.color.slate });
        p.movers.appendChild(r);
        movers.push({ r, x0: tickX(i), x1: blockX(b) + k * sw, w1: sw + 0.6 });
      }
      FF.tween({ from: 1, to: D.fade, dur: 700, run, onUpdate: (v) => { p.tickG.style.opacity = v; } });
      const ok = await FF.tween({
        dur: 950,
        easing: FF.ease.inOut,
        run,
        onUpdate: (t) => {
          movers.forEach((m) => {
            m.r.setAttribute('x', FF.lerp(m.x0, m.x1, t).toFixed(2));
            m.r.setAttribute('width', FF.lerp(D.tickW, m.w1, t).toFixed(2));
            m.r.setAttribute('y', FF.lerp(D.tickY, D.blkY, t).toFixed(2));
            m.r.setAttribute('height', FF.lerp(D.tickH, D.blkH, t).toFixed(2));
            m.r.setAttribute('rx', FF.lerp(3, 0, t).toFixed(2));
          });
        },
      });
      if (!ok) return;
      p.blocks.style.opacity = '1';
      FF.animate(p.blocks, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 260 }, run);
      p.movers.textContent = '';
      p.rowB.forEach((el) => { el.style.opacity = '1'; });
      stagger(p.rowB, run, { gap: 120, dur: 380, frames: [{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }] });
    },
  };

  Deck.register('s-diffusion', {
    steps: 2,
    init(slide) { diffusion.init(slide); },
    update(slide, step, info) {
      const run = FF.run(slide);
      const row = Array.from(slide.querySelectorAll('.d3-row > *'));
      // Columns 0..8 are the image/arrow cells, 9..17 their labels: reveal column by column.
      clearAnims(row);
      if (step === 0) {
        diffusion.final(slide, 0);
        if (info.animate && info.entering) {
          const cols = [];
          for (let c = 0; c < 9; c += 1) cols.push([row[c], row[c + 9]]);
          cols.forEach((pair, c) => stagger(pair, run, { gap: 0, delay: 250 + c * 150, dur: 460 }));
        }
        return;
      }
      if (info.animate && step === 1 && info.prev === 0) { diffusion.collapse(slide, run); return; }
      diffusion.final(slide, step);
    },
    leave(slide) { FF.cancel(slide); },
  });

  /* ---------------------------------------------------------------------------------------------
     S04 · chunks: the 27-chunk film strip fills in left to right.
     ------------------------------------------------------------------------------------------- */
  Deck.register('s-chunks', {
    steps: 2,
    update(slide, step, info) {
      const run = FF.run(slide);
      const thumbs = Array.from(slide.querySelectorAll('.c4-strip img'));
      const brace = slide.querySelector('.c4-brace');
      const one = slide.querySelector('.c4-one');
      clearAnims([...thumbs, brace, one]);
      if (step === 0 && info.animate && info.entering) {
        const t = 200 + thumbs.length * 80;
        stagger(thumbs, run, { gap: 80, dur: 320, delay: 200, frames: [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }] });
        stagger([brace], run, { dur: 500, delay: t });
        // .c4-one is centred with translateX(-50%), so its frames keep that offset.
        stagger([one], run, { dur: 500, delay: t + 250, frames: [{ opacity: 0, transform: 'translate(-50%, 18px)' }, { opacity: 1, transform: 'translateX(-50%)' }] });
      }
    },
    leave(slide) { FF.cancel(slide); },
  });

  /* ---------------------------------------------------------------------------------------------
     S05 · memory: earlier chunks leave KV cards; the memory flows into the chunk being generated.
     ------------------------------------------------------------------------------------------- */
  Deck.register('s-memory', {
    steps: 1,
    update(slide, step, info) {
      const run = FF.run(slide);
      const cards = Array.from(slide.querySelectorAll('.kvcard'));
      const bus = Array.from(slide.querySelectorAll('.m5-bus, .m5-kv-lab'));
      const flow = slide.querySelector('.m5-flow');
      clearAnims([...cards, ...bus, flow]);
      if (step === 0 && info.animate && info.entering) {
        const t = 350 + cards.length * 110;
        stagger(cards, run, { gap: 110, dur: 380, delay: 350, frames: [{ opacity: 0 }, { opacity: 1 }] });
        stagger(bus, run, { gap: 140, dur: 520, delay: t, frames: [{ opacity: 0 }, { opacity: 1 }] });
        stagger([flow], run, { dur: 520, delay: t, frames: [{ opacity: 0 }, { opacity: 0.85 }] });
      }
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
