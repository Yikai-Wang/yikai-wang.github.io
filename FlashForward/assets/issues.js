(() => {
  'use strict';

  // The three rejected designs. They are only loaded once the section is actually on screen, and
  // they stop again when it leaves, so three extra decoders never run behind the rest of the page.

  const host = document.querySelector('[data-issues]');
  if (!host) return;

  const videos = [...host.querySelectorAll('video')];
  if (!videos.length) return;

  const playButton = host.querySelector('[data-issue="play"]');
  const state = { playing: false, held: false, loaded: false };

  const setPlaying = (playing) => {
    state.playing = playing;
    videos.forEach((v) => {
      if (playing) {
        const promise = v.play();
        if (promise) promise.catch(() => {});
      } else {
        v.pause();
      }
    });
    playButton.textContent = playing ? 'Pause' : 'Play';
    playButton.classList.toggle('is-paused', !playing);
  };

  const load = () => {
    if (state.loaded) return;
    state.loaded = true;
    videos.forEach((v) => {
      v.preload = 'auto';
      v.load();
    });
  };

  const ACTIONS = {
    play: () => {
      state.held = state.playing;
      load();
      setPlaying(!state.playing);
    },
    restart: () => {
      load();
      videos.forEach((v) => { v.currentTime = 0; });
      state.held = false;
      setPlaying(true);
    },
  };

  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-issue]');
    if (button && ACTIONS[button.dataset.issue]) ACTIONS[button.dataset.issue]();
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setPlaying(false);
  } else if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (state.held) return;
          load();
          setPlaying(true);
        } else if (state.playing) {
          setPlaying(false);
        }
      });
      // same middle-band rule as the diagrams: a section peeking in from the bottom is not
      // being looked at yet
    }, { threshold: 0.3, rootMargin: '-15% 0px -15% 0px' }).observe(host);
  } else {
    load();
    setPlaying(true);
  }
})();
