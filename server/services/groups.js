'use strict';
/* Group bookings: several rooms for a wedding or a conference, booked together under one name and contact. Each
   room is a booking of its own (its guest, room, check-in, charges); the group adds a page with all of them,
   check-in for everyone arriving, a payment shared out over the rooms, and one invoice for the lot
   (billing.createGroupInvoice). */
const f = require('../lib/format');
const clock = require('../lib/clock');
const activity = require('../lib/activity');
const { Form } = require('../lib/forms');
const settingsService = require('./settings');
const reservations = require('./reservations');
const billing = require('./billing');
const website = require('./website');

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const OPEN = ['tentative', 'confirmed', 'checked_in', 'checked_out'];

const members = (db, groupId) => db.all(`SELECT r.confirmation FROM reservations r WHERE r.group_id = ? ORDER BY r.arrival, r.id`, groupId)
  .map((m) => reservations.byConfirmation(db, m.confirmation));

/* Totals and dates of a group's bookings (cancelled and no-show ones aside). */
function summarise(rows) {
  const live = rows.filter((m) => OPEN.includes(m.status));
  const sum = (key) => live.reduce((n, m) => n + m[key], 0);
  return {
    rooms: live.length, guests: live.reduce((n, m) => n + m.adults + m.children, 0),
    arrival: live.reduce((d, m) => (!d || m.arrival < d ? m.arrival : d), ''), departure: live.reduce((d, m) => (m.departure > d ? m.departure : d), ''),
    total: sum('total_cents'), paid: sum('paid_cents'), owing: live.reduce((n, m) => n + Math.max(0, m.total_cents - m.paid_cents), 0),
    inHouse: live.filter((m) => m.status === 'checked_in').length, out: live.filter((m) => m.status === 'checked_out').length,
  };
}

function list(db) {
  return db.all('SELECT * FROM booking_groups ORDER BY id DESC').map((g) => ({ ...g, s: summarise(members(db, g.id)) }))
    .sort((a, b) => (b.s.departure >= settingsService.businessDate(db)) - (a.s.departure >= settingsService.businessDate(db)) || a.s.arrival.localeCompare(b.s.arrival));
}

function requireGroup(db, id) {
  const g = db.get('SELECT * FROM booking_groups WHERE id = ?', Number.parseInt(id, 10) || 0);
  if (!g) throw Object.assign(new Error('That group no longer exists.'), { status: 404 });
  return g;
}

function detail(db, id) {
  const g = requireGroup(db, id);
  const rows = members(db, g.id);
  const lead = rows[0];
  const invoices = lead ? billing.groupInvoices(db, g.id) : [];
  return { g, rows, s: summarise(rows), invoices, arriving: rows.filter((m) => ['confirmed', 'tentative'].includes(m.status) && m.arrival <= settingsService.businessDate(db)) };
}

/* "Rohan Mitra" → first and last; one word stays the first name. */
const nameOf = (line) => {
  const parts = line.trim().split(/\s+/);
  return { first: parts[0].slice(0, 60), last: (parts.slice(1).join(' ') || '').slice(0, 60) };
};

/* The new-group form's choices. */
function formData(db) {
  return {
    types: db.all('SELECT * FROM room_types WHERE active = 1 ORDER BY sort, name'),
    plans: db.all('SELECT * FROM rate_plans WHERE active = 1 AND bookable = 1 ORDER BY sort, name'),
    sources: db.all('SELECT * FROM sources WHERE active = 1 ORDER BY sort, name'),
  };
}

