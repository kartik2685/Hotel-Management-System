'use strict';
/* Reservations: the bookings list, new bookings, availability and status changes. */
const f = require('../lib/format');
const clock = require('../lib/clock');
const pricing = require('../lib/pricing');
const activity = require('../lib/activity');
const settingsService = require('./settings');

const STATUS = {
  tentative: { css: 'tentative', label: 'Tentative' },
  confirmed: { css: 'confirmed', label: 'Confirmed' },
  checked_in: { css: 'checked-in', label: 'Checked in' },
  checked_out: { css: 'checked-out', label: 'Checked out' },
  cancelled: { css: 'cancelled', label: 'Cancelled' },
  no_show: { css: 'cancelled', label: 'No-show' },
};
const HOLDS_ROOM = "('tentative', 'confirmed', 'checked_in')";
const TAGS = { early: 'Early arrival', late: 'Late arrival', anniversary: 'Anniversary', 'first-stay': 'First stay' };

class BookingError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 422;
    this.field = field;
  }
}

/* "Today's arrivals, guests in house and the next ten days of bookings." */
const LIST_WHERE = `(r.status = 'checked_in' OR (r.arrival >= ? AND r.arrival <= ?) OR (r.status = 'checked_out' AND r.departure = ?))`;
const listArgs = (bd) => [bd, f.addDays(bd, 10), bd];

const listCount = (db, bd) => db.get(`SELECT COUNT(*) AS n FROM reservations r WHERE ${LIST_WHERE}`, ...listArgs(bd)).n;

const SELECT = `SELECT r.*, g.first_name, g.last_name, g.email, g.phone, g.vip, g.corporate, rt.name AS type_name, rt.code AS type_code,
    rm.number AS room_number, rp.name AS plan_name, rp.code AS plan_code, src.name AS source_name
  FROM reservations r
  JOIN guests g ON g.id = r.guest_id
  JOIN room_types rt ON rt.id = r.room_type_id
  LEFT JOIN rooms rm ON rm.id = r.room_id
  LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id
  LEFT JOIN sources src ON src.id = r.source_id`;

/* Display fields for one bookings-table row. */
function row(r) {
  const nights = f.daysBetween(r.arrival, r.departure);
  return {
    ...r,
    nights,
    name: `${r.first_name} ${r.last_name}`,
    sortName: `${r.last_name} ${r.first_name}`,
    initials: f.initials(`${r.first_name} ${r.last_name}`),
    statusCss: STATUS[r.status].css,
    statusLabel: STATUS[r.status].label,
    from: f.formatDay(r.arrival),
    to: f.formatDay(r.departure),
    stayNote: `${f.plural(nights, 'night', 'nights')} · ${f.guestCount(r.adults, r.children, ', ')}`,
    totalText: f.money(r.total_cents),
    totalData: String(r.total_cents / 100),
  };
}

function list(db, bd) {
  return db.all(`${SELECT} WHERE ${LIST_WHERE.replace(/r\./g, 'r.')} ORDER BY r.arrival, rm.number IS NULL, CAST(rm.number AS INTEGER), r.confirmation`, ...listArgs(bd)).map(row);
}

function byConfirmation(db, confirmation) {
  const r = db.get(`${SELECT} WHERE r.confirmation = ?`, confirmation);
  return r ? row(r) : null;
}

/* Stays (completed or in house) for a guest, plus history imported from before the system. */
function guestStays(db, guestId, excludeId = 0) {
  const g = db.get('SELECT prior_stays FROM guests WHERE id = ?', guestId);
  const n = db.get("SELECT COUNT(*) AS n FROM reservations WHERE guest_id = ? AND id <> ? AND status IN ('checked_in', 'checked_out')", guestId, excludeId).n;
  return (g ? g.prior_stays : 0) + n;
}

