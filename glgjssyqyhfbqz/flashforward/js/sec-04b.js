/* Section 04b · s-two-scales: small staggered entrances for the mini time axes and the 21-latent strip.
   The markup already holds the final state of every build; this script only adds motion when info.animate is true. */
(() => {
  'use strict';

  const POP = [
    { opacity: 0, transform: 'translateY(14px) scale(.7)' },
    { opacity: 1, transform: 'none' },
  ];
  const FADE = [{ opacity: 0 }, { opacity: 1 }];

  const pop = (el, delay, run, dur = 340) => FF.animate(el, POP, { duration: dur, delay, fill: 'both' }, run);
  const fade = (el, delay, run, dur = 380) => FF.animate(el, FADE, { duration: dur, delay, fill: 'both' }, run);

  // Drop finished/forwards animations so every visit starts from the plain (final) markup.
  const reset = (slide) => {
    slide.querySelectorAll('.mini *, .strip-fig *').forEach((el) => {
      el.getAnimations().forEach((a) => a.cancel());
    });
  };

  // Build 0 (entering): the dense history fills in left to right, up to "now".
  const animHist = (slide, run) => {
    const card = slide.querySelector('.hist .mini');
    card.querySelectorAll('.mn-hist').forEach((el, i) => pop(el, 350 + i * 45, run, 260));
    card.querySelectorAll('.mn-cur, .mn-now').forEach((el) => fade(el, 350 + 15 * 45, run));
  };

  // Build 1: the sparse anchors appear on both sides of "now".
  const animAnch = (slide, run) => {
    const card = slide.querySelector('.anch .mini');
    card.querySelectorAll('.mn-cur, .mn-now').forEach((el) => fade(el, 250, run));
    card.querySelectorAll('.mn-anch').forEach((el, i) => pop(el, 450 + i * 160, run));
  };

  // Build 2: anchors, then history chunk by chunk, then the current chunk; each brace and label follows its group.
  const animStrip = (slide, run) => {
    const fig = slide.querySelector('.strip-fig');
    const q = (s) => Array.from(fig.querySelectorAll(s));
    let t = 250;
    q('.c-anch').forEach((el, i) => pop(el, t + i * 70, run));
    fade(fig.querySelector('.br-anch'), t + 260, run);
    fade(fig.querySelector('.t-grp.t-anch'), t + 300, run);
    t += 380;
    q('.c-hist').forEach((el, i) => pop(el, t + i * 32 + Math.floor(i / 3) * 40, run, 300));
    t += 15 * 32 + 4 * 40;
    fade(fig.querySelector('.br-hist'), t, run);
    fade(fig.querySelector('.t-grp.t-hist'), t + 40, run);
    t += 160;
    q('.c-cur').forEach((el, i) => pop(el, t + i * 70, run));
    fade(fig.querySelector('.br-cur'), t + 260, run);
    fade(fig.querySelector('.t-grp.t-cur'), t + 300, run);
  };

  Deck.register('s-two-scales', {
    update(slide, step, info) {
      const run = FF.run(slide);
      reset(slide);
      if (!info.animate) return; // static markup already shows the final state of this build
      if (step === 0) animHist(slide, run);
      else if (step === 1) animAnch(slide, run);
      else if (step === 2) animStrip(slide, run);
    },
    leave(slide) {
      FF.cancel(slide);
      reset(slide);
    },
  });
})();