/* Books the rooms and the group in one go: all of them or none. Returns the group's id. */
function create(db, req, body) {
  const settings = settingsService.all(db);
  const bd = settingsService.businessDate(db);
  const { types } = formData(db);
  const form = new Form(body);
  const v = {
    name: form.text('name', { label: 'Group name', max: 80, required: true }),
    contact: form.text('contact_name', { label: 'Contact', max: 80, required: true }),
    email: form.email('contact_email', { required: false }),
    phone: form.text('contact_phone', { label: 'Phone', max: 40 }),
    company: form.text('company', { label: 'Bill to', max: 100 }),
    gstin: (form.text('gstin', { label: 'GSTIN', max: 15 }) || '').toUpperCase(),
    arrival: form.date('arrival', { label: 'Arrival' }),
    departure: form.date('departure', { label: 'Departure' }),
    adults: form.int('adults', { label: 'Adults per room', min: 1, max: 6 }),
    planId: form.int('rate_plan_id', { label: 'Rate plan', min: 1 }),
    sourceId: form.int('source_id', { label: 'Source', min: 1, required: false }),
    names: String(body.rooming_list || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 200),
    notes: form.longText('notes', { label: 'Notes', max: 500 }),
  };
  form.keep('rooming_list', String(body.rooming_list || ''));
  const counts = types.map((t) => ({ type: t, n: form.int(`rooms_${t.code}`, { label: t.name, min: 0, max: 50, required: false }) || 0 })).filter((x) => x.n > 0);
  if (v.gstin && !GSTIN.test(v.gstin)) form.fail('gstin', 'A GSTIN has 15 characters, e.g. 19ABCDE1234F1Z5.');
  if (v.arrival && v.arrival < bd) form.fail('arrival', 'Arrival can’t be before the business date.');
  const nights = v.arrival && v.departure ? f.daysBetween(v.arrival, v.departure) : 0;
  if (v.arrival && v.departure && nights < 1) form.fail('departure', 'Departure must be after arrival.');
  else if (nights > 30) form.fail('departure', 'Stays over 30 nights go through the long-stay desk.');
  if (!counts.length) form.fail('rooms', 'Choose how many rooms of which type.');
  for (const x of counts) {
    if (v.adults && v.adults > x.type.max_guests) form.fail(`rooms_${x.type.code}`, `A ${x.type.name} sleeps up to ${x.type.max_guests}.`);
    else if (form.ok && nights >= 1) {
      const left = website.roomsLeft(db, x.type.id, v.arrival, v.departure);
      if (left < x.n) form.fail(`rooms_${x.type.code}`, left ? `Only ${f.plural(left, 'room', 'rooms')} left for every night.` : 'None left for those nights.');
    }
  }
  const plan = v.planId ? db.get('SELECT * FROM rate_plans WHERE id = ? AND active = 1', v.planId) : null;
  if (v.planId && !plan) form.fail('rate_plan_id', 'Choose a rate plan.');
  if (!form.ok) throw new reservations.FormError(form.errors, form.values);

  const source = v.sourceId ? db.get('SELECT * FROM sources WHERE id = ?', v.sourceId) : null;
  return db.tx(() => {
    const last = db.get('SELECT code FROM booking_groups ORDER BY id DESC LIMIT 1');
    const code = `GRP-${last ? Number(last.code.replace(/\D/g, '')) + 1 : 101}`;
    const stamp = clock.stamp(settings.timezone);
    const { id } = db.get(`INSERT INTO booking_groups (code, name, contact_name, contact_email, contact_phone, company, gstin, notes, created_by, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    code, v.name, v.contact, v.email || null, v.phone || null, v.company || null, v.gstin || null, v.notes || null, req.user ? req.user.id : null, stamp);
    let n = 0;
    for (const x of counts) {
      for (let i = 0; i < x.n; i++) {
        // the rooming list names the guests in order; the other rooms wait for their names
        const who = v.names[n] ? nameOf(v.names[n]) : { first: `Guest ${n + 1}`, last: `· ${v.name}`.slice(0, 60) };
        n += 1;
        reservations.insertBooking(db, req, {
          arrival: v.arrival, departure: v.departure, nights, type: x.type, plan, source, adults: v.adults, children: 0,
          first: who.first, last: who.last, email: null, phone: null, requests: v.notes || '', extras: [], // each room its own guest
        }, { createdBy: req.user ? req.user.id : null, groupId: id, quiet: true });
      }
    }
    db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)', 'calendar-check', 'gold',
      `New group ${code}: ${v.name}`, `${f.plural(n, 'room', 'rooms')} · ${f.formatDay(v.arrival)} → ${f.formatDay(v.departure)}`, stamp);
    activity.log(db, req, 'group.create', `Booked group ${code} (${v.name}): ${f.plural(n, 'room', 'rooms')}, ${f.formatDay(v.arrival)} → ${f.formatDay(v.departure)}`);
    return id;
  });
}

/* Checks in everyone in the group who arrives by today; says who could not be and why. */
function checkInAll(db, req, id) {
  const { g, arriving } = detail(db, id);
  const done = [];
  const skipped = [];
  for (const m of arriving) {
    try {
      reservations.checkIn(db, req, m.confirmation);
      done.push(m);
    } catch (error) {
      if (error.status !== 422) throw error;
      skipped.push({ m, reason: error.message });
    }
  }
  if (done.length) activity.log(db, req, 'group.check-in', `Checked in ${f.plural(done.length, 'room', 'rooms')} of group ${g.code}`);
  return { done, skipped };
}

/* One payment for the group, shared out over the rooms that still owe, in arrival order. */
function pay(db, req, id, body) {
  const { g, rows } = detail(db, id);
  const form = new Form(body);
  const amount = form.money('amount', { label: 'Amount', min: 0.01, max: 10000000 });
  const method = form.oneOf('method', billing.METHODS, { label: 'Payment method' });
  const reference = form.text('reference', { label: 'Reference', max: 60 }) || `Group ${g.code}`;
  const owing = rows.filter((m) => OPEN.includes(m.status) && m.total_cents > m.paid_cents);
  const total = owing.reduce((n, m) => n + m.total_cents - m.paid_cents, 0);
  if (amount && amount > total) form.fail('amount', total ? `The group owes ${f.money(total)}.` : 'Nothing is owed.');
  if (!form.ok) throw new reservations.FormError(form.errors, form.values);
  db.tx(() => {
    let left = amount;
    for (const m of owing) {
      const share = Math.min(left, m.total_cents - m.paid_cents);
      if (share > 0) billing.record(db, req, m, share, method, reference);
      left -= share;
      if (!left) break;
    }
    activity.log(db, req, 'group.payment', `Payment of ${f.money(amount)} (${method}) for group ${g.code}`);
  });
  return amount;
}

module.exports = { list, detail, formData, create, checkInAll, pay, requireGroup, summarise };
