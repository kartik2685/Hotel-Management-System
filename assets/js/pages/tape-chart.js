/* =====================================================================
 * Frontdesk HMS · pages/tape-chart.js
 * Draws the rooms × 14 nights tape chart from the JSON data the server
 * puts in the page (#tape-chart-data). Selecting a stay opens it in a <dialog>.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$, h, icon, money, formatDay, clockTime, plural, api, DAY_MS, WEEKDAYS, MONTHS } = HMS.util;

  const DAYS_SHOWN = 14;
  const EARLIEST = -7; // how far back the chart can page (days)
  const LATEST = 14; // how far forward
  const STATUS_LABEL = { in: 'In house', arr: 'Arriving today', conf: 'Confirmed', tent: 'Tentative', out: 'Departed' };
  const STATUS_PILL = { in: 'checked-in', arr: 'confirmed', conf: 'confirmed', tent: 'tentative', out: 'checked-out' };

  function initTapeChart(data) {
    const grid = $('[data-tape-grid]');
    if (!grid || !data) return;

    const today = Date.parse(data.businessDate + 'T00:00:00Z');
    const dayDate = (offset) => new Date(today + offset * DAY_MS);
    const rooms = data.rooms.map(([no, type, floor]) => ({ no, type, floor: Number.isFinite(Number(floor)) ? Number(floor) : Math.floor(no / 100) }));
    const bookings = data.bookings.map(([id, room, start, end, first, last, status, adults, children, rate, source, notes]) =>
      ({ id, room, start, end, first, last, status, adults, children, rate, source, notes }));
    const blocks = data.blocks.map(([room, start, end, reason]) => ({ room, start, end, reason }));
    const byId = new Map(bookings.map((b) => [b.id, b]));

    const floorFilter = $('[data-tape-filter="floor"]');
    const typeFilter = $('[data-tape-filter="type"]');
    const rangeLabel = $('[data-tape-label]');
    const prevButton = $('[data-tape-nav="prev"]');
    const nextButton = $('[data-tape-nav="next"]');
    const todayButton = $('[data-tape-nav="today"]');
    let offset = 0; // first visible day, relative to the business date

    /* Where a stay sits in the visible window, in percent of the track.
       Bars start and end at mid-day so turnovers share a cell. */
    function placement(start, end) {
      const from = start - offset + 0.5;
      const to = end - offset + 0.5;
      const left = Math.max(from, 0);
      const right = Math.min(to, DAYS_SHOWN);
      if (right - left < 0.2) return null;
      return {
        left: (left / DAYS_SHOWN) * 100,
        width: ((right - left) / DAYS_SHOWN) * 100,
        days: right - left,
        cutStart: from < 0,
        cutEnd: to > DAYS_SHOWN,
      };
    }
    const barStyle = (p) => 'left:calc(' + p.left.toFixed(3) + '% + 2px);width:calc(' + p.width.toFixed(3) + '% - 4px)';
    const inWindow = (item) => item.start < offset + DAYS_SHOWN && item.end >= offset;

    function stayBar(booking, room) {
      const p = placement(booking.start, booking.end);
      if (!p) return null;
      const name = booking.first + ' ' + booking.last;
      const label = p.days < 0.8 ? '' : p.days < 1.6 ? booking.last : booking.first.charAt(0) + '. ' + booking.last;
      const classes = ['stay-bar', 'stay-bar--' + booking.status];
      if (p.cutStart) classes.push('stay-bar--cut-start');
      if (p.cutEnd) classes.push('stay-bar--cut-end');
      if (p.days < 0.8) classes.push('stay-bar--tiny');
      return h('button', {
        type: 'button',
        class: classes.join(' '),
        style: barStyle(p),
        'data-id': booking.id,
        title: name,
        'aria-label': name + ', room ' + room.no + ', ' + formatDay(dayDate(booking.start)) + ' to ' +
          formatDay(dayDate(booking.end)) + ', ' + STATUS_LABEL[booking.status],
      }, [h('span', { text: label })]);
    }

    function blockBar(block, room) {
      const p = placement(block.start, block.end);
      if (!p) return null;
      const classes = ['stay-bar', 'stay-bar--ooo'];
      if (p.cutStart) classes.push('stay-bar--cut-start');
      if (p.cutEnd) classes.push('stay-bar--cut-end');
      return h('span', {
        class: classes.join(' '),
        role: 'img',
        style: barStyle(p),
        'aria-label': 'Room ' + room.no + ' out of order until ' + formatDay(dayDate(block.end)) + ': ' + block.reason,
        title: block.reason,
      }, [h('span', {}, [icon('wrench')]), h('span', { text: 'Out of order' })]);
    }

    function render() {
      const floor = floorFilter ? floorFilter.value : '';
      const type = typeFilter ? typeFilter.value : '';
      const visible = rooms.filter((r) => (!floor || String(r.floor) === floor) && (!type || r.type === type));
      const shownRooms = new Set(visible.map((r) => r.no));
      const parts = document.createDocumentFragment();

      // Header row, "sold" row and the shaded day columns behind them
      const columns = h('div', { class: 'tape__grid', 'aria-hidden': 'true' });
      const dayCells = h('div', { class: 'tape__cells' });
      const soldCells = h('div', { class: 'tape__cells' });
      for (let i = 0; i < DAYS_SHOWN; i++) {
        const day = offset + i;
        const date = dayDate(day);
        const weekday = date.getUTCDay();
        const weekend = weekday === 5 || weekday === 6; // Friday and Saturday nights
        columns.append(h('span', { class: (weekend ? 'is-weekend' : '') + (day === 0 ? ' is-today' : '') }));

        const cell = h('div', { class: 'tape__day' + (day === 0 ? ' is-today' : '') }, [
          h('small', { text: WEEKDAYS[weekday] }),
          h('strong', { text: String(date.getUTCDate()) }),
        ]);
        if (date.getUTCDate() === 1 || i === 0) cell.append(h('span', { class: 'tape__month', text: MONTHS[date.getUTCMonth()] }));
        dayCells.append(cell);

        const sold = bookings.filter((b) => shownRooms.has(b.room) && b.start <= day && b.end > day).length;
        const percent = visible.length ? Math.round((sold / visible.length) * 100) : 0;
        soldCells.append(h('div', { class: 'tape__occ-cell', title: sold + ' of ' + visible.length + ' rooms sold' }, [
          h('span', { text: percent + '%' }),
          h('span', { class: 'progress', 'aria-hidden': 'true' }, [h('span', { class: 'progress__fill', style: 'width:' + percent + '%' })]),
        ]));
      }
      parts.append(
        columns,
        h('div', { class: 'tape__head' }, [h('div', { class: 'tape__stub', text: 'Room' }), dayCells]),
        h('div', { class: 'tape__occupancy' }, [h('div', { class: 'tape__stub', text: 'Sold' }), soldCells])
      );

      // One row per room, grouped by floor
      let currentFloor = null;
      visible.forEach((room) => {
        if (room.floor !== currentFloor) {
          currentFloor = room.floor;
          const count = visible.filter((r) => r.floor === room.floor).length;
          parts.append(h('div', { class: 'tape__floor' }, [
            h('div', { class: 'tape__stub', text: 'Floor ' + room.floor + ' · ' + plural(count, 'room', 'rooms') }),
            h('div'),
          ]));
        }
        const track = h('div', { class: 'tape__track' });
        const bars = [
          ...bookings.filter((b) => b.room === room.no && inWindow(b)).map((b) => stayBar(b, room)),
          ...blocks.filter((k) => k.room === room.no && inWindow(k)).map((k) => blockBar(k, room)),
        ];
        bars.forEach((bar) => { if (bar) track.append(bar); });
        parts.append(h('div', { class: 'tape__row' }, [
          h('div', { class: 'tape__stub' }, [h('strong', { text: String(room.no) }), h('small', { text: data.types[room.type] })]),
          track,
        ]));
      });
      if (!visible.length) parts.append(h('p', { class: 'tape__empty', text: 'No rooms match these filters.' }));
      grid.replaceChildren(parts);

      if (rangeLabel) rangeLabel.textContent = formatDay(dayDate(offset)) + ' – ' + formatDay(dayDate(offset + DAYS_SHOWN - 1));
      if (prevButton) prevButton.disabled = offset <= EARLIEST;
      if (nextButton) nextButton.disabled = offset >= LATEST;
    }

    function move(days) {
      offset = Math.max(EARLIEST, Math.min(LATEST, offset + days));
      render();
    }
    if (prevButton) prevButton.addEventListener('click', () => { move(-7); if (prevButton.disabled) nextButton.focus(); });
    if (nextButton) nextButton.addEventListener('click', () => { move(7); if (nextButton.disabled) prevButton.focus(); });
    if (todayButton) todayButton.addEventListener('click', () => { offset = 0; render(); });
    if (floorFilter) floorFilter.addEventListener('change', render);
    if (typeFilter) typeFilter.addEventListener('change', render);

    initBookingDialog({ grid, data, rooms, byId, render, dayDate });
    render();
  }

  /* -------------------------------------------------------------------
   * Booking details dialog
   * ------------------------------------------------------------------- */
  function initBookingDialog({ grid, data, rooms, byId, render, dayDate }) {
    const dialog = document.getElementById('booking-dialog');
    if (!dialog) return;
    const field = (name) => $('[data-detail="' + name + '"]', dialog);
    const set = (name, value) => { const el = field(name); if (el) el.textContent = value; };
    const actionButton = $('[data-detail-action]', dialog);
    let opener = null;
    let current = null;

    function fill(b) {
      const room = rooms.find((r) => r.no === b.room);
      set('avatar', (b.first.charAt(0) + b.last.charAt(0)).toUpperCase());
      set('conf', b.id);
      set('name', b.first + ' ' + b.last);
      field('status').replaceChildren(h('span', { class: 'status-pill status-pill--' + STATUS_PILL[b.status], text: STATUS_LABEL[b.status] }));
      set('room', b.room + ' · ' + data.types[room.type]);
      set('guests', plural(b.adults, 'adult', 'adults') + (b.children ? ', ' + plural(b.children, 'child', 'children') : ''));
      set('in', formatDay(dayDate(b.start)) + ' · from ' + (data.checkInTime || '15:00'));
      set('out', formatDay(dayDate(b.end)) + ' · by ' + (data.checkOutTime || '12:00'));
      const link = $('[data-detail-link]', dialog);
      if (link) link.href = '/reservations/' + encodeURIComponent(b.id);
      set('rate', money(b.rate));
      set('total', money(b.rate * (b.end - b.start)));
      set('source', b.source);
      set('nights', String(b.end - b.start));
      set('notes', b.notes || '');
      set('done', '');
      actionButton.hidden = !(b.status === 'arr' || b.status === 'tent');
      actionButton.textContent = b.status === 'arr' ? 'Check in' : 'Confirm booking';
    }

    const close = () => {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };

    grid.addEventListener('click', (event) => {
      const bar = event.target.closest('button.stay-bar');
      if (!bar) return;
      current = byId.get(bar.dataset.id);
      if (!current) return;
      opener = bar;
      fill(current);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });

    $$('[data-dialog-close]', dialog).forEach((button) => button.addEventListener('click', close));
    // A click on the dimmed backdrop lands on the <dialog> element itself.
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener('close', () => {
      if (opener && document.body.contains(opener)) opener.focus();
      else if (current) {
        const bar = grid.querySelector('[data-id="' + current.id + '"]');
        if (bar) bar.focus();
      }
    });

    actionButton.addEventListener('click', async () => {
      if (!current) return;
      const arriving = current.status === 'arr';
      actionButton.disabled = true;
      let reply;
      try {
        reply = await api('/api/reservations/' + encodeURIComponent(current.id) + (arriving ? '/check-in' : '/confirm'));
      } catch (error) {
        actionButton.disabled = false;
        set('done', error.message);
        return;
      }
      actionButton.disabled = false;
      const message = arriving ? 'Checked in at ' + (reply.time || clockTime()) + '.' : 'Booking confirmed.';
      current.status = arriving ? 'in' : 'conf';
      render();
      fill(current);
      set('done', message);
      opener = null; // the old bar was redrawn
      $('[data-dialog-close]', dialog).focus();
    });
  }

  // The server embeds the chart data as JSON (see views/pages/tape-chart.ejs).
  function readData() {
    const island = document.getElementById('tape-chart-data');
    return island ? JSON.parse(island.textContent) : window.TAPE_CHART_DATA;
  }

  HMS.ready(() => {
    const data = readData();
    if (data) initTapeChart(data);
  });
})();
