'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startHotel } = require('./helpers');
const http = require('node:http');
const fs = require('node:fs');
const integrations = require('../server/services/integrations');

describe('optional integration foundations', () => {
  test('provider-neutral payment and message adapters fail closed until registered', async () => {
    await assert.rejects(integrations.createCheckout({ reservationId: 1 }, {}), { code: 'PAYMENT_ADAPTER_MISSING' });
    await assert.rejects(integrations.sendMessage({ to: '+15555550123', body: 'test' }, {}), { code: 'MESSAGE_ADAPTER_MISSING' });
    const status = integrations.integrationStatus({});
    assert.equal(status.find((item) => item.key === 'payments').status, 'disabled');
    assert.equal(integrations.integrationStatus({ PAYMENT_PROVIDER: 'unregistered' }).find((item) => item.key === 'payments').status, 'adapter required');
    assert.equal(status.find((item) => item.key === 'messaging').status, 'manual links');
    assert.equal(status.find((item) => item.key === 'properties').status, 'not enabled');
  });

  test('channel-manager inbox verifies signatures, rejects replays, and deduplicates events', async () => {
    const originalSecret = process.env.CHANNEL_MANAGER_WEBHOOK_SECRET;
    process.env.CHANNEL_MANAGER_WEBHOOK_SECRET = 'test-only-secret';
    const hotel = await startHotel();
    try {
      const body = JSON.stringify({ event_id: 'partner-event-123', event_type: 'reservation.changed', guest_email: 'not-stored@example.com' });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = crypto.createHmac('sha256', process.env.CHANNEL_MANAGER_WEBHOOK_SECRET).update(`${timestamp}.`).update(body).digest('hex');
      const request = () => fetch(`${hotel.base}/integrations/channel-manager/events`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-channel-timestamp': timestamp, 'x-channel-signature': `sha256=${signature}`, 'x-channel-manager-provider': 'test-partner' }, body,
      });
      const first = await request();
      assert.equal(first.status, 202);
      assert.equal((await first.json()).status, 'pending_adapter');
      const duplicate = await request();
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json()).duplicate, true);
      const row = hotel.db.get('SELECT * FROM integration_events WHERE provider = ?', 'test-partner');
      assert.equal(row.status, 'pending_adapter');
      assert.equal(Object.hasOwn(row, 'payload_json'), false);
      assert.equal(hotel.db.get('SELECT COUNT(*) AS n FROM integration_events').n, 1);

      const forged = await fetch(`${hotel.base}/integrations/channel-manager/events`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-channel-timestamp': timestamp, 'x-channel-signature': 'sha256=' + '0'.repeat(64) }, body: JSON.stringify({ event_id: 'forged', event_type: 'reservation.changed' }),
      });
      assert.equal(forged.status, 401);
      assert.equal(hotel.db.get('SELECT COUNT(*) AS n FROM integration_events').n, 1);
    } finally {
      await hotel.stop();
      if (originalSecret === undefined) delete process.env.CHANNEL_MANAGER_WEBHOOK_SECRET;
      else process.env.CHANNEL_MANAGER_WEBHOOK_SECRET = originalSecret;
    }
  });

  test('YOUPI checkout uses the exact balance and only a signed webhook posts one ledger payment', async () => {
    const keys = ['PAYMENT_PROVIDER', 'PAYMENT_MODE', 'YOUPI_API_URL', 'YOUPI_MERCHANT_ID', 'YOUPI_WEBHOOK_SECRET', 'YOUPI_ALLOW_INSECURE_HTTP'];
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    let apiRequest;
    const api = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      apiRequest = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) };
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ paymentId: 'test-payment-1', orderId: apiRequest.body.orderId, amountPaise: Math.round(Number(apiRequest.body.amount) * 100), checkoutUrl: `http://127.0.0.1:${api.address().port}/checkout/test-payment-1`, status: 'ACTIVE' }));
    });
    api.listen(0, '127.0.0.1');
    await new Promise((resolve) => api.once('listening', resolve));
    process.env.PAYMENT_PROVIDER = 'youpi';
    process.env.PAYMENT_MODE = 'test';
    process.env.YOUPI_API_URL = `http://127.0.0.1:${api.address().port}`;
    process.env.YOUPI_MERCHANT_ID = 'merchant-test';
    process.env.YOUPI_WEBHOOK_SECRET = 'webhook-test-secret';
    process.env.YOUPI_ALLOW_INSECURE_HTTP = '1';
    const hotel = await startHotel();
    try {
      const settingsService = require('../server/services/settings');
      settingsService.save(hotel.db, { currency_code: 'INR', online_payments_enabled: true });
      const c = hotel.client();
      const details = await c.get('/hotel/book/details?arrival=2026-11-02&departure=2026-11-05&adults=2&children=0&type=DK&plan=BAR');
      const token = details.text.match(/name="_csrf" value="([^"]+)"/)[1];
      const booked = await c.request('POST', '/hotel/book', { form: { _csrf: token, arrival: '2026-11-02', departure: '2026-11-05', adults: '2', children: '0', type: 'DK', plan: 'BAR', first: 'Riya', last: 'Banerjee', email: 'upi.guest@example.com', phone: '+91 98300 11111', nationality: 'IN', terms: 'on' } });
      assert.equal(booked.status, 303);
      const confirmationLink = booked.headers.get('location');
      const confirmation = confirmationLink.match(/HLW-\d+/)[0];
      const bookingToken = new URL(confirmationLink, hotel.base).searchParams.get('t');
      const bookingPage = await c.get(confirmationLink);
      const csrf = bookingPage.text.match(/name="_csrf" value="([^"]+)"/)[1];
      const checkout = await c.request('POST', `/hotel/booking/${confirmation}/pay`, { form: { _csrf: csrf, t: bookingToken } });
      assert.equal(checkout.status, 303);
      assert.match(checkout.headers.get('location'), /\/checkout\/test-payment-1$/);
      const row = hotel.db.get('SELECT * FROM reservations WHERE confirmation = ?', confirmation);
      assert.equal(apiRequest.url, '/api/v1/payments');
      assert.equal(apiRequest.headers['x-merchant-id'], 'merchant-test');
      assert.ok(apiRequest.headers['idempotency-key']);
      assert.equal(Number(apiRequest.body.amount), row.total_cents / 100);
      assert.equal(apiRequest.body.currency, 'INR');
      assert.match(apiRequest.body.returnUrl, new RegExp(`/hotel/booking/${confirmation}`));
      assert.equal(hotel.db.get('SELECT COUNT(*) AS n FROM payments WHERE reservation_id = ?', row.id).n, 0, 'redirect is not payment proof');

      const attempt = hotel.db.get('SELECT * FROM payment_attempts WHERE reservation_id = ?', row.id);
      const payload = JSON.stringify({ event: 'SUCCESS', paymentId: 'test-payment-1', orderId: attempt.order_id, amount: apiRequest.body.amount, amountPaise: row.total_cents, currency: 'INR', utr: '123456789012' });
      const signature = crypto.createHmac('sha256', process.env.YOUPI_WEBHOOK_SECRET).update(payload).digest('hex');
      const sendWebhook = (signed) => fetch(`${hotel.base}/integrations/youpi/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gateway-signature': signed }, body: payload });
      assert.equal((await sendWebhook('0'.repeat(64))).status, 401);
      const accepted = await sendWebhook(`sha256=${signature}`);
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).status, 'success');
      const duplicate = await sendWebhook(signature);
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json()).duplicate, true);
      assert.equal(hotel.db.get('SELECT COUNT(*) AS n FROM payments WHERE reservation_id = ?', row.id).n, 1);
      assert.equal(hotel.db.get('SELECT paid_cents FROM reservations WHERE id = ?', row.id).paid_cents, row.total_cents);
      assert.equal(hotel.db.get('SELECT status FROM payment_attempts WHERE id = ?', attempt.id).status, 'success');
    } finally {
      await hotel.stop();
      await new Promise((resolve) => api.close(resolve));
      for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
    }
  });

  test('an admin can publish a Paytm merchant UPI ID and QR for manual guest payment', async () => {
    const hotel = await startHotel();
    let savedQr = '';
    try {
      const admin = hotel.client();
      await admin.login();
      const page = await admin.get('/admin/payments');
      const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
      const paymentsBefore = hotel.db.get('SELECT COUNT(*) AS n FROM payments').n;
      const form = new FormData();
      form.set('_csrf', csrf);
      form.set('upi_id', 'hotel.test@paytm');
      form.set('upi_enabled', 'on');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c7WQAAAAASUVORK5CYII=', 'base64');
      form.set('upi_qr_upload', new Blob([png], { type: 'image/png' }), 'paytm-qr.png');
      const response = await fetch(`${hotel.base}/admin/payments/upi`, { method: 'POST', headers: { cookie: admin.cookieHeader() }, body: form, redirect: 'manual' });
      admin.remember(response);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/admin/payments?ok=payments-saved');
      const settings = require('../server/services/settings');
      settings.save(hotel.db, { currency_code: 'INR', currency_symbol: '₹', currency_locale: 'en-IN' });
      const saved = settings.all(hotel.db);
      assert.equal(saved.manual_upi_id, 'hotel.test@paytm');
      assert.equal(saved.manual_upi_enabled, true);
      savedQr = saved.manual_upi_qr;
      assert.match(savedQr, /^\/assets\/img\/payments\/[a-f0-9]+\.png$/);
      const booking = hotel.db.get("SELECT r.confirmation, g.email FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE g.email IS NOT NULL AND r.status IN ('confirmed', 'checked_in') AND r.total_cents > r.paid_cents LIMIT 1");
      const token = require('../server/services/website').token(hotel.db, booking.confirmation, booking.email);
      const guest = await hotel.client().get(`/hotel/booking/${booking.confirmation}?t=${token}`);
      assert.equal(guest.status, 200);
      assert.match(guest.text, /hotel\.test@paytm/);
      assert.match(guest.text, /Open UPI app to pay/);
      assert.match(guest.text, /not verified automatically/i);
      assert.match(guest.text, new RegExp(savedQr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(hotel.db.get('SELECT COUNT(*) AS n FROM payments').n, paymentsBefore, 'showing a QR never creates a payment ledger entry');
    } finally {
      if (savedQr) fs.rmSync(require('node:path').join(require('../server/config').root, savedQr.slice('/assets/'.length)), { force: true });
      await hotel.stop();
    }
  });

  test('integration status page is restricted to hotel administrators', async () => {
    const hotel = await startHotel();
    try {
      const admin = hotel.client();
      await admin.login();
      const page = await admin.get('/admin/integrations');
      assert.equal(page.status, 200);
      assert.match(page.text, /Online payments/);
      assert.match(page.text, /Single property mode/);
      const paymentPage = await admin.get('/admin/payments');
      assert.equal(paymentPage.status, 200);
      assert.match(paymentPage.text, /Bank settlement, UPI and QR/);
      assert.match(paymentPage.text, /This adapter is test-only/);
      const csrf = paymentPage.text.match(/name="_csrf" value="([^"]+)"/)[1];
      const refusedEnable = await admin.request('POST', '/admin/payments', { form: { _csrf: csrf, enabled: 'on' } });
      assert.equal(refusedEnable.status, 303);
      assert.equal(refusedEnable.headers.get('location'), '/admin/payments?error=configure-first');
      const manager = hotel.client();
      await manager.login('gus.palmer@example.com');
      assert.equal((await manager.get('/admin/integrations')).status, 403);
      assert.equal((await manager.get('/admin/payments')).status, 403);
    } finally { await hotel.stop(); }
  });
});
