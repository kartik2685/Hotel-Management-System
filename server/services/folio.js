'use strict';
/* Charges posted to a guest's bill during the stay: room service, minibar, laundry, spa, a taxi… Each charge
   keeps its own tax rate (and SAC code on GST invoices); reservations.charges_cents holds the open charges with
   their tax and is part of total_cents, so balances, check-out and invoices include them. A charge posted by
   mistake is voided (managers), never deleted. */
const f = require('../lib/format');
const clock = require('../lib/clock');
const activity = require('../lib/activity');
const { Form } = require('../lib/forms');
const settingsService = require('./settings');
const reservations = require('./reservations');
const { KINDS, GST_RATES, isGst, premium } = require('./tax-kinds');

/* Rates staff may choose, in percent. */
const rates = (settings) => (isGst(settings) ? GST_RATES : [...new Set([0, Number(settings.tax_rate) || 0])]);

/* The kinds with the usual rate for this hotel. */
function kinds(db, settings) {
  const high = premium(db);
  return KINDS.map((k) => ({ ...k, rate: isGst(settings) ? k.gst(high) : Number(settings.tax_rate) || 0 }));
}

const percentText = (bp) => `${Number((bp / 100).toFixed(2))}%`;

function list(db, reservationId) {
  return db.all('SELECT * FROM folio_charges WHERE reservation_id = ? ORDER BY posted_at, id', reservationId).map((c) => ({
    ...c,
    total_cents: c.amount_cents + c.tax_cents,
    kindLabel: (KINDS.find((k) => k.value === c.kind) || KINDS[KINDS.length - 1]).label,
    when: `${f.formatDay(c.posted_at)} · ${c.posted_at.slice(11, 16)}`,
    rateText: percentText(c.tax_bp),
  }));
}

/* Posts a charge to an in-house guest's bill. Throws FormError for a bad form, BookingError otherwise. */
function post(db, req, confirmation, body) {
  const settings = settingsService.all(db);
  const r = reservations.requireBooking(db, confirmation);
  if (r.status !== 'checked_in') throw new reservations.BookingError('Charges go on the bill of a guest who is in house.');
  const all = kinds(db, settings);
  const form = new Form(body);
  const kindValue = form.oneOf('charge_kind', all.map((k) => k.value), { label: 'Kind' });
  const kind = all.find((k) => k.value === kindValue);
  const description = form.text('charge_text', { label: 'Description', max: 80 }) || (kind ? kind.label : '');
  const amount = form.money('charge_amount', { label: 'Amount', min: 1, max: 1000000 });
  const rateRaw = String(body.charge_rate ?? '').trim();
  const rate = rateRaw === '' ? (kind ? kind.rate : 0) : Number(rateRaw);
  if (!rates(settings).includes(rate)) form.fail('charge_rate', 'Choose one of the tax rates in the list.');
  if (!form.ok) throw new reservations.FormError(form.errors, form.values);

  const bp = Math.round(rate * 100);
  const tax = Math.round((amount * bp) / 10000);
  const stamp = clock.stamp(settings.timezone);
  return db.tx(() => {
    const { id } = db.get(
      `INSERT INTO folio_charges (reservation_id, kind, description, sac, amount_cents, tax_bp, tax_cents, posted_by, posted_by_name, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      r.id, kind.value, description, isGst(settings) ? kind.sac : null, amount, bp, tax, req.user ? req.user.id : null, req.user ? req.user.name : 'System', stamp,
    );
    db.run('UPDATE reservations SET charges_cents = charges_cents + ?, total_cents = total_cents + ?, updated_at = ? WHERE id = ?', amount + tax, amount + tax, stamp, r.id);
    activity.log(db, req, 'folio.charge', `Charged ${f.money(amount + tax)} to ${r.confirmation} (${r.name}): ${description}`);
    return id;
  });
}

/* Takes a charge off the bill; it stays listed as voided. */
function voidCharge(db, req, confirmation, chargeId) {
  const settings = settingsService.all(db);
  const r = reservations.requireBooking(db, confirmation);
  const c = db.get('SELECT * FROM folio_charges WHERE id = ? AND reservation_id = ?', chargeId, r.id);
  if (!c) return null;
  if (c.voided_at) throw new reservations.BookingError('That charge was already taken off the bill.');
  if (r.status === 'checked_out' || r.status === 'cancelled') throw new reservations.BookingError('The guest has checked out, so the bill is closed: refund the amount instead.');
  const stamp = clock.stamp(settings.timezone);
  db.tx(() => {
    db.run('UPDATE folio_charges SET voided_at = ?, voided_by_name = ? WHERE id = ?', stamp, req.user ? req.user.name : 'System', c.id);
    db.run('UPDATE reservations SET charges_cents = charges_cents - ?, total_cents = total_cents - ?, updated_at = ? WHERE id = ?', c.amount_cents + c.tax_cents, c.amount_cents + c.tax_cents, stamp, r.id);
    activity.log(db, req, 'folio.void', `Took ${f.money(c.amount_cents + c.tax_cents)} (${c.description}) off the bill of ${r.confirmation}`);
  });
  return c;
}

module.exports = { KINDS, kinds, rates, list, post, voidCharge, percentText };
