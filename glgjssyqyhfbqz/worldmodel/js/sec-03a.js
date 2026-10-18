/* 03a · Space: persist. s-c2fseg (flipbook playhead, one pass), s-street (top-down observed / never observed).
   s-asuka is markup + CSS only. */
(() => {
  'use strict';

  const C = FF.color;
  const isStatic = () => !!(window.Deck && window.Deck.isStatic);

  /* ---------- s-c2fseg: the playhead walks over the 8 frames once, then the grid rests ---------- */
  Deck.register('s-c2fseg', {
    update(slide) {
      const run = FF.run(slide);
      const frames = [...slide.querySelectorAll('.fr')];
      const clear = () => frames.forEach((f) => f.classList.remove('now'));
      clear();
      if (isStatic()) { run.onCancel(clear); return; }
      // One timer chain and one cleanup (FF.wait in a loop would add a cancel hook per frame).
      let i = 0;
      let t = 0;
      const tick = () => {
        if (!run.alive) return;
        frames.forEach((f, j) => f.classList.toggle('now', j === i));
        const last = i === frames.length - 1;
        i += 1;
        t = setTimeout(last ? clear : tick, last ? 1600 : 520);
      };
      t = setTimeout(tick, 700);
      run.onCancel(() => { clearTimeout(t); clear(); });
    },
    leave(slide) { FF.cancel(slide); },
  });

  /* ---------- s-street: top-down schematic ---------- */
  // Geometry in viewBox units (900 x 700).
  const G = {
    x0: 30, cols: 35, cell: 24,              // cell band: x 30..870
    walkY: 112, walkRows: 2,                 // sidewalk rows (y 112..160)
    laneY: 160, laneRows: 4,                 // parking lane rows (y 160..256)
    roadY: 256, roadH: 200,                  // road y 256..456, centre line at 330
    egoY: 393, egoW: 96, egoH: 50,
    cars: [[110, 112], [400, 112], [690, 112]], // [x, w]; y 180..236, wide gaps between them
    carY: 180, carH: 56,
    half: (68 * Math.PI) / 180,              // forward camera, +-68 deg (schematic)
    range: 760,                              // x-reach of the drawn view cone
    sub: 3,                                  // 3x3 probes: a cell is observed once any part of it is seen
    startX: -700, endX: 690,                 // the drive (ego left edge) starts off-screen
  };
  // With this layout ~16% of the cells stay never observed: the strips under and right behind each car.

  const segHitsRect = (ax, ay, bx, by, r) => {
    // Liang-Barsky clip of segment a->b against rect r = {x, y, w, h}.
    let t0 = 0; let t1 = 1;
    const dx = bx - ax; const dy = by - ay;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - r.x, r.x + r.w - ax, ay - r.y, r.y + r.h - ay];
    for (let i = 0; i < 4; i += 1) {
      if (p[i] === 0) { if (q[i] < 0) return false; } else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return t0 <= t1;
  };

  const street = { built: false };

  const buildStreet = (svgEl) => {
    const S = FF.svg;
    const rows = G.walkRows + G.laneRows;
    const bandW = G.cols * G.cell;
    const rects = G.cars.map(([x, w]) => ({ x, y: G.carY, w, h: G.carH }));

    // ground
    const ground = S('g', {}, [
      S('rect', { x: 0, y: G.walkY - 16, width: 900, height: G.walkRows * G.cell + 16, fill: '#e4e7eb' }),
      S('rect', { x: 0, y: G.laneY, width: 900, height: G.laneRows * G.cell, fill: '#f3f4f6' }),
      S('line', { x1: 0, y1: G.laneY, x2: 900, y2: G.laneY, stroke: '#b8bec6', 'stroke-width': 3 }),
      S('rect', { x: 0, y: G.roadY, width: 900, height: G.roadH, fill: '#dfe3e8' }),
      S('line', { x1: 0, y1: 330, x2: 900, y2: 330, stroke: '#fff', 'stroke-width': 5, 'stroke-dasharray': '34 26' }),
      S('line', { x1: 0, y1: G.roadY, x2: 900, y2: G.roadY, stroke: '#fff', 'stroke-width': 3, 'stroke-dasharray': '8 10', opacity: 0.9 }),
    ]);

    // cells
    const cellG = S('g', {});
    const cells = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < G.cols; c += 1) {
        const x = G.x0 + c * G.cell;
        const y = G.walkY + r * G.cell;
        const probes = [];
        for (let a = 0; a < G.sub; a += 1) {
          for (let b = 0; b < G.sub; b += 1) probes.push([x + ((a + 0.5) * G.cell) / G.sub, y + ((b + 0.5) * G.cell) / G.sub]);
        }
        const sees = (cam) => probes.some(([px, py]) => {
          const dx = px - cam; const dy = G.egoY - py;
          if (dx <= 0 || dx > G.range || Math.atan2(dy, dx) > G.half) return false;
          return !rects.some((rc) => segHitsRect(cam, G.egoY, px, py, rc));
        });
        let seen = Infinity;
        for (let cam = G.startX + G.egoW; cam <= G.endX + G.egoW && cam < x + G.cell; cam += 2) {
          if (sees(cam)) { seen = cam; break; }
        }
        const grid = S('rect', { x: x + 1, y: y + 1, width: G.cell - 2, height: G.cell - 2, rx: 3, fill: 'none', stroke: '#cdd2d8', 'stroke-width': 1.2 });
        const obs = S('rect', { x: x + 1.5, y: y + 1.5, width: G.cell - 3, height: G.cell - 3, rx: 3, fill: C.done, opacity: 0 });
        const un = S('rect', { x: x + 1.5, y: y + 1.5, width: G.cell - 3, height: G.cell - 3, rx: 3, fill: C.time, opacity: 0 });
        cellG.append(grid, obs, un);
        cells.push({ x, seen, obs, un });
      }
    }

    // parked cars (to be removed)
    const carG = S('g', {});
    const cars = rects.map((rc) => {
      const body = S('rect', { x: rc.x, y: rc.y, width: rc.w, height: rc.h, rx: 16, fill: '#64748b' });
      const glass = S('rect', { x: rc.x + rc.w * 0.58, y: rc.y + 8, width: rc.w * 0.2, height: rc.h - 16, rx: 6, fill: '#cbd5e1' });
      const glass2 = S('rect', { x: rc.x + rc.w * 0.16, y: rc.y + 10, width: rc.w * 0.14, height: rc.h - 20, rx: 5, fill: '#cbd5e1' });
      const ghost = S('rect', { x: rc.x, y: rc.y, width: rc.w, height: rc.h, rx: 16, fill: 'none', stroke: '#475569', 'stroke-width': 3, 'stroke-dasharray': '10 8', opacity: 0 });
      const solid = S('g', {}, [body, glass, glass2]);
      carG.append(solid, ghost);
      return { solid, ghost };
    });

    // ego car + forward frustum
    const clip = S('clipPath', { id: 's-street-clip' }, [S('rect', { x: 0, y: G.walkY - 16, width: 900, height: G.roadY + G.roadH - G.walkY + 16 })]);
    const L = G.range; const tanH = Math.tan(G.half);
    const frustum = S('polygon', { points: `0,0 ${L},${-L * tanH} ${L},${L * tanH}`, fill: C.space, opacity: 0.13 });
    const fEdge = S('polyline', { points: `${L},${-L * tanH} 0,0 ${L},${L * tanH}`, fill: 'none', stroke: C.space, 'stroke-width': 2, opacity: 0.5 });
    const camG = S('g', { 'clip-path': 'url(#s-street-clip)' }, [S('g', { class: 'fr' }, [frustum, fEdge])]);
    const ego = S('g', {}, [
      S('rect', { x: 0, y: -G.egoH / 2, width: G.egoW, height: G.egoH, rx: 14, fill: C.space }),
      S('rect', { x: G.egoW * 0.56, y: -G.egoH / 2 + 7, width: G.egoW * 0.18, height: G.egoH - 14, rx: 5, fill: '#bfe6df' }),
      S('circle', { cx: G.egoW - 2, cy: 0, r: 7, fill: '#fff', stroke: C.space, 'stroke-width': 3 }),
    ]);
    const trail = S('line', { x1: G.startX, y1: G.egoY, x2: G.startX, y2: G.egoY, stroke: C.space, 'stroke-width': 4, 'stroke-dasharray': '2 12', 'stroke-linecap': 'round', opacity: 0.55 });

    // time-reversal arrow (step 2), above the band
    const arrY = 50;
    const arrow = S('g', { opacity: 0 }, [
      S('line', { x1: G.x0 + bandW, y1: arrY, x2: G.x0 + 26, y2: arrY, stroke: C.time, 'stroke-width': 5 }),
      S('polygon', { points: `${G.x0},${arrY} ${G.x0 + 30},${arrY - 14} ${G.x0 + 30},${arrY + 14}`, fill: C.time }),
      S('rect', { x: 150, y: arrY - 24, width: 600, height: 48, fill: '#fff' }),
      S('text', { x: 450, y: arrY + 9, 'text-anchor': 'middle', class: 't-fill', text: 'inpaint backwards in time: latest frame first' }),
    ]);

    // legend
    const lgY = 548;
    const sw = (y, fill, op = 1) => S('rect', { x: G.x0, y: y - 15, width: 30, height: 30, rx: 5, fill, 'fill-opacity': op });
    const legend = S('g', {}, [
      sw(lgY, C.done, 0.62),
      S('text', { x: G.x0 + 48, y: lgY + 9, class: 't-obs', text: 'observed in some frame' }),
    ]);
    const legendUn = S('g', { opacity: 0 }, [
      sw(lgY + 56, C.time, 0.42),
      S('text', { x: G.x0 + 48, y: lgY + 65, class: 't-un', text: 'never observed: the only cells to inpaint' }),
    ]);
    const legendBack = S('g', { opacity: 0 }, [
      sw(lgY + 112, C.time, 0.92),
      S('text', { x: G.x0 + 48, y: lgY + 121, class: 't-fill', text: 'inpainted, then written back into the 3D scene' }),
    ]);

    svgEl.append(S('defs', {}, [clip]), ground, cellG, carG, camG, S('g', { 'clip-path': 'url(#s-street-clip)' }, [trail, ego]), arrow, legend, legendUn, legendBack);
    Object.assign(street, { built: true, cells, cars, ego, camG, trail, arrow, legendUn, legendBack });
    street.maxX = G.x0 + bandW;
  };

  const setDrive = (p) => {
    const x = FF.lerp(G.startX, G.endX, p);
    const cam = x + G.egoW;
    street.ego.setAttribute('transform', `translate(${x} ${G.egoY})`);
    street.camG.firstChild.setAttribute('transform', `translate(${cam - 2} ${G.egoY})`);
    street.trail.setAttribute('x2', x);
    street.cells.forEach((c) => { c.obs.setAttribute('opacity', c.seen <= cam ? 0.62 : 0); });
  };

  const setReveal = (q) => {
    street.cars.forEach((c) => {
      c.solid.setAttribute('opacity', 1 - q);
      c.ghost.setAttribute('opacity', q);
    });
    street.camG.setAttribute('opacity', 1 - q);
    street.cells.forEach((c) => { c.un.setAttribute('opacity', c.seen === Infinity ? 0.42 * q : 0); });
    street.legendUn.setAttribute('opacity', q);
  };

  // Time-reversal fill: sweep from the far end (latest frames) back to the start.
  const setFill = (r) => {
    const span = street.maxX - G.x0;
    street.cells.forEach((c) => {
      if (c.seen !== Infinity) return;
      const k = FF.clamp((r * (span + 120) - (street.maxX - c.x - G.cell)) / 120);
      c.un.setAttribute('opacity', 0.42 + 0.5 * k);
    });
    street.arrow.setAttribute('opacity', FF.clamp(r * 3));
    street.legendBack.setAttribute('opacity', FF.clamp(r * 1.4 - 0.4));
  };

  const renderStreet = (step) => {
    setDrive(step >= 1 ? 1 : 0);
    setReveal(step >= 1 ? 1 : 0);
    if (step >= 2) setFill(1);
    else { street.arrow.setAttribute('opacity', 0); street.legendBack.setAttribute('opacity', 0); }
  };

  Deck.register('s-street', {
    steps: 2,
    init(slide) {
      const svgEl = slide.querySelector('svg.map');
      if (svgEl && !street.built) buildStreet(svgEl);
    },
    update(slide, step, info) {
      const run = FF.run(slide);
      if (!street.built) buildStreet(slide.querySelector('svg.map'));
      if (!info.animate || isStatic() || step === 0 || info.prev !== step - 1) { renderStreet(step); return; }
      if (step === 1) {
        renderStreet(0);
        (async () => {
          if (!(await FF.wait(500, run))) return;
          if (!(await FF.tween({ dur: 3000, easing: FF.ease.inOut, run, onUpdate: setDrive }))) return;
          await FF.tween({ dur: 700, easing: FF.ease.out, run, onUpdate: setReveal });
        })();
      } else if (step === 2) {
        renderStreet(1);
        FF.tween({ dur: 1600, easing: FF.ease.linear, run, onUpdate: setFill });
      }
      run.onCancel(() => renderStreet(step));
    },
    leave(slide) { FF.cancel(slide); },
  });
})();
