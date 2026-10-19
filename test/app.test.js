'use strict';
/* End-to-end tests: every request goes through the real app and a real SQLite database. */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startHotel } = require('./helpers');

let hotel;
before(async () => { hotel = await startHotel(); });
after(async () => { await hotel.stop(); });

describe('signing in', () => {
  test('pages need a session', async () => {
    const c = hotel.client();
    const r = await c.get('/dashboard');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login?next=%2Fdashboard');
    const api = await c.api('/api/notifications/read');
    assert.equal(api.status, 401);
  });

  test('right password opens the dashboard, wrong password gets one generic message', async () => {
    const c = hotel.client();
    const bad = await c.login('elena.marsh@example.com', 'wrong-password');
    assert.equal(bad.status, 401);
    assert.match(bad.text, /That email and password don’t match/);
    const unknown = await c.login('nobody@example.com', 'harlow-demo');
    assert.equal(unknown.status, 401);
    assert.match(unknown.text, /That email and password don’t match/);
    const ok = await c.login();
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/dashboard');
    const page = await c.get('/dashboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /Good morning, Elena/);
  });

  test('the demo sign-in page keeps the original’s sample address', async () => {
    const page = (await hotel.client().get('/login')).text;
    assert.equal(page.match(/placeholder="elena\.marsh@example\.com"/g).length, 2);
  });

  test('the login form needs its own CSRF token', async () => {
    const c = hotel.client();
    await c.get('/login');
    const r = await c.request('POST', '/login', { form: { _csrf: 'forged', email: 'elena.marsh@example.com', password: 'harlow-demo' } });
    assert.equal(r.status, 403);
  });

  test('five wrong passwords lock the account for a while', async () => {
    const c = hotel.client();
    for (let i = 0; i < 5; i++) await c.login('dev.raman@example.com', `wrong-${i}-pass`);
    const locked = await c.login('dev.raman@example.com', 'harlow-demo');
    assert.equal(locked.status, 429);
    assert.match(locked.text, /Too many attempts/);
  });

  test('a "next" address may only point inside the app', async () => {
    const c = hotel.client();
    const page = await c.get('/login?next=//evil.example.com');
    assert.doesNotMatch(page.text, /evil\.example\.com/);
    const r = await c.login('jonas.reyes@example.com', 'harlow-demo', { next: 'https://evil.example.com/' });
    assert.equal(r.headers.get('location'), '/dashboard');
  });

  test('signing out needs the signed link and ends the session', async () => {
    const c = hotel.client();
    await c.login();
    const page = await c.get('/dashboard');
    const link = page.text.match(/href="(\/logout\?t=[^"]+)"/)[1];
    const forged = await c.get('/logout?t=forged');
    assert.equal(forged.headers.get('location'), '/dashboard');
    const out = await c.get(link);
    assert.equal(out.headers.get('location'), '/login');
    assert.equal((await c.get('/dashboard')).status, 302);
  });
});

