'use strict';
const crypto = require('node:crypto');
const clock = require('../lib/clock');
const billing = require('./billing');
const settingsService = require('./settings');
const reservations = require('./reservations');
const { registerPaymentAdapter, integrationStatus } = require('./integrations');
const youpi = require('./youpi');

registerPaymentAdapter('youpi', youpi);

const configured = () => process.env.PAYMENT_PROVIDER === 'youpi' && process.env.PAYMENT_MODE === 'test' && youpi.isConfigured();
const enabled = (db) => configured() && Boolean(db && settingsService.all(db).online_payments_enabled);

function stableAmount(body) {
  const raw = String(body.amount || '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

async function createCheckout(db, req, booking) {
  if (!enabled(db)) throw Object.assign(new Error('Online UPI checkout is disabled. Turn it on in Admin → Payments after the authorized test gateway is configured.'), { status: 503 });
  const settings = req.settings || settingsService.all(db);
  if (settings.currency_code !== 'INR') throw Object.assign(new Error('YOUPI UPI checkout is available only for INR hotel balances.'), { status: 422 });
  if (!youpi.isConfigured()) throw Object.assign(new Error('YOUPI test checkout is not configured. Ask an administrator to check the Integrations setup.'), { status: 503 });
  if (['cancelled', 'no_show'].includes(booking.status)) throw Object.assign(new Error('This reservation cannot be paid online.'), { status: 422 });
  const amountCents = booking.total_cents - booking.paid_cents;
  if (amountCents <= 0) throw Object.assign(new Error('This reservation has no balance due.'), { status: 422 });

  let attempt;
  try {
    attempt = db.tx(() => {
      const open = db.get("SELECT * FROM payment_attempts WHERE reservation_id = ? AND status IN ('creating', 'active') ORDER BY id DESC LIMIT 1", booking.id);
      if (open) return open;
      const now = clock.stamp(settings.timezone);
      const orderId = `HMS-${booking.confirmation}-${crypto.randomBytes(5).toString('hex')}`;
      const idempotencyKey = `hms-${booking.id}-${crypto.randomUUID()}`;
      db.run(
        `INSERT INTO payment_attempts (reservation_id, provider, idempotency_key, order_id, amount_cents, currency, status, created_at, updated_at)
         VALUES (?, 'youpi', ?, ?, ?, 'INR', 'creating', ?, ?)`,
        booking.id, idempotencyKey, orderId, amountCents, now, now,
      );
      return db.get('SELECT * FROM payment_attempts WHERE idempotency_key = ?', idempotencyKey);
    });
  } catch (error) {
    // Another request may have created the one allowed open attempt at the same time.
    attempt = db.get("SELECT * FROM payment_attempts WHERE reservation_id = ? AND status IN ('creating', 'active') ORDER BY id DESC LIMIT 1", booking.id);
    if (!attempt) throw error;
  }

  if (attempt.status === 'active' && attempt.checkout_url) return attempt;
  try {
    const result = await youpi.createCheckout({
      reservationId: booking.id,
      confirmation: booking.confirmation,
      orderId: attempt.order_id,
      amountCents: attempt.amount_cents,
      idempotencyKey: attempt.idempotency_key,
      returnUrl: `${require('./website').siteUrl(req, settings)}/hotel/booking/${encodeURIComponent(booking.confirmation)}?t=${encodeURIComponent(req.body?.t || req.query?.t || '')}&payment=return`,
    });
    const updatedAt = clock.stamp(settings.timezone);
    db.run("UPDATE payment_attempts SET provider_payment_id = ?, checkout_url = ?, status = 'active', updated_at = ? WHERE id = ? AND status = 'creating'",
      result.paymentId, result.checkoutUrl, updatedAt, attempt.id);
    return db.get('SELECT * FROM payment_attempts WHERE id = ?', attempt.id);
  } catch (error) {
    if (!error.retryable) db.run("UPDATE payment_attempts SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'creating'", clock.stamp(settings.timezone), attempt.id);
    throw error;
  }
}

function processWebhook(db, req, rawBody, signature) {
  const envConfig = youpi.config();
  if (!youpi.verifyWebhook(rawBody, signature, envConfig.webhookSecret)) throw Object.assign(new Error('Invalid YOUPI webhook signature.'), { status: 401 });
  let body;
  try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw Object.assign(new Error('Webhook body is not valid JSON.'), { status: 400 }); }

  const eventType = String(body.event || '').toUpperCase();
  const paymentId = String(body.paymentId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const amountCents = stableAmount(body);
  const paise = Number(body.amountPaise);
  if (!['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(eventType) || !paymentId || !orderId || !amountCents || !Number.isSafeInteger(paise)) {
    throw Object.assign(new Error('YOUPI webhook is missing a valid event, payment, order or amount.'), { status: 400 });
  }
  if (body.currency !== 'INR' || amountCents !== paise) throw Object.assign(new Error('YOUPI webhook currency or amount fields disagree.'), { status: 400 });

  const settings = req.settings || settingsService.all(db);
  const receivedAt = clock.stamp(settings.timezone);
  const externalEventId = `${paymentId}:${eventType}`;
  return db.tx(() => {
    const seen = db.get("SELECT id, status FROM integration_events WHERE provider = 'youpi' AND external_event_id = ? AND direction = 'inbound'", externalEventId);
    if (seen && seen.status !== 'unmatched') return { duplicate: true, status: seen.status };
    if (seen) db.run("UPDATE integration_events SET status = 'received', received_at = ? WHERE id = ?", receivedAt, seen.id);
    else db.run(
      `INSERT INTO integration_events (provider, external_event_id, event_type, direction, status, received_at)
       VALUES ('youpi', ?, ?, 'inbound', 'received', ?)`, externalEventId, eventType, receivedAt,
    );
    const event = seen || db.get("SELECT id FROM integration_events WHERE provider = 'youpi' AND external_event_id = ? AND direction = 'inbound'", externalEventId);
    const attempt = db.get('SELECT * FROM payment_attempts WHERE provider = ? AND order_id = ?', 'youpi', orderId);
    if (!attempt) {
      db.run("UPDATE integration_events SET status = 'unmatched' WHERE id = ?", event.id);
      return { duplicate: false, status: 'unmatched' };
    }
    if (attempt.provider_payment_id && attempt.provider_payment_id !== paymentId) {
      db.run("UPDATE integration_events SET status = 'review' WHERE id = ?", event.id);
      db.run("UPDATE payment_attempts SET status = 'review', updated_at = ? WHERE id = ? AND status <> 'success'", receivedAt, attempt.id);
      return { duplicate: false, status: 'review' };
    }
    if (attempt.amount_cents !== amountCents || attempt.currency !== body.currency) {
      db.run("UPDATE integration_events SET status = 'review' WHERE id = ?", event.id);
      db.run("UPDATE payment_attempts SET status = 'review', provider_payment_id = ?, updated_at = ? WHERE id = ? AND status <> 'success'", paymentId, receivedAt, attempt.id);
      return { duplicate: false, status: 'review' };
    }

    if (eventType === 'SUCCESS' && attempt.status !== 'success') {
      const info = db.get('SELECT confirmation FROM reservations WHERE id = ?', attempt.reservation_id);
      const booking = info && reservations.requireBooking(db, info.confirmation);
      const due = booking ? booking.total_cents - booking.paid_cents : 0;
      if (!booking || ['cancelled', 'no_show'].includes(booking.status) || amountCents > due) {
        db.run("UPDATE integration_events SET status = 'review' WHERE id = ?", event.id);
        db.run("UPDATE payment_attempts SET status = 'review', provider_payment_id = ?, updated_at = ? WHERE id = ?", paymentId, receivedAt, attempt.id);
        return { duplicate: false, status: 'review' };
      }
      const utr = String(body.utr || '').trim().slice(0, 80);
      const reference = `YOUPI ${paymentId}${utr ? ` · UTR ${utr}` : ''}`;
      billing.record(db, req, booking, amountCents, 'UPI', reference);
      db.run("UPDATE payment_attempts SET status = 'success', provider_payment_id = ?, utr = ?, recorded_payment_id = (SELECT id FROM payments WHERE reservation_id = ? AND reference = ? ORDER BY id DESC LIMIT 1), updated_at = ? WHERE id = ?",
        paymentId, utr, booking.id, reference, receivedAt, attempt.id);
    } else if (attempt.status !== 'success' && eventType !== 'SUCCESS') {
      db.run('UPDATE payment_attempts SET status = ?, provider_payment_id = ?, updated_at = ? WHERE id = ?', eventType.toLowerCase(), paymentId, receivedAt, attempt.id);
    }
    db.run("UPDATE integration_events SET status = 'processed', processed_at = ? WHERE id = ?", receivedAt, event.id);
    return { duplicate: false, status: eventType.toLowerCase() };
  });
}

function statusFor(reservationId, db = null) {
  if (!enabled(db)) return null;
  return db.get("SELECT id, amount_cents, status, checkout_url FROM payment_attempts WHERE reservation_id = ? AND status IN ('creating', 'active', 'success', 'review') ORDER BY id DESC LIMIT 1", reservationId) || null;
}

module.exports = { configured, enabled, createCheckout, processWebhook, statusFor };