/* Rooms of a type that are free for every night of [arrival, departure). */
function freeRooms(db, typeId, arrival, departure, ignoreReservationId = 0) {
  return db.all(
    `SELECT rm.id, rm.number FROM rooms rm
      WHERE rm.active = 1 AND rm.room_type_id = ?
        AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.room_id = rm.id AND r.id <> ? AND r.status IN ${HOLDS_ROOM} AND r.arrival < ? AND r.departure > ?)
        AND NOT EXISTS (SELECT 1 FROM room_blocks b WHERE b.room_id = rm.id AND b.start_date < ? AND b.end_date > ?)
      ORDER BY CAST(rm.number AS INTEGER), rm.number`,
    typeId, ignoreReservationId, departure, arrival, departure, arrival,
  );
}

/* True when every night has at least one room of the type left (unassigned bookings count too). */
function typeAvailable(db, typeId, arrival, departure, ignoreReservationId = 0) {
  for (let d = arrival; d < departure; d = f.addDays(d, 1)) {
    const rooms = db.get(
      `SELECT COUNT(*) AS n FROM rooms rm WHERE rm.active = 1 AND rm.room_type_id = ?
         AND NOT EXISTS (SELECT 1 FROM room_blocks b WHERE b.room_id = rm.id AND b.start_date <= ? AND b.end_date > ?)`, typeId, d, d,
    ).n;
    const taken = db.get(
      `SELECT COUNT(*) AS n FROM reservations WHERE room_type_id = ? AND id <> ? AND status IN ${HOLDS_ROOM} AND arrival <= ? AND departure > ?`,
      typeId, ignoreReservationId, d, d,
    ).n;
    if (taken >= rooms) return false;
  }
  return true;
}

function nextConfirmation(db, settings) {
  const prefix = settings.confirmation_prefix || 'HLW';
  const row = db.get(
    "SELECT MAX(CAST(SUBSTR(confirmation, LENGTH(?) + 2) AS INTEGER)) AS n FROM reservations WHERE confirmation LIKE ? || '-%'", prefix, prefix,
  );
  return `${prefix}-${Math.max(Number(row.n) || 0, 40000) + 1}`;
}

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));

/* Validates the new-booking form and returns the normalised values. */
function readBooking(db, input, bd) {
  const v = {
    arrival: clean(input.arrival, 10), departure: clean(input.departure, 10), type: clean(input.type, 10),
    adults: Number.parseInt(input.adults, 10), children: Number.parseInt(input.children || '0', 10), plan: clean(input.plan, 10),
    first: clean(input.first, 60), last: clean(input.last, 60), email: clean(input.email, 120).toLowerCase(), phone: clean(input.phone, 40),
    source: clean(input.source, 40), requests: String(input.requests ?? '').trim().slice(0, 500),
    extras: [].concat(input.extra || input.extras || []).map((x) => clean(x, 20)),
  };
  if (!isDate(v.arrival)) throw new BookingError('Choose an arrival date.', 'arrival');
  if (v.arrival < bd) throw new BookingError('Arrival can’t be before the business date.', 'arrival');
  if (!isDate(v.departure)) throw new BookingError('Choose a departure date.', 'departure');
  const nights = f.daysBetween(v.arrival, v.departure);
  if (nights < 1) throw new BookingError('Departure must be after arrival.', 'departure');
  if (nights > 30) throw new BookingError('Stays over 30 nights go through the long-stay desk.', 'departure');
  const type = db.get('SELECT * FROM room_types WHERE code = ? AND active = 1', v.type);
  if (!type) throw new BookingError('Choose a room type.', 'type');
  if (!Number.isInteger(v.adults) || v.adults < 1 || v.adults > 12) throw new BookingError('Enter at least one adult.', 'adults');
  if (!Number.isInteger(v.children) || v.children < 0 || v.children > 12) throw new BookingError('Check the number of children.', 'children');
  if (v.adults + v.children > type.max_guests) throw new BookingError(`A ${type.name} sleeps up to ${type.max_guests} guests.`, 'type');
  const plan = db.get('SELECT * FROM rate_plans WHERE code = ? AND active = 1 AND bookable = 1', v.plan || 'BAR')
    || db.get('SELECT * FROM rate_plans WHERE active = 1 AND bookable = 1 ORDER BY sort LIMIT 1');
  if (!plan) throw new BookingError('Choose a rate plan.', 'plan');
  if (!v.first) throw new BookingError('Enter the guest’s first name.', 'first');
  if (!v.last) throw new BookingError('Enter the guest’s last name.', 'last');
  if (!v.email) throw new BookingError('Enter an email for the confirmation.', 'email');
  if (!isEmail(v.email)) throw new BookingError('That email doesn’t look right.', 'email');
  const source = db.get('SELECT * FROM sources WHERE name = ? AND active = 1', v.source)
    || db.get('SELECT * FROM sources WHERE active = 1 AND form_sort IS NOT NULL ORDER BY form_sort LIMIT 1');
  const extras = v.extras.length
    ? db.all(`SELECT * FROM extras WHERE active = 1 AND code IN (${v.extras.map(() => '?').join(',')})`, ...v.extras)
    : [];
  return { ...v, nights, type, plan, source, extras };
}

