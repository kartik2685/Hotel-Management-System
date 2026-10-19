'use strict';
/* Guest website, registration cards and Form III, payments and invoices, password reset, reports, migrations. */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startHotel } = require('./helpers');
const billing = require('../server/services/billing');

let hotel;
before(async () => { hotel = await startHotel(); });
after(async () => { await hotel.stop(); });

const siteToken = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const setSetting = (key, value) => {
  hotel.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  require('../server/services/settings').reset();
};

// Demo bookings run to late October, so November dates have every room free.
async function bookOnline(c, { plan = 'BAR', type = 'DK', arrival = '2026-11-02', departure = '2026-11-05', email = 'online.guest@example.com', extra = {} } = {}) {
  const query = new URLSearchParams({ arrival, departure, adults: '2', children: '0', type, plan });
  const page = await c.get(`/hotel/book/details?${query}`);
  assert.equal(page.status, 200);
  return c.request('POST', '/hotel/book', {
    form: { _csrf: siteToken(page.text), arrival, departure, adults: '2', children: '0', type, plan, first: 'Riya', last: 'Banerjee', email, phone: '+91 98300 11111', nationality: 'IN', terms: 'on', ...extra },
  });
}

describe('guest website', () => {
  test('home page lists the rooms with prices', async () => {
    const r = await hotel.client().get('/hotel');
    assert.equal(r.status, 200);
    for (const name of ['Classic Queen', 'Deluxe King', 'Harlow Suite']) assert.match(r.text, new RegExp(name));
    assert.match(r.text, /From<strong>\$193<\/strong>/); // Advance purchase: $219 − 12%
  });

  test('the header leads staff and the owner to the sign-in page', async () => {
    const guest = hotel.client();
    const home = await guest.get('/hotel');
    assert.match(home.text, /<a class="button button--secondary button--sm site-login" href="\/login" title="Staff and admin sign-in"><svg[^>]*>.*?<\/svg><span class="site-login__text">Staff login<\/span><\/a>/);
    const login = await guest.get('/login');
    assert.equal(login.status, 200);
    assert.match(login.text, /Owner, admin or staff: everyone signs in here with their own email\./);
  });

  test('search shows real availability', async () => {
    const r = await hotel.client().get('/hotel/book?arrival=2026-09-24&departure=2026-09-26&adults=2');
    assert.equal(r.status, 200);
    const suite = r.text.slice(r.text.indexOf('Harlow Suite</h2>'), r.text.indexOf('Harlow Suite</h2>') + 1200);
    assert.match(suite, /Fully booked/); // Marcus Ellery is in the only suite
  });

  test('a guest can book online; staff see it straight away', async () => {
    const c = hotel.client();
    const r = await bookOnline(c);
    assert.equal(r.status, 303);
    const location = r.headers.get('location');
    assert.match(location, /^\/hotel\/booking\/HLW-\d+\?t=[\w-]{32}&new=1$/);
    const conf = location.match(/HLW-\d+/)[0];
    const row = hotel.db.get('SELECT r.*, s.name AS source FROM reservations r JOIN sources s ON s.id = r.source_id WHERE confirmation = ?', conf);
    assert.equal(row.status, 'confirmed');
    assert.equal(row.booked_online, 1);
    assert.equal(row.source, 'Website');
    assert.ok(row.room_id, 'a room was assigned');
    assert.equal(row.total_cents, 91290); // 3 × $259 + 17.49%
    const confirmation = await c.get(location);
    assert.equal(confirmation.status, 200);
    assert.match(confirmation.text, /Your booking is confirmed/);
    assert.ok(hotel.db.get("SELECT 1 FROM outbox WHERE subject LIKE ? AND to_address = 'online.guest@example.com'", `%${conf}%`), 'confirmation email written');
    const staff = hotel.client();
    await staff.login();
    assert.ok((await staff.get('/reservations')).text.includes(conf));
    assert.match((await staff.get('/dashboard')).text, new RegExp(`New website booking ${conf}`));
  });

  test('booking links need the signed token; lookup needs the right email', async () => {
    const c = hotel.client();
    const r = await bookOnline(c, { email: 'token.check@example.com', arrival: '2026-11-06', departure: '2026-11-07' });
    const conf = r.headers.get('location').match(/HLW-\d+/)[0];
    assert.equal((await c.get(`/hotel/booking/${conf}`)).status, 404);
    assert.equal((await c.get(`/hotel/booking/${conf}?t=${'x'.repeat(32)}`)).status, 404);
    const page = await c.get('/hotel/manage');
    let found = await c.request('POST', '/hotel/manage', { form: { _csrf: siteToken(page.text), confirmation: conf, email: 'someone.else@example.com' } });
    assert.equal(found.status, 404);
    found = await c.request('POST', '/hotel/manage', { form: { _csrf: siteToken(page.text), confirmation: conf.toLowerCase(), email: 'TOKEN.CHECK@example.com' } });
    assert.equal(found.status, 303);
    assert.match(found.headers.get('location'), new RegExp(`/hotel/booking/${conf}\\?t=`));
  });

  test('flexible rates can be cancelled online, non-refundable ones cannot', async () => {
    const c = hotel.client();
    let r = await bookOnline(c, { email: 'flex@example.com', arrival: '2026-11-10', departure: '2026-11-12' });
    let link = r.headers.get('location').replace('&new=1', '');
    let page = await c.get(link);
    assert.match(page.text, /Cancel this booking/);
    const conf = link.match(/HLW-\d+/)[0];
    const t = new URL(link, hotel.base).searchParams.get('t');
    r = await c.request('POST', `/hotel/booking/${conf}/cancel`, { form: { _csrf: siteToken(page.text), t, sure: 'on' } });
    assert.equal(r.status, 303);
    assert.equal(hotel.db.get('SELECT status FROM reservations WHERE confirmation = ?', conf).status, 'cancelled');
    r = await bookOnline(c, { email: 'strict@example.com', plan: 'ADV', arrival: '2026-11-10', departure: '2026-11-12' });
    link = r.headers.get('location').replace('&new=1', '');
    page = await c.get(link);
    assert.doesNotMatch(page.text, /Cancel this booking/);
    assert.match(page.text, /Non-refundable/);
    const strict = link.match(/HLW-\d+/)[0];
    const token = siteToken((await c.get('/hotel/manage')).text); // same visitor token on every page
    r = await c.request('POST', `/hotel/booking/${strict}/cancel`, { form: { _csrf: token, t: new URL(link, hotel.base).searchParams.get('t') } });
    assert.equal(r.status, 422);
  });

  test('forms are protected: token, required fields, spam trap', async () => {
    const c = hotel.client();
    await c.get('/hotel');
    let r = await c.request('POST', '/hotel/book', { form: { _csrf: 'forged', arrival: '2026-10-01', departure: '2026-10-02', type: 'DK', plan: 'BAR' } });
    assert.equal(r.status, 403);
    const before = hotel.db.get('SELECT COUNT(*) AS n FROM reservations').n;
    r = await bookOnline(c, { email: 'bot@example.com', extra: { website: 'http://spam.example' } });
    assert.equal(r.headers.get('location'), '/hotel');
    r = await bookOnline(c, { email: 'nophone@example.com', extra: { phone: '', terms: '' } });
    assert.equal(r.status, 422);
    assert.match(r.text, /Phone is required/);
    assert.match(r.text, /accept the hotel policies/);
    assert.equal(hotel.db.get('SELECT COUNT(*) AS n FROM reservations').n, before);
  });

  test('a switched-off website is hidden from guests but staff can preview it', async () => {
    setSetting('site_enabled', false);
    assert.equal((await hotel.client().get('/hotel')).status, 404);
    const staff = hotel.client();
    await staff.login();
    const r = await staff.get('/hotel');
    assert.equal(r.status, 200);
    assert.match(r.text, /only signed-in staff can see this preview/);
    setSetting('site_enabled', true);
  });
});

