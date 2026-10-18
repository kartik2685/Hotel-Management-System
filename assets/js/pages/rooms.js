/* =====================================================================
 * Frontdesk HMS · pages/rooms.js
 * Room board: status filters, room search, attendant filter, the
 * clean/dirty switch and the housekeeper picker. Counts stay live.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$ } = HMS.util;

  function initRoomBoard() {
    const cards = $$('.room-card');
    if (!cards.length) return;
    const tiles = $$('[data-room-filter]');
    const search = $('[data-room-search]');
    const attendant = $('[data-room-attendant]');
    const result = $('[data-room-result]');
    const empty = $('[data-room-empty]');
    let filter = 'all';

    // The result line doubles as a live region for screen readers.
    const announce = (message) => { if (result) result.textContent = message; };
    const tally = (list) => {
      const counts = { occupied: 0, clean: 0, dirty: 0, ooo: 0 };
      list.forEach((card) => { counts[card.dataset.status] += 1; });
      return counts;
    };

    function updateCounts() {
      const counts = tally(cards);
      const occupiedClean = cards.filter((c) => c.dataset.status === 'occupied' && c.dataset.housekeeping === 'clean').length;
      Object.keys(counts).forEach((status) => {
        const el = $('[data-status-count="' + status + '"]');
        if (el) el.textContent = counts[status];
      });
      const split = $('[data-occupied-split]');
      if (split) split.textContent = occupiedClean + ' clean · ' + (counts.occupied - occupiedClean) + ' to service';

      $$('.floor').forEach((floor) => {
        const f = tally($$('.room-card', floor));
        const stats = $('[data-floor-stats]', floor);
        if (stats) {
          stats.textContent = f.occupied + ' occupied · ' + f.clean + ' clean · ' + f.dirty + ' dirty' +
            (f.ooo ? ' · ' + f.ooo + ' out of order' : '');
        }
      });
    }

    function applyFilters(quiet) {
      const number = search ? search.value.trim() : '';
      const who = attendant ? attendant.value : '';
      let shown = 0;
      cards.forEach((card) => {
        const match =
          (filter === 'all' || card.dataset.status === filter) &&
          (!number || card.dataset.room.startsWith(number)) &&
          (!who || $('[data-assign]', card).value === who);
        card.hidden = !match;
        if (match) shown += 1;
      });
      $$('.floor').forEach((floor) => { floor.hidden = !$$('.room-card:not([hidden])', floor).length; });
      if (empty) empty.hidden = shown > 0;
      if (!quiet) announce('Showing ' + shown + (shown === 1 ? ' room' : ' rooms'));
    }

    const pressTile = (value) => {
      tiles.forEach((tile) => tile.setAttribute('aria-pressed', String(tile.dataset.roomFilter === value)));
    };

    tiles.forEach((tile) => {
      tile.addEventListener('click', () => {
        filter = tile.dataset.roomFilter;
        pressTile(filter);
        applyFilters();
      });
    });
    if (search) search.addEventListener('input', () => applyFilters());
    if (attendant) attendant.addEventListener('change', () => applyFilters());

    const reset = $('[data-room-reset]');
    if (reset) {
      reset.addEventListener('click', () => {
        filter = 'all';
        pressTile('all');
        if (search) search.value = '';
        if (attendant) attendant.value = '';
        applyFilters();
      });
    }

    // Clean / dirty switch. A vacant room's status follows housekeeping.
    document.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-clean-toggle]');
      if (!toggle || toggle.disabled) return;
      const card = toggle.closest('.room-card');
      const clean = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(clean));
      $('[data-clean-label]', toggle).textContent = clean ? 'Clean' : 'Dirty';
      card.dataset.housekeeping = clean ? 'clean' : 'dirty';
      if (card.dataset.occupancy === 'vacant') card.dataset.status = card.dataset.housekeeping;

      card.classList.remove('is-flashing');
      void card.offsetWidth; // restart the animation
      card.classList.add('is-flashing');
      updateCounts();
      applyFilters(true);
      announce('Room ' + card.dataset.room + ' marked ' + card.dataset.housekeeping);
    });

    document.addEventListener('change', (event) => {
      const select = event.target.closest('[data-assign]');
      if (!select) return;
      const card = select.closest('.room-card');
      announce('Room ' + card.dataset.room + (select.value ? ' assigned to ' + select.selectedOptions[0].textContent : ' unassigned'));
      if (attendant && attendant.value) applyFilters(true);
    });

    updateCounts();
  }

  HMS.ready(initRoomBoard);
})();
