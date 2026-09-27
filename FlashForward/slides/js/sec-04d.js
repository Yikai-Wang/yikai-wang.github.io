/* Section 04d · s-regenerate (S17): splice strips, pulse ruler synced to the videos (step 0), seam bars (step 1). */
(() => {
  'use strict';

  const N = 21;          // latent positions 0..20 in the mini strips
  const CW = 22;         // cell width
  const GAP = 3.5;       // gap between cells
  const STRIP_W = N * CW + (N - 1) * GAP;
  const DUR = 20.06;     // clip length (s): 81 latents, 16 FPS
  const ANCHORS = [0, 10, 20, 30, 40, 50, 60, 70, 80];   // anchor latents (every 2.5 s)
  const RX0 = 24, RX1 = 1099;                            // ruler x range in its viewBox

  // centre time of latent k (Wan VAE: latent 0 = frame 0, latent k = frames 4k-3..4k)
  const latentTime = (k) => (k === 0 ? 0.03 : (4 * k - 1.5) / 16);
  const tx = (t) => RX0 + (RX1 - RX0) * (t / DUR);

  function buildStrip(svgEl) {
    const kind = svgEl.dataset.kind;
    const vbW = svgEl.viewBox.baseVal.width;
    const x0 = (vbW - STRIP_W) / 2 + (kind === 'splice' ? 84 : 0);   // splice: centre strip + side labels
    const g = FF.svg('g');
    for (let i = 0; i < N; i++) {
      const x = x0 + i * (CW + GAP);
      const isA = i % 10 === 0;
      if (isA) {
        const guide = kind === 'ours';
        g.appendChild(FF.svg('rect', {
          class: 'st-mark' + (guide ? ' is-guide' : ''), x: x, y: 2, width: CW, height: 26, rx: 5,
        }));
        const cx = x + CW / 2;
        g.appendChild(FF.svg('path', {
          class: 'st-arrow' + (guide ? ' is-guide' : ''),
          d: `M${cx} 34 V55 M${cx - 6} 49 L${cx} 56 L${cx + 6} 49`,
        }));
      }
      g.appendChild(FF.svg('rect', {
        class: 'st-cell' + (isA && kind === 'splice' ? ' is-anchor' : ''), x, y: 62, width: CW, height: 50, rx: 5,
      }));
    }
    if (kind === 'splice') {
      g.appendChild(FF.svg('text', { class: 'st-side t-a', x: x0 - 22, y: 24, 'text-anchor': 'end', text: 'planner anchors' }));
      g.appendChild(FF.svg('text', { class: 'st-side', x: x0 - 22, y: 95, 'text-anchor': 'end', text: 'output video' }));
    } else {
      g.appendChild(FF.svg('text', { class: 'st-side t-a', x: x0 + 5 * (CW + GAP) + CW / 2, y: 24, 'text-anchor': 'middle', text: 'guidance only' }));
    }
    svgEl.appendChild(g);
  }

  function buildRuler(svgEl) {
    const g = FF.svg('g');
    const AY = 70;                                        // axis baseline
    g.appendChild(FF.svg('rect', { class: 'ru-track', x: RX0, y: AY - 5, width: RX1 - RX0, height: 10, rx: 5 }));
    g.appendChild(FF.svg('rect', { class: 'ru-done', x: RX0, y: AY - 5, width: 0, height: 10, rx: 5 }));
    [0, 5, 10, 15, 20].forEach((s) => {
      const x = tx(s);
      g.appendChild(FF.svg('line', { class: 'ru-tick', x1: x, y1: AY + 8, x2: x, y2: AY + 16 }));
      g.appendChild(FF.svg('text', { class: 'ru-lab', x, y: AY + 44, 'text-anchor': 'middle', text: s + ' s' }));
    });
    ANCHORS.forEach((k) => {
      const x = tx(latentTime(k));
      const m = FF.svg('g', { class: 'ru-mark', 'data-t': latentTime(k).toFixed(3) });
      m.appendChild(FF.svg('circle', { class: 'ru-halo', cx: x, cy: AY - 22, r: 28 }));
      m.appendChild(FF.svg('rect', { class: 'ru-bar', x: x - 7, y: AY - 44, width: 14, height: 44, rx: 5 }));
      g.appendChild(m);
    });
    const ph = FF.svg('g', { class: 'ru-ph' });
    ph.appendChild(FF.svg('line', { x1: 0, y1: 12, x2: 0, y2: AY + 12 }));
    ph.appendChild(FF.svg('path', { d: 'M-9 0 H9 L0 12 Z' }));
    ph.setAttribute('transform', `translate(${tx(0)} 0)`);
    g.appendChild(ph);
    svgEl.appendChild(g);
  }

  function setBars(slide, t) {
    slide.querySelectorAll('.m-bar').forEach((b) => {
      b.setAttribute('width', (parseFloat(b.dataset.w) * t).toFixed(2));
    });
    slide.querySelectorAll('.m-val').forEach((v) => {
      const x = parseFloat(v.dataset.x);
      v.setAttribute('x', (12 + (x - 12) * t).toFixed(2));
      v.style.opacity = String(FF.clamp(t * 1.6 - 0.6));
    });
  }

  // Follow the first (leader) video of the synced group: playhead + pulse highlight.
  function startFollow(slide, run) {
    const vid = slide.querySelector('.rg-vids video');
    const ph = slide.querySelector('.ru-ph');
    const done = slide.querySelector('.ru-done');
    const marks = [...slide.querySelectorAll('.ru-mark')];
    let raf = 0;
    const tick = () => {
      const t = vid ? (vid.currentTime || 0) : 0;
      const x = tx(Math.min(t, DUR));
      ph.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
      done.setAttribute('width', Math.max(0, x - RX0).toFixed(1));
      // pulse highlight only while the leader plays, and not at the clip start (latent 0 has no seam)
      const live = !!vid && !vid.paused && t > 0.3;
      let hit = false;
      marks.forEach((m) => {
        const on = live && Math.abs(t - parseFloat(m.dataset.t)) < 0.22;
        m.classList.toggle('is-hit', on);
        hit = hit || on;
      });
      slide.classList.toggle('rg-hit', hit);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    run.onCancel(() => {
      cancelAnimationFrame(raf);
      slide.classList.remove('rg-hit');
      marks.forEach((m) => m.classList.remove('is-hit'));
    });
  }

  Deck.register('s-regenerate', {
    steps: 1,
    init(slide) {
      slide.querySelectorAll('.rg-strip').forEach(buildStrip);
      const ru = slide.querySelector('.rg-ruler');
      if (ru) buildRuler(ru);
    },
    update(slide, step, info) {
      const run = FF.run(slide);
      setBars(slide, 1);
      if (info.animate && step === 1) {
        setBars(slide, 0);
        FF.tween({ from: 0, to: 1, dur: 800, easing: FF.ease.out, run, onUpdate: (v) => setBars(slide, v) });
      }
      const isStatic = !!(window.Deck && window.Deck.isStatic);
      // no rAF loop on overview thumbnails or presenter previews (?embed never plays video)
      if (!isStatic && info.mode !== 'overview' && info.mode !== 'embed') startFollow(slide, run);
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
