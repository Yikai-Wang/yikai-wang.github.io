/* Section 03 · Key idea. The SVG markup in src/sections/03-idea.html already holds the final state of every
   build (static mode, jumps, print). This file only animates the forward transitions:
   s-wavefront build 1 (rounds light up one anti-diagonal at a time). s-race moved to 04c (js/sec-04c.js). */
(() => {
  'use strict';

  const clearInline = (els) => els.forEach((el) => {
    if (el.getAnimations) el.getAnimations().forEach((a) => a.cancel());
    el.style.opacity = '';
    el.style.transform = '';
  });

  // ---------- s-wavefront ----------
  const ROUND_MS = 330;
  const W = { x0: 290, p: 140, bw: 126 };

  Deck.register('s-wavefront', {
    steps: 2,
    update(slide, step, info) {
      const run = FF.run(slide);
      const nodes = Array.from(slide.querySelectorAll('.wave .nd'));
      const fins = Array.from(slide.querySelectorAll('.wave .fin'));
      const now = slide.querySelector('.wave .now');
      // clearInline also cancels the fill-forwards fade of the sweep line, so a replayed build shows it again.
      const reset = () => { clearInline(nodes.concat(fins, [now])); };
      reset();
      if (!(step === 1 && info.animate)) return;

      run.onCancel(reset);
      nodes.concat(fins).forEach((el) => { el.style.opacity = '0'; });
      const setNow = (x) => { now.setAttribute('x1', x); now.setAttribute('x2', x); };
      setNow(W.x0 - 7);
      now.style.opacity = '.45';
      const rounds = 9;
      const steps = [];
      for (let n = 0; n < rounds; n += 1) {
        steps.push([n === 0 ? 60 : ROUND_MS, () => {
          const x1 = W.x0 + n * W.p - 7;
          FF.tween({ from: x1, to: x1 + W.p, dur: ROUND_MS, easing: FF.ease.linear, run, onUpdate: setNow });
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
      steps.push([ROUND_MS + 200, () => {
        FF.animate(now, [{ opacity: 0.45 }, { opacity: 0 }], { duration: 300 }, run);
      }]);
      FF.sequence(run, steps);
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
