/* Section 04 · Time: scripted builds for s-ff-race (port of FlashForward s-hook), s-ff-wavefront (port of
   FlashForward s-wavefront) and s-ff-anchors.
   Every update() renders its step directly; motion only happens when info.animate is true. */
(() => {
  'use strict';

  const EASE = 'cubic-bezier(.2,.7,.2,1)';

  // Cancel this script's Web Animations only; CSS animations/transitions stay.
  const isCss = (a) => (window.CSSAnimation && a instanceof window.CSSAnimation)
    || (window.CSSTransition && a instanceof window.CSSTransition);
  const clearAnims = (els) => els.forEach((el) => el.getAnimations().forEach((a) => { if (!isCss(a)) a.cancel(); }));

  /* ---------------------------------------------------------------------------------------------
     s-ff-race: a real-time race. Denoising-path latency for a 65 s video, mean of 20 videos
     (Wan2.1-1.3B, 480p, 4 x H100; arXiv 2609.32540 Table 4). Self-Forcing here is its 4-GPU run.
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

  // Step 1: speed-ups over Self-Forcing count up from 1.00x, the 1.3B · 480p hero last. Own run key, so the
  // race keeps going underneath.
  const countScale = (slide, animate) => {
    const scale = slide.querySelector('.h2-scale');
    const run = FF.run(scale);
    Array.from(scale.querySelectorAll('.h2-x')).forEach((el, i) => {
      const to = parseFloat(el.dataset.x);
      el.textContent = `${el.dataset.x}×`;
      if (!animate) return;
      el.textContent = '1.00×';
      FF.wait(250 + i * 140, run).then((ok) => {
        if (ok) FF.countUp(el, to, { from: 1, dur: 900, decimals: 2, suffix: '×', run });
      });
    });
  };

  Deck.register('s-ff-race', {
    steps: 1,
    update(slide, step, info) {
      const lanes = lanesOf(slide);
      countScale(slide, info.animate && step === 1 && info.prev === 0);
      // The race starts when the slide is entered and keeps running through the build.
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
     s-ff-wavefront: the SVG markup holds the final state of every build. Step 1 animates the rounds
     lighting up one anti-diagonal at a time (a "now" cursor sweeps the rounds, finished chunks drop
     into the bottom lane). Any other entry (jump, back, static) shows the final state at once.
     ------------------------------------------------------------------------------------------- */
  const WF = { x0: 290, pitch: 140, rounds: 9, ms: 330 };

  const wfReset = (els) => {
    clearAnims(els);
    els.forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
  };

  Deck.register('s-ff-wavefront', {
    steps: 2,
    update(slide, step, info) {
      const run = FF.run(slide);
      const nodes = Array.from(slide.querySelectorAll('.wave .nd'));
      const fins = Array.from(slide.querySelectorAll('.wave .fin'));
      const now = slide.querySelector('.wave .now');
      const all = nodes.concat(fins, [now]);
      wfReset(all);
      if (!(step === 1 && info.animate && info.prev === 0)) return;

      run.onCancel(() => wfReset(all));
      nodes.concat(fins).forEach((el) => { el.style.opacity = '0'; });
      const setNow = (x) => { now.setAttribute('x1', x); now.setAttribute('x2', x); };
      setNow(WF.x0 - 7);
      now.style.opacity = '.45';
      const seq = [];
      for (let n = 0; n < WF.rounds; n += 1) {
        seq.push([n === 0 ? 60 : WF.ms, () => {
          const x1 = WF.x0 + n * WF.pitch - 7;
          FF.tween({ from: x1, to: x1 + WF.pitch, dur: WF.ms, easing: FF.ease.linear, run, onUpdate: setNow });
          nodes.filter((el) => +el.dataset.round === n).forEach((el) => {
            FF.animate(el, [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'none' }],
              { duration: 300, easing: 'cubic-bezier(.2,.8,.3,1.2)' }, run);
          });
          fins.filter((el) => +el.dataset.round === n).forEach((el) => {
            FF.animate(el, [{ opacity: 0, transform: 'translateY(-90px)' }, { opacity: 1, transform: 'none' }],
              { duration: 380, delay: 180, easing: 'cubic-bezier(.3,.9,.3,1)' }, run);
          });
        }]);
      }
      seq.push([WF.ms + 200, () => {
        FF.animate(now, [{ opacity: 0.45 }, { opacity: 0 }], { duration: 300 }, run);
      }]);
      FF.sequence(run, seq);
    },
    leave(slide) {
      FF.cancel(slide);
    },
  });

  /* ---------------------------------------------------------------------------------------------
     s-ff-anchors: step 0 = the planner's clean anchors pop up along the 81-latent row (on entry);
     step 1 = the renderer chunk 6-8 and its in-flight history appear, then the reads to anchors
     0 / 10 / 20 draw in. The static markup already holds every end state.
     ------------------------------------------------------------------------------------------- */
  const pop = [{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'none' }];
  const fade = [{ opacity: 0 }, { opacity: 1 }];

  Deck.register('s-ff-anchors', {
    steps: 1,
    update(slide, step, info) {
      const svg = slide.querySelector('svg.tl');
      const anch = Array.from(svg.querySelectorAll('.g-anch rect'));
      const now = Array.from(svg.querySelectorAll('.g-now rect'));
      const arcs = Array.from(svg.querySelectorAll('.g-read .arc'));
      const heads = Array.from(svg.querySelectorAll('.g-read .arc-head'));
      const labels = Array.from(svg.querySelectorAll('.g-read text, .g-read .br-hist'));
      FF.cancel(slide);
      clearAnims([...anch, ...now, ...arcs, ...heads, ...labels]);
      if (!info.animate) return;
      const run = FF.run(slide);

      if (info.entering && step === 0) {
        anch.forEach((el, i) => FF.animate(el, pop, { duration: 420, delay: 250 + i * 70, fill: 'backwards' }, run));
      }
      if (step === 1 && info.prev === 0) {
        now.forEach((el, i) => FF.animate(el, pop, { duration: 360, delay: i * 45, fill: 'backwards' }, run));
        arcs.forEach((el, i) => FF.animate(el, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
          { duration: 700, delay: 380 + i * 140, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'backwards' }, run));
        heads.forEach((el, i) => FF.animate(el, fade, { duration: 200, delay: 1020 + i * 140, fill: 'backwards' }, run));
        labels.forEach((el) => FF.animate(el, fade, { duration: 420, delay: 600, fill: 'backwards' }, run));
      }
    },
    leave(slide) {
      FF.cancel(slide);
    },
  });
})();
