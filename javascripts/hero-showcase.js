(function () {
  'use strict';

  var root = document.getElementById('hero-showcase');
  if (!root) return;

  var panels = Array.prototype.slice.call(root.querySelectorAll('.hero-slide'));
  var dots = Array.prototype.slice.call(document.querySelectorAll('.hero-dot'));
  var captions = Array.prototype.slice.call(document.querySelectorAll('.hero-caption-item'));
  var photo = document.getElementById('hero-photo');
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var current = 0;

  function restartNvg() {
    if (!photo) return;
    var source = reduceMotion ? photo.getAttribute('data-static-src') :
      photo.getAttribute('data-animated-src');
    if (!source) return;
    photo.removeAttribute('src');
    window.requestAnimationFrame(function () { photo.src = source; });
  }

  function show(index, focusDot) {
    if (index < 0) index = panels.length - 1;
    if (index >= panels.length) index = 0;

    panels.forEach(function (panel, i) {
      var active = i === index;
      panel.classList.toggle('is-active', active);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    captions.forEach(function (caption, i) {
      var active = i === index;
      caption.classList.toggle('is-active', active);
      caption.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    dots.forEach(function (dot, i) {
      var active = i === index;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-selected', active ? 'true' : 'false');
      dot.setAttribute('tabindex', active ? '0' : '-1');
    });

    if (index === 0 && current !== 0) restartNvg();
    current = index;
    if (focusDot && dots[index]) dots[index].focus();
  }

  dots.forEach(function (dot, index) {
    dot.addEventListener('click', function () { show(index, false); });
    dot.addEventListener('keydown', function (event) {
      var next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = current + 1;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = current - 1;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = panels.length - 1;
      if (next !== null) {
        event.preventDefault();
        show(next, true);
      }
    });
  });
})();
