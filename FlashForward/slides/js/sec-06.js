/* Section 06 · Wrap-up: playback timeline under the synced demo videos (s-demo-35, s-demo-65). */
(() => {
  'use strict';

  const demo = () => ({
    update(slide, step, info) {
      const run = FF.run(slide);
      const tl = slide.querySelector('.d-tl');
      const video = slide.querySelector('[data-sync] video');
      if (!tl || !video) return;
      const total = parseFloat(tl.dataset.total) || 1;
      const fill = tl.querySelector('.d-tl-fill');
      const dot = tl.querySelector('.d-tl-dot');
      const now = tl.querySelector('.d-tl-now');
      let last = -1;
      const draw = (t) => {
        const p = FF.clamp(t / total);
        const pct = `${(p * 100).toFixed(2)}%`;
        fill.style.width = pct;
        dot.style.left = pct;
        const s = Math.floor(t);
        if (s !== last) { now.textContent = `${s} s`; last = s; }
      };
      draw(video.currentTime || 0);
      // Overview renders a still; its exit never calls leave(), so a loop started here would never stop.
      if (Deck.isStatic || (info && info.mode === 'overview')) return;
      let raf = 0;
      const tick = () => {
        if (!run.alive) return;
        draw(video.currentTime || 0);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      run.onCancel(() => cancelAnimationFrame(raf));
    },
    leave(slide) { FF.cancel(slide); },
  });

  Deck.register('s-demo-35', demo());
  Deck.register('s-demo-65', demo());
})();
