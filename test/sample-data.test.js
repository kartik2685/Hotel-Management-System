'use strict';
/* The sample hotel (db/sample.js): added from the admin panel to an empty hotel, made through the normal
   services, all in rupees, and taken out again without leaving anything behind. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const f = require('../server/lib/format');
const settingsService = require('../server/services/settings');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];
const emptyHotel = (db) => seed.createEmptyHotel(db, { email: OWNER[0], name: 'Hotel Owner', password: OWNER[1] });

describe('sample data', () => {
  let hotel;
  let owner;
  let password;
  const count = (sql, ...args) => hotel.db.get(sql, ...args).n;

  before(async () => {
    hotel = await startHotel({ load: emptyHotel });
    owner = hotel.client();
    await owner.login(...OWNER);
  });
  after(() => hotel.stop());

  test('an empty hotel offers it to the admin, who adds it with one click', async () => {
    const page = await owner.get('/admin');
    assert.match(page.text, /Add sample data/);
    const r = await owner.post('/admin/sample-data');
    assert.equal(r.status, 200);
    assert.match(r.text, /Sample data added\./);
    password = r.text.match(/the password <code class="nowrap">([^<]+)<\/code>/)[1];
    assert.match(password, /^Staff-[A-Za-z0-9]{4}-\d{4}$/);
    assert.match(r.text, /Remove sample data/);
  });

  test('50 guests, 25 rooms in 7 types, and staff in every role', () => {
    assert.equal(count('SELECT COUNT(*) AS n FROM guests'), 50);
    assert.equal(count('SELECT COUNT(*) AS n FROM rooms WHERE active = 1'), 25);
    assert.equal(count('SELECT COUNT(*) AS n FROM room_types WHERE active = 1'), 7);
    assert.equal(count('SELECT COUNT(*) AS n FROM room_types rt WHERE NOT EXISTS (SELECT 1 FROM rooms r WHERE r.room_type_id = rt.id)'), 0);
    const roles = hotel.db.all('SELECT role, COUNT(*) AS n FROM users GROUP BY role').map((r) => r.role).sort();
    assert.deepEqual(roles, ['admin', 'frontdesk', 'housekeeping', 'manager']);
    assert.equal(count('SELECT COUNT(*) AS n FROM users'), 20); // 18 sample staff, a new hire still invited, and the owner
    assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE active = 0'), 1); // one has left the hotel
    assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE must_change_password = 1'), 0);
  });

  test('bookings in every state, from every kind of source', () => {
    const states = hotel.db.all('SELECT DISTINCT status FROM reservations').map((r) => r.status).sort();
    assert.deepEqual(states, ['cancelled', 'checked_in', 'checked_out', 'confirmed', 'no_show', 'tentative']);
    const kinds = hotel.db.all('SELECT DISTINCT s.kind FROM reservations r JOIN sources s ON s.id = r.source_id').map((r) => r.kind).sort();
    assert.deepEqual(kinds, ['corporate', 'direct', 'ota', 'walk_in']);
    assert.ok(count('SELECT COUNT(*) AS n FROM reservations WHERE booked_online = 1') >= 5);
    assert.ok(count('SELECT COUNT(*) AS n FROM reservations') > 80);
    // made by the people on duty, not by "System"
    assert.equal(count('SELECT COUNT(*) AS n FROM reservations WHERE created_by IS NULL AND booked_online = 0'), 0);
    // nobody is in two rooms, and no room has two guests on one night
    assert.equal(count(`SELECT COUNT(*) AS n FROM reservations a JOIN reservations b ON a.room_id = b.room_id AND a.id < b.id
      WHERE a.status IN ('confirmed', 'tentative', 'checked_in', 'checked_out') AND b.status IN ('confirmed', 'tentative', 'checked_in', 'checked_out')
        AND a.arrival < b.departure AND b.arrival < a.departure`), 0);
  });

  test('charges during the stay: room service, laundry, minibar, spa and a taxi, posted by the desk on duty', () => {
    const kinds = hotel.db.all('SELECT DISTINCT kind FROM folio_charges ORDER BY kind').map((r) => r.kind);
    assert.deepEqual(kinds, ['fnb', 'laundry', 'minibar', 'spa', 'transport']);
    assert.equal(count('SELECT COUNT(*) AS n FROM reservations WHERE total_cents <> room_total_cents + tax_cents + extras_cents + charges_cents'), 0);
    const inv = hotel.db.all("SELECT data FROM invoices WHERE status = 'issued'").map((r) => JSON.parse(r.data)).find((d) => d.taxes.length > 1);
    assert.ok(inv, 'an invoice with GST at more than one rate');
    assert.ok(inv.lines.some((l) => l.sac === '996331'));
  });

  test('registration cards, Form III, payments, refunds and GST invoices are all there', () => {
    assert.equal(count("SELECT COUNT(*) AS n FROM reservations WHERE status IN ('checked_in', 'checked_out') AND grc_at IS NULL"), 0);
    assert.ok(count("SELECT COUNT(*) AS n FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE g.nationality NOT IN ('IN', 'NP', 'BT') AND r.form3_arrival_ref IS NOT NULL") >= 5);
    assert.ok(count("SELECT COUNT(*) AS n FROM guests WHERE nationality IN ('NP', 'BT')") === 2); // exempt from Form III
    const methods = hotel.db.all('SELECT DISTINCT method FROM payments').map((r) => r.method).sort();
    assert.deepEqual(methods, ['Bank transfer', 'Card', 'Cash', 'UPI']);
    assert.ok(count('SELECT COUNT(*) AS n FROM payments WHERE amount_cents < 0') >= 2);
    assert.equal(count(`SELECT COUNT(*) AS n FROM reservations r WHERE r.status = 'checked_out'
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.reservation_id = r.id AND i.status = 'issued')`), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM invoices WHERE status = 'cancelled'"), 1);
    assert.equal(count("SELECT COUNT(*) AS n FROM reservations WHERE status = 'checked_out' AND paid_cents <> total_cents"), 0);
    const b2b = hotel.db.all("SELECT data FROM invoices WHERE status = 'issued'").map((r) => JSON.parse(r.data)).filter((d) => d.billTo.gstin);
    assert.ok(b2b.length >= 10);
    assert.ok(b2b.every((d) => d.cgst + d.sgst === d.tax && d.igst === 0)); // hotel stays are taxed where the hotel is
  });

  test('four weeks of night audits, outlet revenue, housekeeping and handover notes', () => {
    const bd = settingsService.businessDate(hotel.db);
    for (let i = 1; i <= 27; i++) assert.ok(hotel.db.get('SELECT 1 FROM daily_stats WHERE date = ?', f.addDays(bd, -i)), `day -${i} closed`);
    assert.equal(count("SELECT COUNT(*) AS n FROM revenue WHERE outlet IN ('fnb', 'spa') AND amount_cents > 0"), 54);
    assert.ok(count('SELECT COUNT(*) AS n FROM housekeeping_tasks WHERE task_date = ?', bd) >= 10);
    assert.ok(count('SELECT COUNT(*) AS n FROM housekeeping_tasks WHERE done_at IS NOT NULL') > 100);
    assert.ok(count('SELECT COUNT(*) AS n FROM handover_notes') >= 20);
    assert.ok(count('SELECT COUNT(*) AS n FROM room_blocks') >= 3);
    assert.ok(count('SELECT COUNT(DISTINCT user_id) AS n FROM activity_log WHERE user_id IS NOT NULL') >= 15);
    assert.equal(count("SELECT COUNT(*) AS n FROM outbox WHERE status <> 'logged'"), 0); // never sent: the addresses are made up
  });

  test('money is in rupees everywhere', async () => {
    const s = settingsService.all(hotel.db);
    assert.equal(s.currency_code, 'INR');
    assert.equal(s.currency_symbol, '₹');
    assert.equal(s.tax_mode, 'gst_india');
    for (const url of ['/dashboard', '/reservations', '/rooms', '/admin/reports', '/admin/invoices', '/admin/rates', '/hotel', '/hotel/book']) {
      const r = await owner.get(url);
      assert.equal(r.status, 200, url);
      assert.match(r.text, /₹\d/, url);
      assert.doesNotMatch(r.text.replace(/<script[\s\S]*?<\/script>/g, ''), /\$\s?\d/, url);
    }
    assert.match((await owner.get('/housekeeping')).text, /Floor 5<\/h2>\s*<p class="[^"]*">Pooja Sharma/);
  });

  test('the sign-in page shows this hotel and nothing of the demo hotel', async () => {
    const page = (await hotel.client().get('/login')).text;
    assert.match(page, /The Hooghly Residency · Front office/);
    assert.match(page, /id="login-email"[^>]*placeholder="name@hooghlyresidency\.example\.com"/);
    assert.match(page, /id="reset-email"[^>]*placeholder="Your work email"/); // the hotel's domain is too long for that box
    assert.doesNotMatch(page, /harlow|elena|marsh\b/i);
  });

  test('a new hire’s invite is still open: Staff accounts shows it and the emailed link works', async () => {
    const list = (await owner.get('/admin/staff')).text;
    assert.match(list.match(/<tr[^>]*><td><strong>Nisha Roy<\/strong>[\s\S]*?<\/tr>/)[0], /Invite sent/);
    const mail = hotel.db.get("SELECT subject, body FROM outbox WHERE to_address = 'nisha.roy@hooghlyresidency.example.com'");
    assert.equal(mail.subject, 'Your Frontdesk account at The Hooghly Residency');
    assert.match(mail.body, /Arjun Mehta has made you a Frontdesk account/);
    const page = await hotel.client().get(mail.body.match(/\/welcome\?token=[\w-]+/)[0]);
    assert.equal(page.status, 200);
    assert.match(page.text, /Welcome to The Hooghly Residency/);
  });

  test('sample staff sign in with the password shown once', async () => {
    const email = hotel.db.get("SELECT email FROM users WHERE title = 'Reservations executive'").email;
    const c = hotel.client();
    const r = await c.login(email, password);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/dashboard');
    const admin = await c.get('/admin');
    assert.equal(admin.status, 403); // front desk: no admin panel
    assert.match(admin.text, /does not have access/);
  });

  test('a manager can’t add or remove it, and it can’t be added twice', async () => {
    const email = hotel.db.get("SELECT email FROM users WHERE title = 'Front office manager'").email;
    const manager = hotel.client();
    await manager.login(email, password);
    await manager.get('/admin');
    assert.equal((await manager.post('/admin/sample-data')).status, 403);
    assert.equal((await manager.post('/admin/sample-data/remove', { sure: 'on' })).status, 403);
    const again = await owner.post('/admin/sample-data');
    assert.equal(again.status, 422);
    assert.match(again.text, /already in this hotel/);
  });

  test('removing it leaves the empty hotel as it was', async () => {
    // The owner tried things out first: an invoice for a guest in house, and a day closed by hand.
    const conf = hotel.db.get("SELECT confirmation FROM reservations WHERE status = 'checked_in' ORDER BY id LIMIT 1").confirmation;
    await owner.get(`/reservations/${conf}`);
    assert.equal((await owner.post(`/reservations/${conf}/invoice`, { bill_to: 'Test' })).status, 303);
    const bd = settingsService.businessDate(hotel.db);
    hotel.db.run('INSERT INTO daily_stats (date, rooms_available, rooms_sold, room_revenue_cents, adr_cents, revpar_cents) VALUES (?, 25, 16, 1, 1, 1)', bd);
    await owner.get('/admin');
    const refused = await owner.post('/admin/sample-data/remove');
    assert.equal(refused.status, 422);
    const r = await owner.post('/admin/sample-data/remove', { sure: 'on' });
    assert.equal(r.status, 303);
    for (const table of ['guests', 'reservations', 'payments', 'invoices', 'rooms', 'room_types', 'extras', 'housekeeping_tasks', 'handover_notes', 'daily_stats', 'revenue', 'outbox', 'password_resets', 'folio_charges', 'rate_seasons', 'booking_groups']) {
      assert.equal(count(`SELECT COUNT(*) AS n FROM ${table}`), 0, table);
    }
    assert.equal(count('SELECT COUNT(*) AS n FROM users'), 1);
    assert.equal(count('SELECT COUNT(*) AS n FROM sources'), 3); // the empty hotel's own Walk-in, Phone and Website
    assert.equal(count('SELECT COUNT(*) AS n FROM rate_plans'), 1);
    const s = settingsService.all(hotel.db);
    assert.equal(s.hotel_name, 'My Hotel');
    assert.equal(s.site_enabled, false);
    assert.equal(s.sample_data, undefined);
    assert.equal(s.invoice_counters, undefined);
    const page = await owner.get('/admin?ok=sample-removed');
    assert.match(page.text, /The sample data has been removed\./);
    assert.match(page.text, /Add sample data/);
    // no hotel email yet, so the sign-in page asks in plain words
    assert.equal((await hotel.client().get('/login')).text.match(/placeholder="Your work email"/g).length, 2);
  });
});

describe('sample data next to real data', () => {
  let hotel;
  before(async () => { hotel = await startHotel(); });
  after(() => hotel.stop());

  test('a hotel with guests of its own is never mixed with the sample', async () => {
    const c = hotel.client();
    await c.login();
    assert.doesNotMatch((await c.get('/admin')).text, /Add sample data/);
    const r = await c.post('/admin/sample-data');
    assert.equal(r.status, 422);
    assert.match(r.text, /already has guests or bookings/);
  });
});
