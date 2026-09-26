(() => {
  'use strict';

  // The page frame: the section bar follows the reader, every heading carries a copyable link, and
  // a link to a comparison sample (#20s/03) lands on the comparison viewer rather than the top.

  const toc = document.querySelector('[data-toc]');
  const tocLinks = toc ? [...toc.querySelectorAll('a[href^="#"]')] : [];
  const linkFor = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  // The bar lists the sections in page order, so it doubles as the list the scroll spy walks.
  const sections = [...linkFor.keys()].map((id) => document.getElementById(id)).filter(Boolean);

  // ---------- Heading permalinks ----------

  const pageUrl = () => location.href.split('#')[0];

  const copyText = (text) => {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('clipboard unavailable'));
  };

  const flash = (el, className, ms = 1600) => {
    el.classList.add(className);
    clearTimeout(el.flashTimer);
    el.flashTimer = setTimeout(() => el.classList.remove(className), ms);
  };

  const addPermalink = (heading, id) => {
    if (!heading || heading.querySelector('.permalink')) return;
    const link = document.createElement('a');
    link.className = 'permalink';
    link.href = `#${id}`;
    link.textContent = '#';
    link.title = 'Copy a link to this section';
    // Kept out of the accessibility tree so the heading still names its section cleanly.
    link.setAttribute('aria-hidden', 'true');
    link.tabIndex = -1;
    heading.appendChild(link);
  };

  document.querySelectorAll('section[id]').forEach((section) => {
    addPermalink(section.querySelector('.mechanism-head h2'), section.id);
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('.permalink');
    if (!link) return;
    // The link still navigates, so the address bar shows the section even when copying fails.
    copyText(pageUrl() + link.getAttribute('href'))
      .then(() => flash(link, 'is-copied'))
      .catch(() => {});
  });

  // ---------- BibTeX ----------

  const bibButton = document.querySelector('[data-copy-bibtex]');
  const bibCode = document.querySelector('[data-bibtex]');
  if (bibButton && bibCode && navigator.clipboard && window.isSecureContext) {
    bibButton.hidden = false;
    bibButton.addEventListener('click', () => {
      copyText(bibCode.textContent)
        .then(() => {
          bibButton.textContent = 'Copied';
          clearTimeout(bibButton.resetTimer);
          bibButton.resetTimer = setTimeout(() => { bibButton.textContent = 'Copy'; }, 1600);
        })
        .catch(() => {});
    });
  }

  // ---------- Sample links ----------

  // showcase.js owns #20s/03-style hashes and picks the sample; this only brings the viewer into
  // view, since no element carries that id for the browser to scroll to.
  const SAMPLE_HASH = /^#\d+s(?:\/\d+)?$/;
  const comparison = document.getElementById('comparison');
  const revealSample = () => {
    // Some tools percent-encode the slash when they copy a link (#20s%2F03).
    let hash = location.hash;
    try { hash = decodeURIComponent(hash); } catch (_) { /* keep the raw hash */ }
    if (comparison && SAMPLE_HASH.test(hash)) comparison.scrollIntoView();
  };
  window.addEventListener('hashchange', revealSample);
  revealSample();

  // ---------- Scroll spy ----------

  if (!toc || !sections.length) return;

  let current = null;
  const setCurrent = (id) => {
    if (id === current) return;
    current = id;
    tocLinks.forEach((a) => a.removeAttribute('aria-current'));
    const active = linkFor.get(id);
    if (!active) return;
    active.setAttribute('aria-current', 'true');
    // Keep the active item visible in the bar's own horizontal scroller. scrollIntoView would
    // interrupt a smooth page scroll in progress, so the offset is set directly.
    const li = active.parentElement;
    const left = li.offsetLeft - toc.offsetLeft;
    if (left < toc.scrollLeft || left + li.offsetWidth > toc.scrollLeft + toc.clientWidth) {
      toc.scrollLeft = left - (toc.clientWidth - li.offsetWidth) / 2;
    }
  };

  const update = () => {
    const bar = toc.closest('nav');
    const line = (bar ? bar.getBoundingClientRect().bottom : 0) + window.innerHeight * 0.25;
    let id = null;
    // The last section whose top has passed the reading line is the one being read.
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= line) id = section.id;
      else break;
    }
    // Short closing sections can never reach the reading line, so the page bottom selects the last,
    // unless the reader jumped to one of those closing sections and it is the one in view.
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) {
      const target = sections.find((s) => `#${s.id}` === location.hash);
      const top = target ? target.getBoundingClientRect().top : -1;
      id = target && top >= 0 && top <= line ? target.id : sections[sections.length - 1].id;
    }
    setCurrent(id);
  };

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  window.addEventListener('hashchange', schedule);
  update();
})();
