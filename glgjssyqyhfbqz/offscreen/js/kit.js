/* Small helpers shared by the scripted slides (window.FF).

   Animations are cancellable through a per-slide "run": starting a new run for a slide invalidates
   the previous one, so a slow animation never fights the one that replaced it.

     update(slide, step, info) {
       const run = FF.run(slide);              // cancels whatever this slide was animating
       if (!info.animate) { drawFinal(step); return; }
       FF.tween({ dur: 600, run, onUpdate: (t) => { ... } });
       if (!(await FF.wait(600, run))) return; // false once the run was cancelled
     }

   In ?static / print mode every tween jumps straight to its end state (the OS reduce-motion
   setting does not switch it on; see deck.js).
*/
(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const isStatic = () => !!(window.Deck && window.Deck.isStatic);

  const setAttrs = (node, attrs, svg) => {
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') {
        if (svg) node.setAttribute('class', v); else node.className = v;
      } else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
  };

  const append = (node, children) => {
    [].concat(children === undefined ? [] : children).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  };

  // FF.el('div', {class: 'card'}, ['text', child]) and FF.svg('rect', {x: 0, ...}) build DOM nodes.
  const el = (tag, attrs, children) => {
    const node = document.createElement(tag);
    setAttrs(node, attrs, false);
    return append(node, children);
  };

  const svg = (tag, attrs, children) => {
    const node = document.createElementNS(SVG_NS, tag);
    setAttrs(node, attrs, true);
    return append(node, children);
  };

  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const ease = {
    linear: (t) => t,
    in: (t) => t * t * t,
    out: (t) => 1 - (1 - t) ** 3,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    outBack: (t) => {
      const c1 = 1.4;
      const c3 = c1 + 1;
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    },
  };

  // ---------- Runs ----------

  const runs = new WeakMap();

  // Start a new animation run for a slide (or any key object) and cancel the previous one.
  const run = (key) => {
    const old = runs.get(key);
    if (old) old.cancel();
    const token = {
      alive: true,
      cleanups: [],
      cancel() {
        if (!this.alive) return;
        this.alive = false;
        this.cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
      },
      onCancel(fn) { this.cleanups.push(fn); },
    };
    runs.set(key, token);
    return token;
  };

  const cancel = (key) => {
    const old = runs.get(key);
    if (old) old.cancel();
    runs.delete(key);
  };

  // Resolves to true after ms, or to false as soon as the run is cancelled.
  const wait = (ms, token) => new Promise((resolve) => {
    if (token && !token.alive) { resolve(false); return; }
    if (isStatic()) { resolve(!token || token.alive); return; }
    const id = setTimeout(() => resolve(!token || token.alive), ms);
    if (token) token.onCancel(() => { clearTimeout(id); resolve(false); });
  });

  // Tween a value from 0 to 1 (or from/to) over dur ms. Returns a promise resolving to true when
  // finished, or false when cancelled. onUpdate(value, t) receives the eased value.
  const tween = ({ from = 0, to = 1, dur = 600, delay = 0, easing = ease.inOut, run: token, onUpdate, onDone } = {}) => {
    const fn = typeof easing === 'string' ? (ease[easing] || ease.inOut) : easing;
    return new Promise((resolve) => {
      const finish = () => {
        if (onUpdate) onUpdate(to, 1);
        if (onDone) onDone();
        resolve(true);
      };
      if (token && !token.alive) { resolve(false); return; }
      if (isStatic() || dur <= 0) { finish(); return; }
      let raf = 0;
      let timer = 0;
      let t0 = 0;
      const frame = (now) => {
        if (token && !token.alive) return;
        if (!t0) t0 = now;
        const t = clamp((now - t0) / dur);
        if (onUpdate) onUpdate(lerp(from, to, fn(t)), t);
        if (t < 1) raf = requestAnimationFrame(frame);
        else { if (onDone) onDone(); resolve(true); }
      };
      const begin = () => { raf = requestAnimationFrame(frame); };
      if (delay > 0) timer = setTimeout(begin, delay); else begin();
      if (token) token.onCancel(() => { cancelAnimationFrame(raf); clearTimeout(timer); resolve(false); });
    });
  };

  // Count a number up inside an element: FF.countUp(el, 21.3, {decimals: 1, suffix: ' s', run}).
  const countUp = (node, to, { from = 0, dur = 1200, decimals = 0, prefix = '', suffix = '', run: token, easing = ease.out } = {}) => {
    const fmt = (v) => `${prefix}${v.toFixed(decimals)}${suffix}`;
    return tween({ from, to, dur, easing, run: token, onUpdate: (v) => { node.textContent = fmt(v); } });
  };

  // Web Animations wrapper that respects static mode and runs: FF.animate(el, keyframes, {duration}).
  const animate = (node, keyframes, opts = {}, token) => {
    const o = { duration: 500, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards', ...opts };
    if (isStatic() || (token && !token.alive)) o.duration = 0;
    const a = node.animate(keyframes, o);
    if (token) token.onCancel(() => { try { a.finish(); } catch (e) { /* ignore */ } });
    return a.finished.then(() => !token || token.alive, () => false);
  };

  // Run [delayMs, fn] pairs in sequence; stops as soon as the run is cancelled.
  const sequence = async (token, steps) => {
    for (const [delay, fn] of steps) {
      if (!(await wait(delay, token))) return false;
      fn();
    }
    return true;
  };

  // Convert a data-step style range string ("2-4") or a number to a membership test.
  const inRange = (spec, n) => String(spec).split(',').some((part) => {
    const [a, b] = part.split('-').map((x) => parseInt(x, 10));
    return Number.isNaN(b) ? n === a : n >= a && n <= b;
  });

  window.FF = {
    el, svg, clamp, lerp, ease, run, cancel, wait, tween, countUp, animate, sequence, inRange,
    SVG_NS,
    // Shared palette (mirrors css/deck.css custom properties) for canvas / SVG drawing.
    color: {
      ours: '#2563B8',
      oursSoft: '#DCE6F4',
      oursDone: '#7CA1D4',
      anchor: '#B45309',
      anchorBg: '#FEF3C7',
      anchorText: '#92400E',
      kv: '#E11D48',
      done: '#15803D',
      slate: '#475569',
      sf: '#AEB4BD',
      hiar: '#6B7480',
      ink: '#14161A',
      muted: '#5D6167',
      line: '#D9DCE1',
      surface: '#F5F6F7',
      space: '#0F766E',
      spaceSoft: '#D5EDE9',
      time: '#2563B8',
      timeSoft: '#DCE6F4',
      act: '#EA580C',
      actSoft: '#FDE8D9',
      lang: '#6D28D9',
      langSoft: '#EBE3FB',
    },
  };
})();