describe('security', () => {
  test('styles and scripts are checked on every visit, so an update shows at once', async () => {
    const c = hotel.client();
    for (const file of ['/assets/css/components.css', '/assets/js/core.js']) {
      const r = await c.get(file);
      assert.equal(r.status, 200, file);
      assert.equal(r.headers.get('cache-control'), 'no-cache', file);
      assert.ok(r.headers.get('etag'), file); // so the check is a quick 304 when nothing changed
    }
    assert.notEqual((await c.get('/assets/img/favicon.svg')).headers.get('cache-control'), 'no-cache'); // images keep their cache
  });

  test('state changes without the CSRF token are refused', async () => {
    const c = hotel.client();
    await c.login();
    const r = await c.request('POST', '/api/rooms/101/status', { json: { status: 'dirty' } });
    assert.equal(r.status, 403);
  });

  test('responses carry security headers', async () => {
    const r = await fetch(hotel.base + '/login');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    const cookie = r.headers.getSetCookie().join(';');
    assert.match(cookie, /HttpOnly/i);
  });

  test('guest input is escaped on every page', async () => {
    const c = hotel.client();
    await c.login();
    await c.get('/reservations');
    const r = await c.api('/reservations', {
      arrival: '2026-09-28', departure: '2026-09-29', type: 'CQ', adults: '1', children: '0', plan: 'BAR',
      first: '<img src=x onerror=alert(1)>', last: 'Tester', email: 'xss@example.com', source: 'Phone',
    });
    assert.equal(r.status, 201);
    const list = await c.get('/reservations');
    assert.doesNotMatch(list.text, /<img src=x/);
    assert.match(list.text, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });
});

describe('roles', () => {
  test('housekeeping sees rooms and tasks only', async () => {
    const c = hotel.client();
    const r = await c.login('marisol.vega@example.com');
    assert.equal(r.headers.get('location'), '/housekeeping');
    assert.equal((await c.get('/dashboard')).status, 403);
    assert.equal((await c.get('/admin')).status, 403);
    assert.equal((await c.get('/rooms')).status, 200);
    const page = await c.get('/housekeeping');
    assert.doesNotMatch(page.text, /href="\/reservations"/);
    const booking = await c.api('/api/reservations/HLW-41459/check-in');
    assert.equal(booking.status, 403);
  });

  test('front desk works bookings but has no admin panel', async () => {
    const c = hotel.client();
    await c.login('rosa.soto@example.com', 'harlow-demo');
    assert.equal((await c.get('/reservations')).status, 200);
    assert.equal((await c.get('/admin')).status, 403);
  });

  test('managers get the admin panel but not settings or staff accounts', async () => {
    const c = hotel.client();
    await c.login('gus.palmer@example.com');
    assert.equal((await c.get('/admin/rooms')).status, 200);
    assert.equal((await c.get('/admin/settings')).status, 403);
    assert.equal((await c.get('/admin/staff')).status, 403);
  });

  test('the sidebar shows the admin panel to managers and admins, and staff accounts to admins only', async () => {
    const link = (href, label) => new RegExp(`<a class="sidenav__link" href="${href}"( aria-current="page")?><svg[^>]*>.*?</svg><span>${label}</span>`);
    const admin = hotel.client();
    await admin.login();
    let page = await admin.get('/dashboard');
    assert.match(page.text, /<p class="sidenav__label">Admin<\/p>/);
    assert.match(page.text, link('/admin', 'Admin panel'));
    assert.match(page.text, link('/admin/staff', 'Staff accounts'));
    page = await admin.get('/admin/staff');
    assert.match(page.text, /<a class="sidenav__link" href="\/admin\/staff" aria-current="page">/); // lit where you are
    assert.doesNotMatch(page.text, /<a class="sidenav__link" href="\/admin" aria-current="page">/);
    page = await admin.get('/admin/rooms');
    assert.match(page.text, /<a class="sidenav__link" href="\/admin" aria-current="page">/);

    const manager = hotel.client();
    await manager.login('gus.palmer@example.com');
    page = await manager.get('/dashboard');
    assert.match(page.text, link('/admin', 'Admin panel'));
    assert.doesNotMatch(page.text, /href="\/admin\/staff"/);

    const desk = hotel.client();
    await desk.login('rosa.soto@example.com');
    page = await desk.get('/dashboard');
    assert.doesNotMatch(page.text, /sidenav__label">Admin</);
    assert.doesNotMatch(page.text, /href="\/admin"/);
  });
});

describe('bookings', () => {
  test('a new booking is priced on the server, gets a free room and shows everywhere', async () => {
    const c = hotel.client();
    await c.login();
    await c.get('/reservations');
    const r = await c.api('/reservations', {
      arrival: '2026-09-24', departure: '2026-09-26', type: 'DK', adults: '2', children: '0', plan: 'BAR',
      first: 'Asha', last: 'Verma', email: 'asha.verma@example.com', phone: '+91 98300 00000', source: 'Phone', total: '1',
    });
    assert.equal(r.status, 201);
    const b = r.body.booking;
    assert.match(b.confirmation, /^HLW-\d+$/);
    assert.equal(b.totalText, '$608.60'); // 2 × $259 + 17.49% room tax, whatever the browser sent
    assert.equal(b.status, 'confirmed');
    const tape = await c.get('/tape-chart');
    assert.ok(tape.text.includes(b.confirmation), 'booking is on the tape chart');
    const page = await c.get(`/reservations/${b.confirmation}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Asha Verma/);
    const guest = hotel.db.get("SELECT * FROM guests WHERE email = 'asha.verma@example.com'");
    assert.equal(guest.phone, '+91 98300 00000');
  });

  test('impossible bookings are refused with the field to fix', async () => {
    const c = hotel.client();
    await c.login();
    await c.get('/reservations');
    const base = { arrival: '2026-09-25', departure: '2026-09-27', type: 'CQ', adults: '1', children: '0', plan: 'BAR', first: 'A', last: 'B', email: 'a@example.com', source: 'Phone' };
    let r = await c.api('/reservations', { ...base, departure: '2026-09-24' });
    assert.equal(r.status, 422);
    assert.equal(r.body.field, 'departure');
    r = await c.api('/reservations', { ...base, adults: '3' });
    assert.equal(r.body.field, 'type');
    r = await c.api('/reservations', { ...base, arrival: '2026-09-01', departure: '2026-09-02' });
    assert.equal(r.body.field, 'arrival');
    r = await c.api('/reservations', { ...base, email: 'not-an-email' });
    assert.equal(r.body.field, 'email');
    // The only Harlow Suite is taken by Marcus Ellery until the 27th.
    r = await c.api('/reservations', { ...base, type: 'HS', adults: '2' });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /No Harlow Suite is free/);
  });

  test('check-in needs a clean room; check-out needs the folio settled', async () => {
    const c = hotel.client();
    await c.login();
    await c.get('/dashboard');
    let r = await c.api('/api/reservations/HLW-41407/check-in'); // Jonah Whitlock, room 209 still dirty
    assert.equal(r.status, 422);
    assert.match(r.body.error, /still being cleaned/);
    r = await c.api('/api/reservations/HLW-41459/check-in'); // Hana Nakamura, room 211 clean
    assert.equal(r.status, 200);
    assert.equal(r.body.booking.status, 'checked-in');
    assert.equal(r.body.time, '10:42');
    r = await c.api('/api/reservations/HLW-41459/check-in');
    assert.equal(r.status, 422);
    const vera = hotel.db.get("SELECT r.confirmation FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE g.first_name = 'Vera' AND g.last_name = 'Yardley'").confirmation;
    r = await c.api(`/api/reservations/${vera}/check-out`);
    assert.equal(r.status, 422);
    assert.match(r.body.error, /\$142\.30 is still open/);
    r = await c.api(`/api/reservations/${vera}/check-out`, { settle: true });
    assert.equal(r.status, 200);
    assert.equal(hotel.db.get("SELECT hk_status FROM rooms WHERE number = '102'").hk_status, 'dirty');
  });

  test('editing a booking re-prices it and checks the room', async () => {
    const c = hotel.client();
    await c.login();
    await c.get('/reservations/HLW-42331');
    const form = {
      arrival: '2026-09-25', departure: '2026-09-28', room_type_id: '1', room: '102', adults: '1', children: '0', rate_plan_id: '1',
      nightly_rate: '200', source_id: '2', eta: '18:00', first: 'Edited', last: 'Guest', email: 'edited@example.com', phone: '', notes: '', requests: '',
    };
    let r = await c.post('/reservations/HLW-42331', { ...form, departure: '2026-09-25' });
    assert.equal(r.status, 422);
    assert.match(r.text, /Departure must be after arrival/);
    r = await c.post('/reservations/HLW-42331', { ...form, room: '412' });
    assert.equal(r.status, 422);
    assert.match(r.text, /is not a Classic Queen/);
    r = await c.post('/reservations/HLW-42331', form);
    assert.equal(r.status, 303);
    const row = hotel.db.get("SELECT * FROM reservations WHERE confirmation = 'HLW-42331'");
    assert.equal(row.room_total_cents, 60000);
    assert.equal(row.tax_cents, Math.round(60000 * 0.1749));
  });

  test('leaving early bills the nights stayed, on the folio and on the invoice', async () => {
    const c = hotel.client();
    await c.login();
    // a prepaid guest due to leave after tomorrow checks out today (Thu 24 Sep)
    const before = hotel.db.get("SELECT * FROM reservations WHERE status = 'checked_in' AND arrival < '2026-09-24' AND departure > '2026-09-25' ORDER BY id LIMIT 1");
    const nights = (Date.parse('2026-09-24') - Date.parse(before.arrival)) / 864e5;
    await c.get(`/reservations/${before.confirmation}`);
    const out = await c.post(`/reservations/${before.confirmation}/action`, { action: 'check-out' });
    assert.equal(out.headers.get('location'), `/reservations/${before.confirmation}?ok=check-out-early`);
    const after = hotel.db.get('SELECT * FROM reservations WHERE id = ?', before.id);
    assert.equal(after.departure, '2026-09-24');
    assert.equal(after.room_total_cents, before.nightly_rate_cents * nights);
    assert.equal(after.total_cents, after.room_total_cents + after.tax_cents + after.extras_cents);
    assert.ok(after.total_cents < before.total_cents);
    assert.equal(after.paid_cents, hotel.db.get('SELECT SUM(amount_cents) AS n FROM payments WHERE reservation_id = ?', before.id).n); // still the ledger's sum
    const page = (await c.get(out.headers.get('location'))).text;
    assert.match(page, /Checked out early: the bill now covers the nights stayed/);
    assert.match(page, new RegExp(`${nights} nights × `));
    assert.match(page, /Overpaid, to refund<\/dt><dd>\$[\d,]+\.\d\d/);
    await c.post(`/reservations/${before.confirmation}/invoice`, { bill_to: 'Guest', gstin: '' });
    const invoice = JSON.parse(hotel.db.get('SELECT data FROM invoices WHERE reservation_id = ? ORDER BY id DESC', before.id).data);
    assert.match(invoice.lines[0].text, new RegExp(`${nights} nights × `));
    assert.equal(invoice.taxable, after.room_total_cents);
    assert.equal(invoice.total, after.total_cents);
  });
});

describe('rooms and housekeeping', () => {
  test('clean / dirty and task ticks are saved', async () => {
    const c = hotel.client();
    await c.login('marisol.vega@example.com');
    await c.get('/rooms');
    let r = await c.api('/api/rooms/101/status', { status: 'dirty' });
    assert.equal(r.status, 200);
    assert.equal(hotel.db.get("SELECT hk_status FROM rooms WHERE number = '101'").hk_status, 'dirty');
    r = await c.api('/api/rooms/204/status', { status: 'clean' }); // out of order
    assert.equal(r.status, 422);
    const task = hotel.db.get("SELECT t.id FROM housekeeping_tasks t JOIN rooms rm ON rm.id = t.room_id WHERE rm.number = '109'");
    await c.get('/housekeeping');
    r = await c.api(`/api/tasks/${task.id}`, { done: true });
    assert.equal(r.status, 200);
    assert.ok(hotel.db.get('SELECT done_at FROM housekeeping_tasks WHERE id = ?', task.id).done_at);
    assert.equal(hotel.db.get("SELECT hk_status FROM rooms WHERE number = '109'").hk_status, 'clean');
  });

  test('notifications can be marked read for one person', async () => {
    const c = hotel.client();
    await c.login('jonas.reyes@example.com');
    let page = await c.get('/dashboard');
    assert.match(page.text, /Notifications, \d+ unread/);
    await c.api('/api/notifications/read');
    page = await c.get('/dashboard');
    assert.match(page.text, /aria-label="Notifications"/);
  });
});

describe('admin panel', () => {
  test('a new staff account must change its password at first sign-in', async () => {
    const admin = hotel.client();
    await admin.login();
    await admin.get('/admin/staff');
    let r = await admin.post('/admin/staff', { name: 'Ravi Kumar', email: 'ravi@example.com', role: 'frontdesk', shift: 'evening', password: 'short', active: 'on' });
    assert.equal(r.status, 422);
    r = await admin.post('/admin/staff', { name: 'Ravi Kumar', email: 'ravi@example.com', role: 'frontdesk', shift: 'evening', password: 'temporary-123', active: 'on' });
    assert.equal(r.status, 303);
    const ravi = hotel.client();
    await ravi.login('ravi@example.com', 'temporary-123');
    let page = await ravi.get('/dashboard');
    assert.equal(page.headers.get('location'), '/account');
    await ravi.get('/account');
    r = await ravi.post('/account', { current: 'temporary-123', password: 'my-own-password', confirm: 'my-own-password' });
    assert.equal(r.status, 200);
    page = await ravi.get('/dashboard');
    assert.equal(page.status, 200);
  });

  test('you cannot lock yourself out', async () => {
    const admin = hotel.client();
    await admin.login();
    await admin.get('/admin/staff');
    const me = hotel.db.get("SELECT id FROM users WHERE email = 'elena.marsh@example.com'").id;
    const r = await admin.post(`/admin/staff/${me}`, { name: 'Elena Marsh', email: 'elena.marsh@example.com', role: 'frontdesk', shift: 'morning', active: 'on' });
    assert.equal(r.status, 422);
    assert.match(r.text, /can’t remove your own admin access/);
  });

  test('rooms, out-of-order periods and settings', async () => {
    const admin = hotel.client();
    await admin.login();
    await admin.get('/admin/rooms');
    let r = await admin.post('/admin/rooms', { number: '501', floor: '5', room_type_id: '3', active: 'on' });
    assert.equal(r.status, 303);
    assert.ok(hotel.db.get("SELECT 1 FROM rooms WHERE number = '501'"));
    r = await admin.post('/admin/rooms', { number: '501', floor: '5', room_type_id: '3', active: 'on' });
    assert.equal(r.status, 422);
    const room = hotel.db.get("SELECT id FROM rooms WHERE number = '501'").id;
    r = await admin.post('/admin/blocks', { room_id: String(room), start_date: '2026-09-25', end_date: '2026-09-27', reason: 'Carpet' });
    assert.equal(r.status, 303);
    await admin.get('/admin/settings');
    r = await admin.post('/admin/settings', {
      hotel_name: 'Hotel Ganga View', hotel_city: 'Kolkata', currency_code: 'INR', currency_symbol: '₹', currency_locale: 'en-IN', tax_mode: 'gst_india', tax_rate: '0', tax_label: 'GST',
      check_in_time: '14:00', check_out_time: '11:00', timezone: 'Asia/Kolkata', business_date_mode: 'fixed', business_date: '2026-09-24', default_room_type: 'DK',
      confirmation_prefix: 'HLW', morning_start: '07:00', morning_end: '15:00', evening_start: '15:00', evening_end: '23:00', night_start: '23:00', night_end: '07:00',
      country: 'IN', hotel_state: 'West Bengal', invoice_prefix: 'GNV',
    });
    assert.equal(r.status, 303);
    const page = await admin.get('/dashboard');
    assert.match(page.text, /Hotel Ganga View/);
    assert.match(page.text, /data-currency="₹"/);
    assert.match(page.text, /Due by 11:00/);
  });

  test('night audit closes the day once nothing is left open', async () => {
    const admin = hotel.client();
    await admin.login();
    await admin.get('/admin/night-audit');
    let r = await admin.post('/admin/night-audit', {});
    assert.equal(r.status, 422);
    assert.match(r.text, /Check out \(or extend\) these guests first/);
    await admin.get('/dashboard');
    for (const row of hotel.db.all("SELECT confirmation FROM reservations WHERE status = 'checked_in' AND departure <= '2026-09-24'")) {
      const out = await admin.api(`/api/reservations/${row.confirmation}/check-out`, { settle: true });
      assert.equal(out.status, 200);
    }
    await admin.get('/admin/night-audit');
    r = await admin.post('/admin/night-audit', {});
    assert.equal(r.status, 422);
    assert.match(r.text, /still expected/);
    r = await admin.post('/admin/night-audit', { no_shows: 'on' });
    assert.equal(r.status, 303);
    const stats = hotel.db.get("SELECT * FROM daily_stats WHERE date = '2026-09-24'");
    assert.ok(stats && stats.rooms_sold > 0);
    assert.equal(JSON.parse(hotel.db.get("SELECT value FROM settings WHERE key = 'business_date'").value), '2026-09-25');
    assert.ok(hotel.db.get("SELECT COUNT(*) AS n FROM housekeeping_tasks WHERE task_date = '2026-09-25'").n > 0);
    const page = await admin.get('/dashboard');
    assert.match(page.text, /Fri 25 Sep/);
  });

  test('when the date follows the calendar, closing says it moves on at midnight', async () => {
    const setSetting = (key, value) => {
      hotel.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
      require('../server/services/settings').reset();
    };
    setSetting('business_date_mode', 'auto'); // the test clock reads Thu 24 Sep
    const admin = hotel.client();
    await admin.login();
    let page = await admin.get('/admin/night-audit');
    assert.match(page.text, /Records today’s figures and creates tomorrow’s housekeeping tasks\. The date moves on by itself at midnight\./);
    const r = await admin.post('/admin/night-audit', { no_shows: 'on' });
    assert.equal(r.headers.get('location'), '/admin/night-audit?ok=closed-auto');
    page = await admin.get(r.headers.get('location'));
    assert.match(page.text, /The business date moves on by itself at midnight\./);
    assert.doesNotMatch(page.text, /The business date has moved on/);
    assert.match((await admin.get('/dashboard')).text, /Thu 24 Sep/);
    setSetting('business_date_mode', 'fixed');
  });
});