describe('registration card and Form III', () => {
  test('check-in waits for a complete GRC when the hotel requires it', async () => {
    setSetting('require_grc', true);
    const c = hotel.client();
    await c.login();
    await c.get('/dashboard');
    let r = await c.api('/api/reservations/HLW-40890/check-in'); // Mateo Castellanos, room 103 clean
    assert.equal(r.status, 422);
    assert.match(r.body.error, /registration card/);
    await c.get('/reservations/HLW-40890');
    r = await c.post('/reservations/HLW-40890/grc', { nationality: 'IN', address: '12 Park Street, Kolkata', id_type: 'Aadhaar card', id_number: '1234', purpose: 'Business' });
    assert.equal(r.status, 422);
    assert.match(r.text, /Aadhaar number has 12 digits/);
    r = await c.post('/reservations/HLW-40890/grc', { nationality: 'IN', address: '12 Park Street, Kolkata', id_type: 'Aadhaar card', id_number: '1234 5678 9012', purpose: 'Business' });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /ok=grc#grc/);
    await c.get('/dashboard');
    r = await c.api('/api/reservations/HLW-40890/check-in');
    assert.equal(r.status, 200);
    const print = await c.get('/reservations/HLW-40890/grc');
    assert.match(print.text, /Guest registration card/);
    assert.match(print.text, /1234 5678 9012/);
    setSetting('require_grc', false);
  });

  test('foreign guests in an Indian hotel get Form III deadlines', async () => {
    setSetting('country', 'IN');
    const c = hotel.client();
    await c.login();
    await c.get('/dashboard');
    const conf = 'HLW-41724'; // Delphine Beaumont (Canada), room 309 clean
    const r = await c.api(`/api/reservations/${conf}/check-in`);
    assert.equal(r.status, 200);
    assert.ok(hotel.db.get("SELECT 1 FROM notifications WHERE title = 'Form III due for Delphine Beaumont'"));
    let page = await c.get(`/reservations/${conf}`);
    assert.match(page.text, /Form III \(foreign guest\)/);
    assert.match(page.text, /Due by/);
    let audit = await c.get('/admin/night-audit');
    assert.match(audit.text, /Form III reports to file/);
    await c.post(`/reservations/${conf}/form3`, { report: 'arrival', reference: 'FRRO-ACK-77812' });
    page = await c.get(`/reservations/${conf}`);
    assert.match(page.text, /acknowledgement <strong>FRRO-ACK-77812<\/strong>/);
    audit = await c.get('/admin/night-audit');
    assert.doesNotMatch(audit.text, /Delphine Beaumont<\/a> · Canada/);
    setSetting('country', 'US');
  });
});

