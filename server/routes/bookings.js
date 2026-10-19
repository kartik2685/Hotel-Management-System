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
const billing = require('../services/billing');
const registration = require('../services/registration');
const guests = require('../services/guests');

const router = express.Router();
const FLASH = {
  saved: 'Booking saved.', created: 'Booking created and saved.', 'check-in': 'Checked in. The room now shows as occupied.', 'check-out': 'Checked out. The room is marked dirty for housekeeping.',
  'check-out-early': 'Checked out early: the bill now covers the nights stayed. The room is marked dirty for housekeeping.',
  cancel: 'Booking cancelled. The room is free again.', confirm: 'Booking confirmed.', payment: 'Payment recorded.', refund: 'Refund recorded.',
  grc: 'Registration card saved and complete.', 'grc-partial': 'Registration card saved. Some details are still missing.', form3: 'Form III acknowledgement saved.',
};

function renderBooking(req, res, next, extra = {}, status = 200) {
  const db = req.db;
  const shell = shellService.build(db, req, 'reservations');
  const d = reservations.detail(db, req.params.confirmation, shell.bd);
  if (!d) return next();
  res.status(status).render('pages/reservation', {
    title: `${d.b.confirmation} · ${d.b.name} · Frontdesk Hotel Management`, description: `Booking ${d.b.confirmation} for ${d.b.name}.`,
    page: 'reservation', css: ['pages/admin'], scripts: [], shell, d, flash: FLASH[req.query.ok] || '',
    errors: {}, values: {}, payErrors: {}, payValues: {}, grcErrors: {}, grcValues: {}, invErrors: {}, invValues: {}, f3Errors: {}, actionError: '',
    canBook: can(req.user, 'bookings'), canRefund: can(req.user, 'manage'),
    payments: billing.payments(db, d.b.id), invoices: billing.forReservation(db, d.b.id), methods: billing.METHODS,
    reg: registration.view(db, d.b), countries: registration.COUNTRIES, idTypes: registration.ID_TYPES, visaTypes: registration.VISA_TYPES, purposes: registration.PURPOSES,
    gst: req.settings.tax_mode === 'gst_india', ...extra,
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
    const b = billing.addPayment(req.db, req, req.params.confirmation, req.body);
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
    let done = action;
    if (action === 'check-in') reservations.checkIn(req.db, req, conf);
    else if (action === 'check-out') done = reservations.checkOut(req.db, req, conf, { settle: req.body.settle === 'on', method: req.body.method }).early ? 'check-out-early' : action;
    else if (action === 'confirm') reservations.confirm(req.db, req, conf);
    else if (action === 'cancel') {
      if (req.body.sure !== 'on') throw Object.assign(new Error('Tick “Yes, cancel this booking” to cancel it.'), { status: 422 });
      reservations.cancel(req.db, req, conf);
    } else throw Object.assign(new Error('Unknown action.'), { status: 422 });
    res.redirect(303, `/reservations/${encodeURIComponent(conf)}?ok=${done}`);
  } catch (error) {
    if (error.status === 422) return renderBooking(req, res, next, { actionError: error.message }, 422);
    next(error);
  }
});

router.post('/reservations/:confirmation/refund', requireAbility('manage'), (req, res, next) => {
  try {
    const b = billing.refund(req.db, req, req.params.confirmation, req.body);
    res.redirect(303, `/reservations/${encodeURIComponent(b.confirmation)}?ok=refund`);
  } catch (error) {
    if (error instanceof reservations.FormError) return renderBooking(req, res, next, { payErrors: error.errors, payValues: error.values }, 422);
    next(error);
  }
});

/* Registration card (GRC) and Form III. */
router.post('/reservations/:confirmation/grc', requireAbility('bookings'), (req, res, next) => {
  try {
    const complete = registration.saveGrc(req.db, req, req.params.confirmation, req.body);
    res.redirect(303, `/reservations/${encodeURIComponent(req.params.confirmation)}?ok=${complete ? 'grc' : 'grc-partial'}#grc`);
  } catch (error) {
    if (error instanceof reservations.FormError) return renderBooking(req, res, next, { grcErrors: error.errors, grcValues: error.values }, 422);
    next(error);
  }
});
router.get('/reservations/:confirmation/grc', requireAbility('frontOffice'), (req, res, next) => {
  const b = reservations.byConfirmation(req.db, req.params.confirmation);
  if (!b) return next();
  res.render('pages/grc-print', { s: req.settings, b, reg: registration.view(req.db, b), today: require('../services/settings').businessDate(req.db) });
});
router.post('/reservations/:confirmation/form3', requireAbility('bookings'), (req, res, next) => {
  try {
    registration.recordForm3(req.db, req, req.params.confirmation, req.body);
    res.redirect(303, `/reservations/${encodeURIComponent(req.params.confirmation)}?ok=form3#form3`);
  } catch (error) {
    if (error instanceof reservations.FormError) return renderBooking(req, res, next, { f3Errors: error.errors }, 422);
    next(error);
  }
});

/* Invoices. */
router.post('/reservations/:confirmation/invoice', requireAbility('bookings'), (req, res, next) => {
  try {
    const id = billing.createInvoice(req.db, req, req.params.confirmation, req.body);
    res.redirect(303, `/invoices/${id}`);
  } catch (error) {
    if (error instanceof reservations.FormError) return renderBooking(req, res, next, { invErrors: error.errors, invValues: error.values }, 422);
    if (error.status === 422) return renderBooking(req, res, next, { actionError: error.message }, 422);
    next(error);
  }
});
router.get('/invoices/:id', requireAbility('frontOffice'), (req, res, next) => {
  const inv = billing.invoice(req.db, Number.parseInt(req.params.id, 10) || 0);
  if (!inv) return next();
  require('../lib/format').setCurrency(inv.data.currency.symbol, inv.data.currency.locale); // amounts as issued
  res.render('pages/invoice', { inv, d: inv.data });
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
const PREFS = guests.PREF_GROUPS;

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
  const id = Number.parseInt(req.params.id, 10) || 0;
  const result = guests.saveProfile(req.db, req, id, req.body);
  if (!result) return next();
  if (result.errors) return renderGuest(req, res, next, { errors: result.errors, values: result.values }, 422);
  res.redirect(303, `/guests?guest=${id}&saved=1`);
});

module.exports = router;
