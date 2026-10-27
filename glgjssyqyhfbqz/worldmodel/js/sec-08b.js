/* 08b · Backup (was 03b, Space: consistent). Only s-control is scripted: its "before / after" pill follows the SEELE loop,
   which cycles four 3.2 s examples (input held to 1.2 s, crossfade to 1.7 s, output to 3.2 s). */
(() => {
  'use strict';

  const PERIOD = 3.2;
  const SWITCH = 1.45; // middle of the crossfade

  Deck.register('s-control', {
    update(slide) {
      const run = FF.run(slide);
      const video = slide.querySelector('.ctl-seele video');
      const pill = slide.querySelector('.ctl-ba');
      if (!video || !pill) return;
      const paint = () => {
        const t = video.currentTime % PERIOD;
        pill.classList.toggle('is-after', !video.paused && t >= SWITCH);
      };
      paint();
      if (Deck.isStatic) return;
      let raf = requestAnimationFrame(function tick() {
        paint();
        raf = requestAnimationFrame(tick);
      });
      run.onCancel(() => cancelAnimationFrame(raf));
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
