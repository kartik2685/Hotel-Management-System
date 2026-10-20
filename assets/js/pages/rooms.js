/* =====================================================================
 * Frontdesk HMS · pages/rooms.js
 * Room board: status filters, room search, attendant filter, the
 * clean/dirty switch and the housekeeper picker. Counts stay live.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$, h, api, toast } = HMS.util;

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
    // Cards keep their occupancy status (occupied / vacant), so dirty is read from the
    // housekeeping state: a guest's room can be waiting for a clean too.
    const tally = (list) => {
      const counts = { occupied: 0, clean: 0, dirty: 0, ooo: 0 };
      list.forEach((card) => {
        const status = card.dataset.status;
        if (status === 'ooo') { counts.ooo += 1; return; }
        if (status === 'occupied') counts.occupied += 1;
        if (status === 'clean') counts.clean += 1;
        if (card.dataset.housekeeping === 'dirty') counts.dirty += 1;
      });
      return counts;
    };

    // The rooms badge in the sidebar follows the board as rooms are flipped.
    function showSidebarDirty(count) {
      const link = $('.sidenav__link[href="/rooms"]');
      if (!link) return;
      let badge = $('[data-nav-badge="rooms"]', link);
      if (!badge) {
        badge = h('span', { class: 'sidenav__badge sidenav__badge--warn', 'data-nav-badge': 'rooms' });
        link.append(badge);
      }
      badge.textContent = count ? count + ' dirty' : '';
      badge.hidden = !count;
    }

    function updateCounts() {
      const counts = tally(cards);
      const occupied = cards.filter((c) => c.dataset.status === 'occupied');
      const occupiedClean = occupied.filter((c) => c.dataset.housekeeping === 'clean').length;
      const occupiedDirty = occupied.length - occupiedClean;
      Object.keys(counts).forEach((status) => {
        const el = $('[data-status-count="' + status + '"]');
        if (el) el.textContent = counts[status];
      });
      const split = $('[data-occupied-split]');
      if (split) split.textContent = occupiedClean + ' clean · ' + occupiedDirty + ' to service';
      const dirtyNote = $('[data-dirty-note]');
      if (dirtyNote) {
        dirtyNote.textContent = counts.dirty
          ? occupiedDirty + ' occupied · ' + (counts.dirty - occupiedDirty) + ' vacant'
          : 'Vacant, needs a clean';
      }
      showSidebarDirty(counts.dirty);

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
        // Dirty shows every room waiting for a clean, including occupied ones.
        const byStatus = filter === 'all'
          || (filter === 'dirty' ? card.dataset.status !== 'ooo' && card.dataset.housekeeping === 'dirty' : card.dataset.status === filter);
        const match =
          byStatus &&
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
    function setClean(toggle, clean) {
      const card = toggle.closest('.room-card');
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
    }

    document.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-clean-toggle]');
      if (!toggle || toggle.disabled) return;
      const card = toggle.closest('.room-card');
      const clean = toggle.getAttribute('aria-checked') !== 'true';
      setClean(toggle, clean);
      api('/api/rooms/' + encodeURIComponent(card.dataset.room) + '/status', { status: clean ? 'clean' : 'dirty' }).catch((error) => {
        setClean(toggle, !clean); // put it back
        toast(error.message);
      });
    });

    // Remember the previous housekeeper so a refused change can be undone.
    document.addEventListener('focusin', (event) => {
      const select = event.target.closest('[data-assign]');
      if (select) select.dataset.previous = select.value;
    });
    document.addEventListener('change', (event) => {
      const select = event.target.closest('[data-assign]');
      if (!select) return;
      const card = select.closest('.room-card');
      announce('Room ' + card.dataset.room + (select.value ? ' assigned to ' + select.selectedOptions[0].textContent : ' unassigned'));
      if (attendant && attendant.value) applyFilters(true);
      api('/api/rooms/' + encodeURIComponent(card.dataset.room) + '/attendant', { attendant: select.value }).catch((error) => {
        select.value = select.dataset.previous || '';
        toast(error.message);
      });
    });

    updateCounts();
  }

  HMS.ready(initRoomBoard);
})();
