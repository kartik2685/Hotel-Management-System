/* =====================================================================
 * Frontdesk HMS · pages/reservations.js
 * Bookings table (search, filters, sorting, CSV export) and the
 * new-booking form (live price, validation, adds a row to the table).
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$, h, money, parseDate, formatDay, plural, isEmail, setFieldError, prefersReducedMotion, DAY_MS } = HMS.util;
  const BOOKING_ADDED = 'hms:booking-added';

  /* -------------------------------------------------------------------
   * Bookings table
   * ------------------------------------------------------------------- */
  function initBookingsTable() {
    const table = $('[data-reservation-table]');
    const filters = $('[data-reservation-filters]');
    if (!table || !filters) return;
    const body = table.tBodies[0];
    const count = $('[data-reservation-count]');
    const empty = $('[data-reservation-empty]');
    const field = filters.elements;
    let sortKey = 'arrival';
    let sortDir = 1;

    const rows = () => Array.from(body.rows);

    function applyFilters() {
      const query = field.q.value.trim().toLowerCase();
      const status = field.status.value;
      const source = field.source.value;
      const from = field.from.value;
      const to = field.to.value;
      const all = rows();
      let shown = 0;
      all.forEach((row) => {
        const d = row.dataset;
        const match =
          (!query || row.textContent.toLowerCase().includes(query)) &&
          (!status || d.status === status) &&
          (!source || d.source === source) &&
          (!from || d.arrival >= from) &&
          (!to || d.arrival <= to);
        row.hidden = !match;
        if (match) shown += 1;
      });
      if (count) count.textContent = 'Showing ' + shown + ' of ' + all.length + ' bookings';
      if (empty) empty.hidden = shown > 0;
    }

    function sortRows() {
      const value = (row) => (sortKey === 'total' ? Number(row.dataset.total) : row.dataset[sortKey]);
      rows()
        .sort((a, b) => {
          const x = value(a);
          const y = value(b);
          return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
        })
        .forEach((row) => body.append(row));
    }

    filters.addEventListener('input', applyFilters);
    filters.addEventListener('change', applyFilters);
    filters.addEventListener('submit', (event) => { event.preventDefault(); applyFilters(); });
    filters.addEventListener('reset', () => window.setTimeout(applyFilters, 0));

    const clear = $('[data-reservation-reset]');
    if (clear) clear.addEventListener('click', () => { filters.reset(); field.q.focus(); });

    $$('[data-sort]', table).forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.sort;
        sortDir = key === sortKey ? -sortDir : 1;
        sortKey = key;
        $$('th[aria-sort]', table).forEach((th) => th.setAttribute('aria-sort', 'none'));
        button.closest('th').setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');
        sortRows();
      });
    });

    // Arriving from the top-bar search (?q=…) pre-fills the table search.
    const term = new URLSearchParams(window.location.search).get('q');
    if (term) field.q.value = term;
    applyFilters();
    document.addEventListener(BOOKING_ADDED, applyFilters);

    const exportButton = $('[data-export-csv]');
    if (exportButton) exportButton.addEventListener('click', () => downloadCsv(rows().filter((row) => !row.hidden)));
  }

  /* CSV of the visible bookings. Cells that start with = + - @ are
     prefixed with ' so spreadsheet apps never run them as formulas. */
  function downloadCsv(rows) {
    const text = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : '');
    const safe = (value) => {
      const s = String(value);
      return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    };
    const lines = [['Guest', 'Email', 'Confirmation', 'Room', 'Room type', 'Stay', 'Nights and guests', 'Source', 'Status', 'Total']];
    rows.forEach((row) => {
      const c = row.cells;
      lines.push([
        text($('strong', c[0])),
        row.dataset.email || '',
        text($('small', c[0])),
        text($('strong', c[1])) || 'Unassigned',
        text($('small', c[1])),
        text($('.stay-dates', c[2])).replace(/\s*→\s*(to\s*)?/, ' to '),
        text($('small', c[2])),
        text(c[3]),
        text(c[4]),
        text(c[5]),
      ]);
    });
    const csv = lines
      .map((line) => line.map((v) => '"' + safe(v).replace(/"/g, '""') + '"').join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = h('a', { href: url, download: 'harlow-reservations.csv' });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* -------------------------------------------------------------------
   * New booking form
   * ------------------------------------------------------------------- */
  function initBookingForm() {
    const form = $('[data-booking-form]');
    if (!form) return;
    const TAX_RATE = 0.1749; // room tax, applied to the room charge only
    const f = form.elements;
    const success = $('[data-booking-success]');
    const output = (name) => $('[data-quote="' + name + '"]', form);
    let addedRow = null;

    const nightsBetween = (arrival, departure) =>
      arrival && departure ? Math.round((Date.parse(departure) - Date.parse(arrival)) / DAY_MS) : 0;
    const roomTypeName = () => f.type.selectedOptions[0].textContent.split('·')[0].trim();
    const stayLabel = () => formatDay(parseDate(f.arrival.value)) + ' → ' + formatDay(parseDate(f.departure.value));

    /* Price for the current form values. Rate plan adjustments are either a
       fixed amount per night ("32") or a percentage ("-12%"). */
    function quote() {
      const nights = Math.max(0, nightsBetween(f.arrival.value, f.departure.value));
      const baseRate = Number(f.type.selectedOptions[0].dataset.rate);
      const plan = $('input[name="plan"]:checked', form);
      const adjust = plan.dataset.adjust;
      let rate = adjust.endsWith('%') ? baseRate * (1 + parseFloat(adjust) / 100) : baseRate + parseFloat(adjust);
      rate = Math.round(rate * 100) / 100;
      const roomTotal = rate * nights;
      const tax = Math.round(roomTotal * TAX_RATE * 100) / 100;
      const extras = $$('input[name="extra"]:checked', form).reduce(
        (sum, box) => sum + Number(box.dataset.price) * (box.dataset.per === 'night' ? nights : 1),
        0
      );
      return {
        nights,
        rate,
        roomTotal,
        tax,
        extras,
        total: roomTotal + tax + extras,
        typeName: roomTypeName(),
        planName: plan.parentElement.querySelector('strong').textContent,
        planCode: plan.value,
      };
    }

    function showQuote() {
      const q = quote();
      output('room').textContent = q.typeName + ' · ' + q.planName;
      output('dates').textContent =
        q.nights > 0 ? stayLabel() + ' · ' + plural(q.nights, 'night', 'nights') : 'Choose a departure after the arrival date';
      output('rate-label').textContent = plural(q.nights, 'night', 'nights') + ' × ' + money(q.rate);
      output('room-total').textContent = money(q.roomTotal);
      output('tax').textContent = money(q.tax);
      output('extras').textContent = money(q.extras);
      output('total').textContent = money(q.total);
      output('deposit').textContent =
        q.planCode === 'ADV'
          ? 'Advance purchase: ' + money(q.total) + ' is charged today.'
          : 'Deposit today: first night with tax, ' + money(q.nights ? q.rate * (1 + TAX_RATE) : 0) + '.';
    }

    /* Returns the fields that failed, in form order. */
    function validate() {
      const failed = [];
      const check = (input, message) => {
        setFieldError(input, message);
        if (message) failed.push(input);
      };
      const earliest = f.arrival.getAttribute('min');
      check(
        f.arrival,
        !f.arrival.value ? 'Choose an arrival date.'
          : earliest && f.arrival.value < earliest ? 'Arrival can’t be before the business date.' : ''
      );
      const nights = nightsBetween(f.arrival.value, f.departure.value);
      check(
        f.departure,
        !f.departure.value ? 'Choose a departure date.'
          : nights < 1 ? 'Departure must be after arrival.'
          : nights > 30 ? 'Stays over 30 nights go through the long-stay desk.' : ''
      );
      const sleeps = Number(f.type.selectedOptions[0].dataset.max);
      const guests = Number(f.adults.value || 0) + Number(f.children.value || 0);
      check(f.type, guests > sleeps ? 'A ' + roomTypeName() + ' sleeps up to ' + sleeps + ' guests.' : '');
      check(f.first, f.first.value.trim() ? '' : 'Enter the guest’s first name.');
      check(f.last, f.last.value.trim() ? '' : 'Enter the guest’s last name.');
      check(
        f.email,
        !f.email.value.trim() ? 'Enter an email for the confirmation.'
          : isEmail(f.email.value) ? '' : 'That email doesn’t look right.'
      );
      return failed;
    }

    /* Put the new booking at the top of the bookings table. */
    function addToTable(id, q) {
      const table = $('[data-reservation-table]');
      if (!table) return null;
      const first = f.first.value.trim();
      const last = f.last.value.trim();
      const adults = Number(f.adults.value);
      const children = Number(f.children.value);
      const guests = plural(adults, 'adult', 'adults') + (children ? ', ' + plural(children, 'child', 'children') : '');

      const row = h('tr', {
        class: 'is-new',
        'data-status': 'confirmed',
        'data-source': f.source.value,
        'data-arrival': f.arrival.value,
        'data-total': q.total.toFixed(2),
        'data-name': last + ' ' + first,
        'data-email': f.email.value.trim(),
      }, [
        h('td', { 'data-label': 'Guest' }, [
          h('span', { class: 'guest-cell' }, [
            h('span', { class: 'avatar avatar--sm', 'aria-hidden': 'true', text: (first[0] + last[0]).toUpperCase() }),
            h('span', { class: 'guest-cell__text' }, [
              h('strong', { text: first + ' ' + last }),
              h('small', { class: 'text-mono', text: id }),
            ]),
          ]),
        ]),
        h('td', { 'data-label': 'Room' }, [
          h('span', { class: 'text-muted', text: 'Unassigned' }),
          h('small', { class: 'cell-note', text: q.typeName }),
        ]),
        h('td', { 'data-label': 'Stay' }, [
          h('span', { class: 'stay-dates', text: stayLabel() }),
          h('small', { class: 'cell-note', text: plural(q.nights, 'night', 'nights') + ' · ' + guests }),
        ]),
        h('td', { 'data-label': 'Source', text: f.source.value }),
        h('td', { 'data-label': 'Status' }, [h('span', { class: 'status-pill status-pill--confirmed', text: 'Confirmed' })]),
        h('td', { 'data-label': 'Total', class: 'numeric', text: money(q.total) }),
      ]);
      table.tBodies[0].prepend(row);
      document.dispatchEvent(new CustomEvent(BOOKING_ADDED));
      return row;
    }

    // Departure must stay at least one night after arrival.
    f.arrival.addEventListener('change', () => {
      if (!f.arrival.value) return;
      const nextDay = new Date(Date.parse(f.arrival.value) + DAY_MS).toISOString().slice(0, 10);
      f.departure.min = nextDay;
      if (f.departure.value && f.departure.value <= f.arrival.value) f.departure.value = nextDay;
    });

    form.addEventListener('input', (event) => {
      if (event.target.classList && event.target.classList.contains('is-invalid')) setFieldError(event.target, '');
      if (event.target === f.adults || event.target === f.children) setFieldError(f.type, '');
      showQuote();
    });
    form.addEventListener('change', showQuote);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const failed = validate();
      if (failed.length) {
        failed[0].focus();
        return;
      }
      const q = quote();
      const id = 'HLW-' + (41900 + Math.floor(Math.random() * 99));
      addedRow = addToTable(id, q);
      $('[data-success-id]', success).textContent = id;
      $('[data-success-text]', success).textContent =
        f.first.value.trim() + ' ' + f.last.value.trim() + ' · ' + q.typeName + ' · ' + stayLabel() + ' · ' +
        money(q.total) + '. It lives on this page only; connect the form to your booking system to save it.';
      form.hidden = true;
      success.hidden = false;
      success.focus();
    });

    const again = $('[data-booking-again]');
    if (again) {
      again.addEventListener('click', () => {
        form.reset();
        $$('.is-invalid', form).forEach((input) => setFieldError(input, ''));
        success.hidden = true;
        form.hidden = false;
        showQuote();
        f.first.focus();
      });
    }

    const view = $('[data-success-view]');
    if (view) {
      view.addEventListener('click', (event) => {
        if (!addedRow) return;
        event.preventDefault();
        addedRow.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      });
    }

    showQuote();
  }

  HMS.ready(() => {
    initBookingsTable();
    initBookingForm();
  });
})();
