'use strict';
/* Booking page (view, change, take payment, check in/out, cancel), handover notes and guest profile editing. */
const express = require('express');
const { requireAbility, can } = require('../lib/security');
const { Form } = require('../lib/forms');
const activity = require('../lib/activity');
const clock = require('../lib/clock');
const f = require('../lib/format');
const shellService = require('../services/shell');
const reservations = require('../services/reservations');

const router = express.Router();
const FLASH = {
  saved: 'Booking saved.', created: 'Booking created and saved.', 'check-in': 'Checked in. The room now shows as occupied.', 'check-out': 'Checked out. The room is marked dirty for housekeeping.',
  cancel: 'Booking cancelled. The room is free again.', confirm: 'Booking confirmed.', payment: 'Payment recorded.',
};

function renderBooking(req, res, next, extra = {}, status = 200) {
  const db = req.db;
  const shell = shellService.build(db, req, 'reservations');
  const d = reservations.detail(db, req.params.confirmation, shell.bd);
  if (!d) return next();
  res.status(status).render('pages/reservation', {
    title: `${d.b.confirmation} · ${d.b.name} · Frontdesk Hotel Management`, description: `Booking ${d.b.confirmation} for ${d.b.name}.`,
    page: 'reservation', css: ['pages/admin'], scripts: [], shell, d, flash: FLASH[req.query.ok] || '',
    errors: {}, values: {}, payErrors: {}, payValues: {}, actionError: '', canBook: can(req.user, 'bookings'), ...extra,
  });
}

router.get('/reservations/:confirmation', requireAbility('frontOffice'), (req, res, next) => renderBooking(req, res, next));

router.post('/reservations/:confirmation', requireAbility('bookings'), (req, res, next) => {
  try {
    const b = reservations.update(req.db, req, req.params.confirmation, req.body);
    res.redirect(303, `/reservations/${encodeURIComponent(b.confirmation)}?ok=saved`);
  } catch (error) {
    if (error instanceof reservations.FormError) return renderBooking(req, res, next, { errors: error.errors, values: error.values }, 422);
    next(error);
  }
});

router.post('/reservations/:confirmation/payment', requireAbility('bookings'), (req, res, next) => {
  try {
    const b = reservations.addPayment(req.db, req, req.params.confirmation, req.body);
    res.redirect(303, `/reservations/${encodeURIComponent(b.confirmation)}?ok=payment`);
  } catch (error) {
    if (error instanceof reservations.FormError) return renderBooking(req, res, next, { payErrors: error.errors, payValues: error.values }, 422);
    next(error);
  }
});

router.post('/reservations/:confirmation/action', requireAbility('bookings'), (req, res, next) => {
  const conf = req.params.confirmation;
  const action = String(req.body.action || '');
  try {
    if (action === 'check-in') reservations.checkIn(req.db, req, conf);
    else if (action === 'check-out') reservations.checkOut(req.db, req, conf, { settle: req.body.settle === 'on' });
    else if (action === 'confirm') reservations.confirm(req.db, req, conf);
    else if (action === 'cancel') {
      if (req.body.sure !== 'on') throw Object.assign(new Error('Tick “Yes, cancel this booking” to cancel it.'), { status: 422 });
      reservations.cancel(req.db, req, conf);
    } else throw Object.assign(new Error('Unknown action.'), { status: 422 });
    res.redirect(303, `/reservations/${encodeURIComponent(conf)}?ok=${action}`);
  } catch (error) {
    if (error.status === 422) return renderBooking(req, res, next, { actionError: error.message }, 422);
    next(error);
  }
});