function create(db, req, input) {
  const bd = settingsService.businessDate(db);
  return insertBooking(db, req, readBooking(db, input, bd), { createdBy: req.user.id });
}

/*
 * Saves a validated booking (staff form or website): checks availability for every night,
 * assigns a free room, finds or creates the guest by email, prices the stay and logs it.
 */
function insertBooking(db, req, v, { createdBy = null, actor, online = false } = {}) {
  const settings = settingsService.all(db);
  return db.tx(() => {
    if (!typeAvailable(db, v.type.id, v.arrival, v.departure)) {
      throw new BookingError(`No ${v.type.name} is free for those dates. Try other dates or another room type.`, 'type');
    }
    const room = freeRooms(db, v.type.id, v.arrival, v.departure)[0] || null;
    let guest = db.get('SELECT * FROM guests WHERE email = ? COLLATE NOCASE ORDER BY id LIMIT 1', v.email);
    const stamp = clock.stamp(settings.timezone);
    if (!guest) {
      const r = db.run('INSERT INTO guests (first_name, last_name, email, phone, nationality, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        v.first, v.last, v.email, v.phone || null, v.nationality || null, stamp);
      guest = db.get('SELECT * FROM guests WHERE id = ?', r.lastInsertRowid);
    } else {
      if (v.phone && !guest.phone) db.run('UPDATE guests SET phone = ?, updated_at = ? WHERE id = ?', v.phone, stamp, guest.id);
      if (v.nationality && !guest.nationality) db.run('UPDATE guests SET nationality = ?, updated_at = ? WHERE id = ?', v.nationality, stamp, guest.id);
    }
    const tags = guestStays(db, guest.id) === 0 ? ['first-stay'] : [];
    const q = pricing.quote({ settings, baseCents: v.type.base_rate_cents, plan: v.plan, nights: v.nights, extras: v.extras });
    const confirmation = nextConfirmation(db, settings);
    const result = db.run(
      `INSERT INTO reservations (confirmation, guest_id, room_type_id, room_id, arrival, departure, adults, children, rate_plan_id, nightly_rate_cents,
         source_id, status, tags, requests, room_total_cents, tax_cents, extras_cents, total_cents, created_by, created_at, booked_online)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      confirmation, guest.id, v.type.id, room ? room.id : null, v.arrival, v.departure, v.adults, v.children, v.plan.id, q.rate,
      v.source ? v.source.id : null, JSON.stringify(tags), v.requests, q.roomTotal, q.tax, q.extras, q.total, createdBy, stamp, online ? 1 : 0,
    );
    for (const x of v.extras) {
      db.run('INSERT INTO reservation_extras (reservation_id, extra_id, amount_cents) VALUES (?, ?, ?)',
        result.lastInsertRowid, x.id, x.per === 'night' ? x.price_cents * v.nights : x.price_cents);
    }
    const summary = `${v.first} ${v.last} · ${v.type.name} · ${f.formatDay(v.arrival)} → ${f.formatDay(v.departure)}`;
    activity.log(db, req, 'reservation.create', `Booked ${confirmation}${online ? ' online' : ''}: ${summary}`, actor);
    db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)',
      'calendar-check', online ? 'gold' : '', `New ${online ? 'website ' : ''}booking ${confirmation}`, summary, stamp);
    return byConfirmation(db, confirmation);
  });
}

function requireBooking(db, confirmation) {
  const r = byConfirmation(db, confirmation);
  if (!r) {
    const error = new Error('That booking no longer exists.');
    error.status = 404;
    throw error;
  }
  return r;
}

function checkIn(db, req, confirmation) {
  const settings = settingsService.all(db);
  const bd = settingsService.businessDate(db);
  return db.tx(() => {
    const r = requireBooking(db, confirmation);
    if (r.status !== 'confirmed' && r.status !== 'tentative') throw new BookingError(`${r.name} is already ${STATUS[r.status].label.toLowerCase()}.`);
    if (r.arrival > bd) throw new BookingError(`${r.name} arrives on ${f.formatDay(r.arrival)}.`);
    if (r.departure <= bd) throw new BookingError('This stay has already ended.');
    if (!r.room_id) throw new BookingError('Assign a room before checking in.');
    const room = db.get('SELECT hk_status FROM rooms WHERE id = ?', r.room_id);
    if (room.hk_status !== 'clean') throw new BookingError(`Room ${r.room_number} is still being cleaned.`);
    const busy = db.get("SELECT confirmation FROM reservations WHERE room_id = ? AND status = 'checked_in' AND id <> ?", r.room_id, r.id);
    if (busy) throw new BookingError(`Room ${r.room_number} is still occupied (${busy.confirmation}).`);
    const blocked = db.get('SELECT 1 FROM room_blocks WHERE room_id = ? AND start_date <= ? AND end_date > ?', r.room_id, bd, bd);
    if (blocked) throw new BookingError(`Room ${r.room_number} is out of order.`);
    if (settings.require_grc && !r.grc_at) throw new BookingError(`Fill in ${r.first_name}’s registration card (GRC) on the booking page before checking in.`);
    const stamp = clock.stamp(settings.timezone);
    db.run("UPDATE reservations SET status = 'checked_in', checked_in_at = ?, updated_at = ? WHERE id = ?", stamp, stamp, r.id);
    activity.log(db, req, 'reservation.check-in', `Checked in ${r.name} (${r.confirmation}) to room ${r.room_number}`);
    const nationality = db.get('SELECT nationality FROM guests WHERE id = ?', r.guest_id).nationality;
    if (settings.country === 'IN' && nationality && !['IN', 'NP', 'BT'].includes(nationality)) {
      db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)', 'info', 'warn',
        `Form III due for ${r.name}`, `Room ${r.room_number} · file with the FRRO within 24 hours of check-in (${stamp.slice(11)})`, stamp);
    }
    return byConfirmation(db, confirmation);
  });
}

function checkOut(db, req, confirmation, { settle = false, method = 'Card' } = {}) {
  const settings = settingsService.all(db);
  const bd = settingsService.businessDate(db);
  return db.tx(() => {
    const r = requireBooking(db, confirmation);
    if (r.status !== 'checked_in') throw new BookingError(`${r.name} is not checked in.`);
    const owing = r.total_cents - r.paid_cents;
    if (owing > 0 && !settle) throw new BookingError(`${f.money(owing)} is still open on the folio. Take the payment first.`);
    const stamp = clock.stamp(settings.timezone);
    // Leaving early: the stay now ends today (at least one night is kept).
    const departure = r.departure > bd ? (bd > r.arrival ? bd : f.addDays(r.arrival, 1)) : r.departure;
    if (owing > 0 && settle) {
      db.run('INSERT INTO payments (reservation_id, amount_cents, method, reference, taken_by, taken_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        r.id, owing, ['Card', 'Cash', 'UPI', 'Bank transfer'].includes(method) ? method : 'Card', 'Settled at check-out', req.user ? req.user.id : null, req.user ? req.user.name : 'System', stamp);
    }
    db.run(
      "UPDATE reservations SET status = 'checked_out', checked_out_at = ?, departure = ?, paid_cents = CASE WHEN ? THEN total_cents ELSE paid_cents END, updated_at = ? WHERE id = ?",
      stamp, departure, settle ? 1 : 0, stamp, r.id,
    );
    if (r.room_id) db.run("UPDATE rooms SET hk_status = 'dirty', hk_updated_at = ? WHERE id = ?", stamp, r.room_id);
    activity.log(db, req, 'reservation.check-out', `Checked out ${r.name} (${r.confirmation}) from room ${r.room_number || '—'}`);
    return byConfirmation(db, confirmation);
  });
}

function cancel(db, req, confirmation) {
  const settings = settingsService.all(db);
  return db.tx(() => {
    const r = requireBooking(db, confirmation);
    if (!['confirmed', 'tentative'].includes(r.status)) throw new BookingError(`A ${STATUS[r.status].label.toLowerCase()} booking can’t be cancelled.`);
    const stamp = clock.stamp(settings.timezone);
    db.run("UPDATE reservations SET status = 'cancelled', cancelled_at = ?, room_id = NULL, updated_at = ? WHERE id = ?", stamp, stamp, r.id);
    activity.log(db, req, 'reservation.cancel', `Cancelled ${r.confirmation} for ${r.name}`);
    return byConfirmation(db, confirmation);
  });
}

module.exports = {
  STATUS, TAGS, BookingError, list, listCount, byConfirmation, row, guestStays, freeRooms, typeAvailable, create, checkIn, checkOut, cancel,
  readBooking, requireBooking, isDate, isEmail, clean, nextConfirmation, HOLDS_ROOM, insertBooking,
};

/* ---------------------------------------------------------------- page model */
const SUMMARY = [['confirmed', 'Confirmed'], ['tentative', 'Tentative'], ['checked-in', 'Checked in'], ['checked-out', 'Checked out'], ['cancelled', 'Cancelled']];

function taxText(settings) {
  if (settings.tax_mode === 'gst_india') {
    return { note: 'Prices update as you type. GST follows the nightly rate: none below ₹1,000, 5% up to ₹7,500 and 18% above.', line: 'GST' };
  }
  if (settings.tax_mode === 'none' || !Number(settings.tax_rate)) return { note: 'Prices update as you type.', line: 'Tax' };
  return { note: `Prices update as you type. ${settings.tax_label} is ${Number(settings.tax_rate)}% on the room charge.`, line: `${settings.tax_label} ${Number(settings.tax_rate)}%` };
}

function bookingForm(db, settings, bd) {
  const types = db.all('SELECT * FROM room_types WHERE active = 1 ORDER BY sort, name');
  const type = types.find((t) => t.code === settings.default_room_type) || types[0] || { code: '', name: '', base_rate_cents: 0, max_guests: 2 };
  const plans = db.all('SELECT * FROM rate_plans WHERE active = 1 AND bookable = 1 ORDER BY sort, name').map((p) => ({
    ...p, adjust: p.adjust_type === 'percent' ? `${p.adjust_value}%` : String(p.adjust_value / 100),
  }));
  const quote = pricing.quote({ settings, baseCents: type.base_rate_cents, plan: plans[0], nights: 2 });
  return {
    types, type, plans, quote,
    sources: db.all('SELECT * FROM sources WHERE active = 1 AND form_sort IS NOT NULL ORDER BY form_sort'),
    extras: db.all('SELECT * FROM extras WHERE active = 1 ORDER BY sort, name'),
    arrival: bd, departure: f.addDays(bd, 2), minDeparture: f.addDays(bd, 1),
    maxGuests: Math.max(1, ...types.map((t) => t.max_guests)),
    deposit: Math.round(quote.rate * (1 + pricing.taxPercent(settings, quote.rate) / 100)),
  };
}

function page(db, shell, canBook) {
  const { settings, bd } = shell;
  const rows = list(db, bd);
  const tax = taxText(settings);
  return {
    rows, canBook,
    summary: SUMMARY.map(([css, label]) => ({ css, label, count: rows.filter((x) => x.statusCss === css).length })),
    sources: db.all('SELECT * FROM sources WHERE active = 1 ORDER BY sort, name'),
    form: bookingForm(db, settings, bd),
    taxNote: tax.note, taxLine: tax.line,
  };
}

module.exports.page = page;
module.exports.taxText = taxText;

/* Booking fields the page scripts need after a change. */
const toJson = (b) => ({
  confirmation: b.confirmation, name: b.name, first: b.first_name, last: b.last_name, email: b.email, initials: b.initials,
  room: b.room_number, typeName: b.type_name, arrival: b.arrival, departure: b.departure, from: b.from, to: b.to, stayNote: b.stayNote,
  source: b.source_name, status: b.statusCss, statusLabel: b.statusLabel, total: b.total_cents / 100, totalText: b.totalText, sortName: b.sortName,
  time: f.clock(b.checked_in_at || ''),
});

function confirm(db, req, confirmation) {
  const settings = settingsService.all(db);
  return db.tx(() => {
    const r = requireBooking(db, confirmation);
    if (r.status !== 'tentative') throw new BookingError(`Only a tentative booking can be confirmed; this one is ${STATUS[r.status].label.toLowerCase()}.`);
    db.run("UPDATE reservations SET status = 'confirmed', updated_at = ? WHERE id = ?", clock.stamp(settings.timezone), r.id);
    activity.log(db, req, 'reservation.confirm', `Confirmed ${r.confirmation} for ${r.name}`);
    return byConfirmation(db, confirmation);
  });
}

module.exports.toJson = toJson;
module.exports.confirm = confirm;

/* ---------------------------------------------------------------- booking page */
const { Form } = require('../lib/forms');

class FormError extends Error {
  constructor(errors, values) {
    super('Please fix the highlighted fields.');
    this.status = 422;
    this.errors = errors;
    this.values = values;
  }
}

function detail(db, confirmation, bd) {
  const b = byConfirmation(db, confirmation);
  if (!b) return null;
  const extras = db.all('SELECT x.name, x.per, re.amount_cents FROM reservation_extras re JOIN extras x ON x.id = re.extra_id WHERE re.reservation_id = ?', b.id);
  const rooms = freeRooms(db, b.room_type_id, b.arrival, b.departure, b.id);
  if (b.room_id && !rooms.some((r) => r.id === b.room_id)) rooms.unshift({ id: b.room_id, number: b.room_number });
  const owing = b.total_cents - b.paid_cents;
  const room = b.room_id ? db.get('SELECT hk_status FROM rooms WHERE id = ?', b.room_id) : null;
  const open = ['tentative', 'confirmed', 'checked_in'].includes(b.status);
  return {
    b, extras, rooms, owing, open,
    tags: JSON.parse(b.tags || '[]'),
    guestStays: guestStays(db, b.guest_id, b.id),
    types: db.all('SELECT id, name, max_guests FROM room_types WHERE active = 1 OR id = ? ORDER BY sort, name', b.room_type_id),
    plans: db.all('SELECT id, name FROM rate_plans WHERE active = 1 OR id = ? ORDER BY sort, name', b.rate_plan_id || 0),
    sources: db.all('SELECT id, name FROM sources WHERE active = 1 OR id = ? ORDER BY sort, name', b.source_id || 0),
    can: {
      confirm: b.status === 'tentative',
      checkIn: ['confirmed', 'tentative'].includes(b.status) && b.arrival <= bd && b.departure > bd,
      checkInBlocked: !b.room_id ? 'Assign a room first.' : room && room.hk_status !== 'clean' ? `Room ${b.room_number} is still being cleaned.` : '',
      checkOut: b.status === 'checked_in',
      cancel: ['confirmed', 'tentative'].includes(b.status),
    },
    log: db.all('SELECT * FROM activity_log WHERE summary LIKE ? ORDER BY id DESC LIMIT 20', `%${b.confirmation}%`),
  };
}

function update(db, req, confirmation, body) {
  const settings = settingsService.all(db);
  const bd = settingsService.businessDate(db);
  const r = requireBooking(db, confirmation);
  const form = new Form(body);
  const stamp = clock.stamp(settings.timezone);
  if (!['tentative', 'confirmed', 'checked_in'].includes(r.status)) {
    const notes = form.longText('notes', { label: 'Internal note', max: 500 });
    const requests = form.longText('requests', { label: 'Guest requests', max: 500 });
    if (!form.ok) throw new FormError(form.errors, form.values);
    db.run('UPDATE reservations SET notes = ?, requests = ?, updated_at = ? WHERE id = ?', notes, requests, stamp, r.id);
    activity.log(db, req, 'reservation.update', `Updated notes on ${r.confirmation}`);
    return byConfirmation(db, confirmation);
  }
  const v = {
    arrival: form.date('arrival', { label: 'Arrival' }),
    departure: form.date('departure', { label: 'Departure' }),
    typeId: form.int('room_type_id', { label: 'Room type', min: 1 }),
    room: form.text('room', { label: 'Room', max: 8 }),
    adults: form.int('adults', { label: 'Adults', min: 1, max: 12 }),
    children: form.int('children', { label: 'Children', min: 0, max: 12, required: false }) ?? 0,
    planId: form.int('rate_plan_id', { label: 'Rate plan', min: 1, required: false }),
    rate: form.money('nightly_rate', { label: 'Nightly rate', min: 0, max: 10000000 }),
    sourceId: form.int('source_id', { label: 'Source', min: 1, required: false }),
    eta: form.time('eta', { label: 'ETA', required: false }),
    notes: form.longText('notes', { label: 'Internal note', max: 500 }),
    requests: form.longText('requests', { label: 'Guest requests', max: 500 }),
    first: form.text('first', { label: 'First name', max: 60, required: true }),
    last: form.text('last', { label: 'Last name', max: 60, required: true }),
    email: form.email('email', { required: false }),
    phone: form.text('phone', { label: 'Phone', max: 40 }),
  };
  const tags = ['early', 'late', 'anniversary'].filter((t) => form.bool(`tag_${t}`));
  const type = v.typeId ? db.get('SELECT * FROM room_types WHERE id = ?', v.typeId) : null;
  if (v.typeId && !type) form.fail('room_type_id', 'Choose a room type.');
  if (v.arrival && v.departure) {
    const nights = f.daysBetween(v.arrival, v.departure);
    if (nights < 1) form.fail('departure', 'Departure must be after arrival.');
    else if (nights > 60) form.fail('departure', 'Stays over 60 nights need a long-stay contract.');
  }
  if (r.status === 'checked_in' && v.arrival && v.arrival !== r.arrival) form.fail('arrival', 'The guest is already in house, so the arrival date stays the same.');
  if (r.status !== 'checked_in' && v.arrival && v.arrival !== r.arrival && v.arrival < bd) form.fail('arrival', 'Arrival can’t be before the business date.');
  if (r.status === 'checked_in' && v.departure && v.departure <= bd && v.departure !== r.departure) form.fail('departure', 'To end the stay today, use Check out.');
  if (type && v.adults && v.adults + v.children > type.max_guests) form.fail('adults', `A ${type.name} sleeps up to ${type.max_guests} guests.`);
  let room = null;
  if (v.room) {
    room = db.get('SELECT * FROM rooms WHERE number = ? AND active = 1', v.room);
    if (!room) form.fail('room', 'That room does not exist.');
    else if (type && room.room_type_id !== type.id) form.fail('room', `Room ${room.number} is not a ${type.name}. Pick a room of that type or leave it unassigned.`);
  } else if (r.status === 'checked_in') {
    form.fail('room', 'An in-house guest needs a room.');
  }
  if (form.ok && type) {
    const changed = v.arrival !== r.arrival || v.departure !== r.departure || type.id !== r.room_type_id;
    if (changed && !typeAvailable(db, type.id, v.arrival, v.departure, r.id)) form.fail('room_type_id', `No ${type.name} is free for every night of those dates.`);
    if (room && (changed || room.id !== r.room_id) && !freeRooms(db, type.id, v.arrival, v.departure, r.id).some((x) => x.id === room.id)) {
      form.fail('room', `Room ${room.number} is taken or out of order on some of those nights.`);
    }
    if (room && r.status === 'checked_in' && room.id !== r.room_id && room.hk_status !== 'clean') form.fail('room', `Room ${room.number} is not clean yet.`);
  }
  if (!form.ok) throw new FormError(form.errors, form.values);

  return db.tx(() => {
    const nights = f.daysBetween(v.arrival, v.departure);
    const oldNights = f.daysBetween(r.arrival, r.departure);
    let extras = 0;
    for (const x of db.all('SELECT re.*, ex.per FROM reservation_extras re JOIN extras ex ON ex.id = re.extra_id WHERE re.reservation_id = ?', r.id)) {
      const amount = x.per === 'night' ? Math.round((x.amount_cents / oldNights) * nights) : x.amount_cents;
      db.run('UPDATE reservation_extras SET amount_cents = ? WHERE reservation_id = ? AND extra_id = ?', amount, r.id, x.extra_id);
      extras += amount;
    }
    const roomTotal = v.rate * nights;
    const tax = Math.round((roomTotal * pricing.taxPercent(settings, v.rate)) / 100);
    const keep = JSON.parse(r.tags || '[]').filter((t) => t === 'first-stay');
    db.run(
      `UPDATE reservations SET arrival = ?, departure = ?, room_type_id = ?, room_id = ?, adults = ?, children = ?, rate_plan_id = ?, nightly_rate_cents = ?,
         source_id = ?, eta = ?, tags = ?, notes = ?, requests = ?, room_total_cents = ?, tax_cents = ?, extras_cents = ?, total_cents = ?, updated_at = ?
       WHERE id = ?`,
      v.arrival, v.departure, type.id, room ? room.id : null, v.adults, v.children, v.planId, v.rate, v.sourceId, v.eta || null,
      JSON.stringify([...keep, ...tags]), v.notes, v.requests, roomTotal, tax, extras, roomTotal + tax + extras, stamp, r.id,
    );
    db.run('UPDATE guests SET first_name = ?, last_name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?', v.first, v.last, v.email || null, v.phone || null, stamp, r.guest_id);
    if (r.status === 'checked_in' && room && room.id !== r.room_id && r.room_id) db.run("UPDATE rooms SET hk_status = 'dirty', hk_updated_at = ? WHERE id = ?", stamp, r.room_id);
    activity.log(db, req, 'reservation.update', `Updated ${r.confirmation} for ${v.first} ${v.last}: ${f.formatDay(v.arrival)} → ${f.formatDay(v.departure)}, room ${room ? room.number : 'unassigned'}`);
    return byConfirmation(db, confirmation);
  });
}

function addPayment(db, req, confirmation, body) {
  const settings = settingsService.all(db);
  const r = requireBooking(db, confirmation);
  const form = new Form(body);
  const amount = form.money('amount', { label: 'Amount', min: 0.01, max: 10000000 });
  const method = form.oneOf('method', ['Cash', 'Card', 'UPI', 'Bank transfer'], { label: 'Payment method' });
  if (amount && amount > r.total_cents - r.paid_cents) form.fail('amount', `That is more than the ${f.money(r.total_cents - r.paid_cents)} still open.`);
  if (!form.ok) throw new FormError(form.errors, form.values);
  db.run('UPDATE reservations SET paid_cents = paid_cents + ?, updated_at = ? WHERE id = ?', amount, clock.stamp(settings.timezone), r.id);
  activity.log(db, req, 'reservation.payment', `Payment of ${f.money(amount)} (${method}) on ${r.confirmation} for ${r.name}`);
  return byConfirmation(db, confirmation);
}

module.exports.detail = detail;
module.exports.update = update;
module.exports.addPayment = addPayment;
module.exports.FormError = FormError;