describe('payments and invoices', () => {
  test('payments are a ledger; refunds are for managers', async () => {
    const desk = hotel.client();
    await desk.login('rosa.soto@example.com');
    await desk.get('/reservations/HLW-42121'); // Marcus Ellery, in house
    const conf = 'HLW-42121';
    hotel.db.run('UPDATE reservations SET paid_cents = 0 WHERE confirmation = ?', conf);
    let r = await desk.post(`/reservations/${conf}/payment`, { amount: '500', method: 'UPI', reference: 'UPI-1234' });
    assert.equal(r.status, 303);
    const id = hotel.db.get('SELECT id FROM reservations WHERE confirmation = ?', conf).id;
    assert.equal(hotel.db.get('SELECT paid_cents FROM reservations WHERE id = ?', id).paid_cents, 50000);
    assert.ok(hotel.db.get("SELECT 1 FROM payments WHERE reservation_id = ? AND method = 'UPI' AND reference = 'UPI-1234'", id));
    r = await desk.post(`/reservations/${conf}/payment`, { amount: '999999', method: 'Card' });
    assert.equal(r.status, 422);
    r = await desk.post(`/reservations/${conf}/refund`, { refund_amount: '100', refund_method: 'UPI', refund_reason: 'Minibar error' });
    assert.equal(r.status, 403);
    const manager = hotel.client();
    await manager.login('gus.palmer@example.com');
    await manager.get(`/reservations/${conf}`);
    r = await manager.post(`/reservations/${conf}/refund`, { refund_amount: '100', refund_method: 'UPI', refund_reason: 'Minibar error' });
    assert.equal(r.status, 303);
    assert.equal(hotel.db.get('SELECT paid_cents FROM reservations WHERE id = ?', id).paid_cents, 40000);
  });

  test('GST invoices: numbering, CGST/SGST split, IGST, re-issue', async () => {
    setSetting('tax_mode', 'gst_india');
    setSetting('country', 'IN');
    setSetting('invoice_prefix', 'HLW');
    const c = hotel.client();
    await c.login();
    const conf = 'HLW-41671'; // Rafael Ferreira, in house
    await c.get(`/reservations/${conf}`);
    let r = await c.post(`/reservations/${conf}/invoice`, { bill_to: 'Ferreira Studio', gstin: 'BAD-GSTIN' });
    assert.equal(r.status, 422);
    assert.match(r.text, /A GSTIN has 15 characters/);
    r = await c.post(`/reservations/${conf}/invoice`, { bill_to: 'Ferreira Studio', gstin: '19ABCDE1234F1Z5' });
    assert.equal(r.status, 303);
    const first = billing.invoice(hotel.db, Number(r.headers.get('location').split('/').pop()));
    assert.equal(first.number, 'HLW/26-27/0001');
    assert.equal(first.data.cgst + first.data.sgst, first.data.tax);
    assert.ok(Math.abs(first.data.cgst - first.data.sgst) <= 1);
    const page = await c.get(`/invoices/${first.id}`);
    assert.match(page.text, /Tax invoice/);
    assert.match(page.text, /CGST/);
    assert.match(page.text, /19ABCDE1234F1Z5/);
    await c.get(`/reservations/${conf}`);
    r = await c.post(`/reservations/${conf}/invoice`, { bill_to: 'Ferreira Studio', gstin: '27ABCDE1234F1Z5', interstate: 'on' });
    const second = billing.invoice(hotel.db, Number(r.headers.get('location').split('/').pop()));
    assert.equal(second.number, 'HLW/26-27/0002');
    assert.equal(second.data.igst, second.data.tax);
    assert.equal(billing.invoice(hotel.db, first.id).status, 'cancelled');
    const csv = await c.get('/admin/invoices.csv');
    assert.match(csv.text, /^\uFEFF?Number,Issued,Status/); // fetch's text() drops the byte-order mark
    setSetting('tax_mode', 'flat');
    setSetting('country', 'US');
  });

  test('a company GSTIN on the guest profile is filled in on the invoice form', async () => {
    const c = hotel.client();
    await c.login();
    const g = hotel.db.get("SELECT g.* FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.confirmation = 'HLW-41671'");
    const form = { first: g.first_name, last: g.last_name, email: g.email || '', phone: g.phone || '', city: g.city || '', company: 'Ferreira Studio' };
    assert.match((await c.get(`/guests/${g.id}/edit`)).text, /Company GSTIN/);
    let r = await c.post(`/guests/${g.id}/edit`, { ...form, gstin: '19ABC' });
    assert.equal(r.status, 422);
    assert.match(r.text, /A GSTIN has 15 characters/);
    r = await c.post(`/guests/${g.id}/edit`, { ...form, gstin: '19abcde1234f1z5' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `/guests?guest=${g.id}&saved=1`); // the guest list then says “Profile saved.”
    assert.equal(hotel.db.get('SELECT gstin FROM guests WHERE id = ?', g.id).gstin, '19ABCDE1234F1Z5');
    setSetting('tax_mode', 'gst_india'); // the GSTIN field is on GST invoices
    const page = await c.get('/reservations/HLW-41671');
    setSetting('tax_mode', 'flat');
    assert.match(page.text, /name="gstin" value="19ABCDE1234F1Z5"/);
    assert.match(page.text, /name="bill_to" value="Ferreira Studio"/);
  });

  test('amounts in words follow Indian and international numbering', () => {
    assert.equal(billing.indianWords(1234567), 'Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven');
    assert.equal(billing.amountInWords(130766, { currency_code: 'INR' }), 'Rupees One Thousand Three Hundred Seven and Sixty-Six Paise Only');
    assert.equal(billing.amountInWords(100000, { currency_code: 'USD' }), 'US Dollars One Thousand and 00/100 Only');
    assert.equal(billing.fiscalYear('2027-03-31', true), '26-27');
    assert.equal(billing.fiscalYear('2027-04-01', true), '27-28');
  });
});

describe('password reset and reports', () => {
  test('a reset link from the email sets a new password once', async () => {
    const c = hotel.client();
    let page = await c.get('/login');
    let r = await c.request('POST', '/password/forgot', { form: { _csrf: page.text.match(/name="_csrf" value="([^"]+)"/)[1], email: 'jonas.reyes@example.com' } });
    assert.equal(r.status, 200);
    assert.match(r.text, /a link to choose a new password is on its way/);
    const mail = hotel.db.get("SELECT body FROM outbox WHERE to_address = 'jonas.reyes@example.com' ORDER BY id DESC");
    const link = mail.body.match(/(\/password\/reset\?token=[\w-]+)/)[1];
    page = await c.get(link);
    assert.equal(page.status, 200);
    r = await c.request('POST', '/password/reset', { form: { token: new URL(link, hotel.base).searchParams.get('token'), password: 'brand-new-pass', confirm: 'brand-new-pass' } });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/login?reset=done');
    assert.equal((await c.get(link)).status, 410, 'the link works only once');
    const fresh = hotel.client();
    assert.equal((await fresh.login('jonas.reyes@example.com', 'brand-new-pass')).status, 303);
    // Unknown emails get the same answer and no email.
    const before = hotel.db.get('SELECT COUNT(*) AS n FROM outbox').n;
    page = await c.get('/login');
    r = await c.request('POST', '/password/forgot', { form: { _csrf: page.text.match(/name="_csrf" value="([^"]+)"/)[1], email: 'nobody@example.com' } });
    assert.match(r.text, /a link to choose a new password is on its way/);
    assert.equal(hotel.db.get('SELECT COUNT(*) AS n FROM outbox').n, before);
  });

  test('reports and CSV exports', async () => {
    const c = hotel.client();
    await c.login();
    const page = await c.get('/admin/reports?from=2026-09-13&to=2026-09-24');
    assert.equal(page.status, 200);
    assert.match(page.text, /Bookings by source/);
    const csv = await c.get('/admin/reports.csv?from=2026-09-20&to=2026-09-24');
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const lines = csv.text.replace(/^\uFEFF/, '').split('\r\n');
    assert.equal(lines[0], 'Date,Rooms sold,Rooms,Occupancy %,Room revenue,ADR,RevPAR,Closed');
    assert.equal(lines.length, 6);
    assert.match(lines[5], /^2026-09-24,42,48,87\.5,10441\.20,248\.60,217\.53,no$/);
  });
});

describe('database upgrades', () => {
  test('a version 1 database is upgraded in place', () => {
    const { DatabaseSync } = require('node:sqlite');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-mig-'));
    const file = path.join(dir, 'old.db');
    const raw = new DatabaseSync(file);
    raw.exec(fs.readFileSync(path.join(__dirname, '..', 'server', 'db', 'schema.sql'), 'utf8'));
    raw.exec("INSERT INTO guests (first_name, last_name, created_at) VALUES ('Old', 'Guest', '2026-01-01 10:00')");
    raw.close();
    const db = require('../server/db').open(file);
    assert.equal(db.get('PRAGMA user_version').user_version, 5);
    assert.equal(db.get("SELECT nationality FROM guests WHERE last_name = 'Guest'").nationality, null);
    assert.ok(db.get("SELECT name FROM sqlite_master WHERE name = 'invoices'"));
    // links made before version 3 read as sign-in page resets
    assert.equal(db.all('PRAGMA table_info(password_resets)').find((c) => c.name === 'kind').dflt_value, "'reset'");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
