/* =====================================================================
 * Frontdesk HMS · pages/guests.js
 * Guest list with search and filters; selecting a guest shows their
 * profile. The URL hash (#guest-okafor) keeps the selection shareable.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$ } = HMS.util;

  function initGuests() {
    const list = $('[data-guest-list]');
    if (!list) return;
    const links = $$('.guest-link', list);
    const profiles = $$('.profile');
    const search = $('[data-guest-search]');
    const filterButtons = $$('[data-guest-filter]');
    const empty = $('[data-guest-empty]');
    let filter = '';

    function select(id, moveFocus) {
      links.forEach((link) => {
        const active = link.dataset.guest === id;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
      profiles.forEach((profile) => profile.classList.toggle('is-active', profile.id === 'guest-' + id));
      if (!moveFocus) return;
      const profile = document.getElementById('guest-' + id);
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
        select(id, true);
        history.replaceState(null, '', '#guest-' + id);
      });
    });
    if (search) search.addEventListener('input', applyFilters);
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
    select(idFromHash() || links[0].dataset.guest, false);
  }

  HMS.ready(initGuests);
})();
