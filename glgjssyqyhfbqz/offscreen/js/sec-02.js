/* 02a · Thesis (builder B): the clock test (s-clock, steps 0-3: look, look away, three answers, four
   requirements; steps 2-3 are CSS builds). s-world is static markup + builds. */
(() => {
  'use strict';

  const VF_Y = 70;
  const VF_AT_CLOCK = 110;   // viewfinder x when framing the clock (clock centre x = 330)
  const VF_AT_WINDOW = 990;  // viewfinder x when framing the window (window centre x = 1210)
  const CLOCK = { cx: 330, cy: 270, r: 150 };

  // Hand angles in degrees clockwise from 12.
  const angles = (h, m, s) => ({
    hour: (h % 12) * 30 + m * 0.5 + s / 120,
    minute: m * 6 + s * 0.1,
    second: s * 6,
  });

  // Draw a wall clock: face + 60 ticks into faceParent, hands into handParent.
  const buildClock = (faceParent, handParent, cx, cy, r) => {
    const face = FF.svg('g', { transform: `translate(${cx} ${cy})` });
    face.appendChild(FF.svg('circle', { class: 'cf-face', r, 'stroke-width': (r * 0.075).toFixed(1) }));
    for (let i = 0; i < 60; i += 1) {
      const major = i % 5 === 0;
      const a = (i * 6 * Math.PI) / 180;
      const r1 = r * (major ? 0.70 : 0.80);
      const r2 = r * 0.87;
      face.appendChild(FF.svg('line', {
        class: 'cf-tick',
        x1: (Math.sin(a) * r1).toFixed(2), y1: (-Math.cos(a) * r1).toFixed(2),
        x2: (Math.sin(a) * r2).toFixed(2), y2: (-Math.cos(a) * r2).toFixed(2),
        'stroke-width': (r * (major ? 0.045 : 0.016)).toFixed(2),
      }));
    }
    faceParent.appendChild(face);

    const hands = FF.svg('g', { transform: `translate(${cx} ${cy})` });
    const hand = (cls, len, tail, w) => {
      const g = FF.svg('g');
      g.appendChild(FF.svg('line', { class: cls, x1: 0, y1: (r * tail).toFixed(1), x2: 0, y2: (-r * len).toFixed(1), 'stroke-width': (r * w).toFixed(1) }));
      hands.appendChild(g);
      return g;
    };
    const hour = hand('cf-hand', 0.48, 0.1, 0.075);
    const minute = hand('cf-hand', 0.74, 0.12, 0.05);
    const second = hand('cf-sec', 0.80, 0.2, 0.018);
    hands.appendChild(FF.svg('circle', { class: 'cf-cap', r: (r * 0.065).toFixed(1) }));
    hands.appendChild(FF.svg('circle', { class: 'cf-cap2', r: (r * 0.028).toFixed(1) }));
    handParent.appendChild(hands);

    const rot = (g, deg) => g.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
    return {
      set(h, m, s = 0) {
        const a = angles(h, m, s);
        rot(hour, a.hour); rot(minute, a.minute); rot(second, a.second);
      },
      setRaw(hourDeg, minuteDeg, secondDeg) {
        rot(hour, hourDeg); rot(minute, minuteDeg); rot(second, secondDeg);
      },
    };
  };

  Deck.register('s-clock', {
    steps: 3,

    init(slide) {
      const room = slide.querySelector('.room');
      this.stage = slide.querySelector('.cstage');
      this.vf = room.querySelector('.vf');
      this.hole = room.querySelector('.hole');
      this.counter = room.querySelector('.counter');
      this.clock = buildClock(room.querySelector('.face-layer'), room.querySelector('.hand-layer'), CLOCK.cx, CLOCK.cy, CLOCK.r);
      slide.querySelectorAll('.m-clock').forEach((g) => {
        const c = buildClock(g, g, 228, 140, 108);
        c.set(+g.dataset.h, +g.dataset.m, 0);
      });
      this.sec = 0;
    },

    setVF(x) {
      this.vf.setAttribute('transform', `translate(${x.toFixed(1)} ${VF_Y})`);
      this.hole.setAttribute('x', x.toFixed(1));
    },

    // Final state of any step, drawn immediately.
    render(step) {
      this.setVF(step === 1 ? VF_AT_WINDOW : VF_AT_CLOCK);
      if (step === 0) this.clock.set(10, 10, 0);
      else this.clock.set(10, 15, 0);
      this.stage.classList.toggle('ghost', step === 1);
      this.counter.textContent = '+5 min';
    },

    update(slide, step, info) {
      const run = FF.run(slide);
      const anim = !!info.animate;
      // Cards wait for the viewfinder to swing back before they split out (animated step 2 only).
      this.stage.style.setProperty('--clk-delay', anim && step === 2 && info.prev === 1 ? '0.85s' : '0s');
      this.render(step);
      if (!anim) return;

      if (step === 0) {
        // Ambient: the clock ticks while the speaker sets the scene.
        this.sec = 0;
        const id = setInterval(() => {
          this.sec = (this.sec + 1) % 60;
          this.clock.set(10, 10, this.sec);
        }, 1000);
        run.onCancel(() => clearInterval(id));
        return;
      }

      if (step === 1 && info.prev === 0) {
        // Pan to the window; five minutes pass on the (now unseen) clock.
        const a0 = angles(10, 10, this.sec);
        const a1 = angles(10, 15, 0);
        const secEnd = 5 * 360;
        this.setVF(VF_AT_CLOCK);
        this.clock.setRaw(a0.hour, a0.minute, a0.second);
        this.counter.textContent = '+0 min';
        FF.tween({
          dur: 900, easing: FF.ease.inOut, run,
          onUpdate: (t) => this.setVF(FF.lerp(VF_AT_CLOCK, VF_AT_WINDOW, t)),
        });
        FF.tween({
          dur: 2500, delay: 250, easing: FF.ease.inOut, run,
          onUpdate: (t) => {
            this.clock.setRaw(FF.lerp(a0.hour, a1.hour, t), FF.lerp(a0.minute, a1.minute, t), FF.lerp(a0.second, secEnd, t));
          },
        });
        FF.wait(250, run).then((ok) => {
          if (ok) FF.countUp(this.counter, 5, { dur: 2500, prefix: '+', suffix: ' min', run, easing: FF.ease.inOut });
        });
        return;
      }

      if (step === 2 && info.prev === 1) {
        // Look back: the viewfinder swings home, then the answer splits into three cards (CSS, delayed).
        this.stage.classList.add('ghost');
        this.setVF(VF_AT_WINDOW);
        FF.tween({
          dur: 800, easing: FF.ease.inOut, run,
          onUpdate: (t) => this.setVF(FF.lerp(VF_AT_WINDOW, VF_AT_CLOCK, t)),
          onDone: () => { if (run.alive) this.stage.classList.remove('ghost'); },
        });
      }
    },

    leave(slide) {
      FF.cancel(slide);
    },
  });
})();