/* ------------------------------------------------------------------ handover notes */
function renderHandover(req, res, extra = {}, status = 200) {
  const db = req.db;
  const shell = shellService.build(db, req, 'handover');
  const notes = db.all('SELECT h.*, u.avatar_tone FROM handover_notes h LEFT JOIN users u ON u.id = h.author_id ORDER BY h.created_at DESC, h.id DESC LIMIT 40')
    .map((n) => ({ ...n, initials: f.initials(n.author_name), when: `${f.formatDay(n.created_at)} · ${f.clock(n.created_at)}` }));
  res.status(status).render('pages/handover', {
    title: 'Shift handover · Frontdesk Hotel Management', description: 'Notes for the next shift.', page: 'handover', css: ['pages/admin'], scripts: [],
    shell, notes, flash: req.query.ok === 'created' ? 'Note added. It shows on the dashboard for the next shift.' : '', errors: {}, values: {}, ...extra,
  });
}
router.get('/handover', requireAbility('frontOffice'), (req, res) => renderHandover(req, res));
router.post('/handover', requireAbility('frontOffice'), (req, res) => {
  const form = new Form(req.body);
  const lead = form.text('lead', { label: 'Headline', max: 120, required: true });
  const body = form.longText('body', { label: 'Details', max: 600 });
  if (!form.ok) return renderHandover(req, res, { errors: form.errors, values: form.values }, 422);
  const user = req.db.get('SELECT department FROM users WHERE id = ?', req.user.id);
  req.db.run('INSERT INTO handover_notes (author_id, author_name, department, lead, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    req.user.id, req.user.name, (user && user.department) || req.user.title || 'Front office', lead, body, clock.stamp(req.settings.timezone));
  activity.log(req.db, req, 'handover.create', `Handover note: ${lead}`);
  res.redirect(303, '/handover?ok=created');
});

/* ------------------------------------------------------------------ guest profile editing */
const PREFS = [['room', 'Room'], ['comfort', 'Comfort'], ['dining', 'Dining'], ['service', 'Service']];

function renderGuest(req, res, next, extra = {}, status = 200) {
  const db = req.db;
  const g = db.get('SELECT * FROM guests WHERE id = ?', Number.parseInt(req.params.id, 10) || 0);
  if (!g) return next();
  const shell = shellService.build(db, req, 'guests');
  res.status(status).render('pages/guest-edit', {
    title: `Edit ${g.first_name} ${g.last_name} · Frontdesk Hotel Management`, description: 'Edit a guest profile.', page: 'guest-edit', css: ['pages/admin'], scripts: [],
    shell, g, prefs: JSON.parse(g.preferences || '{}'), PREFS, errors: {}, values: {},
    notes: db.all('SELECT * FROM guest_notes WHERE guest_id = ? ORDER BY created_at DESC, id DESC', g.id).map((n) => ({ ...n, when: f.formatDay(n.created_at) })),
    ...extra,
  });
}
router.get('/guests/:id/edit', requireAbility('frontOffice'), (req, res, next) => renderGuest(req, res, next));
router.post('/guests/:id/edit', requireAbility('frontOffice'), (req, res, next) => {
  const db = req.db;
  const g = db.get('SELECT * FROM guests WHERE id = ?', Number.parseInt(req.params.id, 10) || 0);
  if (!g) return next();
  const form = new Form(req.body);
  const v = {
    first: form.text('first', { label: 'First name', max: 60, required: true }),
    last: form.text('last', { label: 'Last name', max: 60, required: true }),
    email: form.email('email', { required: false }),
    phone: form.text('phone', { label: 'Phone', max: 40 }),
    city: form.text('city', { label: 'City', max: 80 }),
    company: form.text('company', { label: 'Company', max: 80 }),
    vip: form.bool('vip'),
    corporate: form.bool('corporate'),
    note: form.longText('note', { label: 'Note', max: 500 }),
  };
  const prefs = {};
  for (const [key] of PREFS) prefs[key] = form.list(`pref_${key}`);
  if (!form.ok) return renderGuest(req, res, next, { errors: form.errors, values: form.values }, 422);
  const stamp = clock.stamp(req.settings.timezone);
  db.tx(() => {
    db.run('UPDATE guests SET first_name = ?, last_name = ?, email = ?, phone = ?, city = ?, company = ?, vip = ?, corporate = ?, preferences = ?, updated_at = ? WHERE id = ?',
      v.first, v.last, v.email || null, v.phone || null, v.city || null, v.company || null, v.vip ? 1 : 0, v.corporate ? 1 : 0,
      JSON.stringify(Object.fromEntries(Object.entries(prefs).filter(([, list]) => list.length))), stamp, g.id);
    if (v.note) db.run('INSERT INTO guest_notes (guest_id, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)', g.id, req.user.id, req.user.name, v.note, stamp);
  });
  activity.log(db, req, 'guest.update', `Updated guest profile ${v.first} ${v.last}${v.note ? ' and added a note' : ''}`);
  res.redirect(303, `/guests?guest=${g.id}`);
});

module.exports = router;
