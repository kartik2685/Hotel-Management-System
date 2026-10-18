/* =====================================================================
 * Frontdesk HMS · pages/guests.js
 * Guest list with search and filters; selecting a guest shows their
 * profile. Profiles that are not on the page yet are loaded from the
 * server. The URL (?guest=…#guest-okafor) keeps the selection shareable,
 * and Enter in the search box searches every guest on the server.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$, toast } = HMS.util;

  function initGuests() {
    const list = $('[data-guest-list]');
    if (!list) return;
    const detail = $('[data-guest-detail]');
    const links = $$('.guest-link', list);
    const search = $('[data-guest-search]');
    const filterButtons = $$('[data-guest-filter]');
    const empty = $('[data-guest-empty]');
    let filter = '';
    let loading = null;

    const profileFor = (id) => document.getElementById('guest-' + id);

    /* Fetch one profile from the server and add it to the page. */
    async function load(link) {
      const response = await fetch('/guests/' + encodeURIComponent(link.dataset.guestId) + '/profile', {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
      });
      if (!response.ok) throw new Error('That profile could not be loaded. Reload the page and try again.');
      // DOMParser never runs scripts, and the server escapes every value.
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const article = doc.querySelector('article.profile');
      if (!article) throw new Error('That profile could not be loaded.');
      detail.append(document.adoptNode(article));
      return article;
    }

    async function select(id, moveFocus) {
      const link = links.find((l) => l.dataset.guest === id);
      if (!link) return;
      if (!profileFor(id)) {
        const request = (loading = load(link));
        try {
          await request;
        } catch (error) {
          toast(error.message);
          return;
        }
        if (loading !== request) return; // a newer click won
      }
      links.forEach((l) => {
        const active = l === link;
        l.classList.toggle('is-active', active);
        if (active) l.setAttribute('aria-current', 'true');
        else l.removeAttribute('aria-current');
      });
      $$('.profile', detail).forEach((profile) => profile.classList.toggle('is-active', profile.id === 'guest-' + id));
      if (!moveFocus) return;
      const profile = profileFor(id);
      // On narrow screens the profile sits below the list: bring it into view.
      if (window.matchMedia('(max-width: 991.98px)').matches) profile.scrollIntoView({ block: 'start' });
      profile.focus({ preventScroll: true });
    }

    function applyFilters() {
      const query = search ? search.value.trim().toLowerCase() : '';
      let shown = 0;
      links.forEach((link) => {
        const match =
          (!query || link.dataset.name.includes(query)) &&
          (!filter || link.dataset.tags.split(' ').includes(filter));
        link.parentElement.hidden = !match;
        if (match) shown += 1;
      });
      if (empty) empty.hidden = shown > 0;
    }

    links.forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const id = link.dataset.guest;
        history.replaceState(null, '', '/guests?' + new URLSearchParams({ guest: link.dataset.guestId }) + '#guest-' + id);
        select(id, true);
      });
    });
    if (search) {
      search.addEventListener('input', applyFilters);
      // Enter looks through every guest, not just the ones listed here.
      search.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const term = search.value.trim();
        window.location.href = '/guests' + (term ? '?' + new URLSearchParams({ q: term }) : '');
      });
    }
    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        filter = button.dataset.guestFilter;
        filterButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
        applyFilters();
      });
    });

    const idFromHash = () => {
      const id = window.location.hash.replace('#guest-', '');
      return links.some((link) => link.dataset.guest === id) ? id : null;
    };
    window.addEventListener('hashchange', () => {
      const id = idFromHash();
      if (id) select(id, true);
    });
    const current = links.find((link) => link.classList.contains('is-active'));
    if (links.length) select(idFromHash() || (current || links[0]).dataset.guest, false);
  }

  HMS.ready(initGuests);
})();
