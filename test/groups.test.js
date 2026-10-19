'use strict';
/* Group bookings (services/groups.js): several rooms booked together, each a booking of its own, checked in
   together, paid together and billed on one invoice. The test clock reads Thu 24 Sep 2026. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const sample = require('../server/db/sample');
const website = require('../server/services/website');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];
const STAFF = 'Staff-Test-2026';

describe('group bookings', () => {
  let hotel;
  let desk;
  let groupId;
  const one = (sql, ...args) => hotel.db.get(sql, ...args);
  const all = (sql, ...args) => hotel.db.all(sql, ...args);
  const bar = () => String(one("SELECT id FROM rate_plans WHERE code = 'BAR'").id);
  const setSetting = (key, value) => {
    hotel.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
    require('../server/services/settings').reset();
  };
  const book = async (form) => {
    await desk.get('/groups/new');
    return desk.post('/groups', { contact_name: 'Rohan Mitra', contact_phone: '+91 98300 44556', adults: '2', rate_plan_id: bar(), ...form });
  };

  before(async () => {
    hotel = await startHotel({
      load: async (db) => {
        await seed.createEmptyHotel(db, { email: OWNER[0], name: 'Hotel Owner', password: OWNER[1] });
        await sample.add(db, { password: STAFF });
      },
    });
    desk = hotel.client();
    await desk.login('priya.das@hooghlyresidency.example.com', STAFF);
  });
  after(() => hotel.stop());

  test('the front desk books a group: one booking and one guest per room, names from the rooming list', async () => {
    const notes = one('SELECT COUNT(*) AS n FROM notifications').n;
    const r = await book({ name: 'Mitra–Sen wedding', arrival: '2026-11-16', departure: '2026-11-18', rooms_DLX: '3', rooms_STD: '1', rooming_list: 'Rohan Mitra\nAnanya Sen\n' });
    assert.equal(r.status, 303, r.text.match(/field-error[^>]*>([^<]+)/)?.[1]);
    groupId = Number(r.headers.get('location').match(/\/groups\/(\d+)\?ok=created/)[1]);
    const rows = all(`SELECT r.*, g.first_name, g.last_name, rm.number FROM reservations r JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
                       WHERE r.group_id = ? ORDER BY r.id`, groupId);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((x) => `${x.first_name} ${x.last_name}`), ['Rohan Mitra', 'Ananya Sen', 'Guest 3 · Mitra–Sen wedding', 'Guest 4 · Mitra–Sen wedding']);
    assert.equal(new Set(rows.map((x) => x.guest_id)).size, 4, 'each room its own guest');
    assert.equal(new Set(rows.map((x) => x.number)).size, 4, 'each its own room');
    assert.ok(rows.every((x) => x.status === 'confirmed' && x.adults === 2));
    assert.equal(one('SELECT COUNT(*) AS n FROM notifications').n, notes + 1, 'one notification for the group');
    assert.match(one("SELECT summary FROM activity_log WHERE action = 'group.create' ORDER BY id DESC").summary, /^Booked group GRP-\d+ \(Mitra–Sen wedding\): 4 rooms/);
    const page = (await desk.get(r.headers.get('location'))).text;
    assert.match(page, /Group booked: every room is a booking of its own/);
    assert.match(page, /<h1 class="page-header__title">Mitra–Sen wedding<\/h1>/);
  });

  test('not enough rooms of a type: nothing is booked', async () => {
    const before = one('SELECT COUNT(*) AS n FROM reservations').n;
    const left = website.roomsLeft(hotel.db, one("SELECT id FROM room_types WHERE code = 'DLX'").id, '2026-11-16', '2026-11-18');
    const r = await book({ name: 'Too big', arrival: '2026-11-16', departure: '2026-11-18', rooms_DLX: String(left + 1) });
    assert.equal(r.status, 422);
    assert.match(r.text, new RegExp(`Only ${left} rooms? left for every night\\.`));
    assert.equal(one('SELECT COUNT(*) AS n FROM reservations').n, before);
    assert.equal(one("SELECT COUNT(*) AS n FROM booking_groups WHERE name = 'Too big'").n, 0);
    assert.match((await book({ name: 'No rooms', arrival: '2026-11-16', departure: '2026-11-18' })).text, /Choose how many rooms of which type\./);
  });

  test('a room’s booking page names its group and leaves the invoice to the group', async () => {
    const m = one('SELECT confirmation FROM reservations WHERE group_id = ? ORDER BY id LIMIT 1', groupId);
    const page = (await desk.get(`/reservations/${m.confirmation}`)).text;
    assert.match(page, new RegExp(`group <a href="/groups/${groupId}">GRP-\\d+ Mitra–Sen wedding</a>`));
    assert.match((await desk.get('/groups')).text, /<strong>Mitra–Sen wedding<\/strong>/);
  });

  test('one payment is shared out over the rooms in arrival order, and can’t be more than the group owes', async () => {
    const rows = all('SELECT id, total_cents, paid_cents FROM reservations WHERE group_id = ? ORDER BY arrival, id', groupId);
    const owing = rows.reduce((n, x) => n + x.total_cents - x.paid_cents, 0);
    await desk.get(`/groups/${groupId}`);
    let r = await desk.post(`/groups/${groupId}/payment`, { amount: String((owing + 100) / 100), method: 'Card' });
    assert.equal(r.status, 422);
    assert.match(r.text, /The group owes ₹[\d,]+\.\d\d\./);
    const amount = rows[0].total_cents + 100000; // the first room and ₹1,000 of the second
    r = await desk.post(`/groups/${groupId}/payment`, { amount: String(amount / 100), method: 'Bank transfer', reference: 'NEFT 88231' });
    assert.equal(r.status, 303);
    const after = all('SELECT id, total_cents, paid_cents FROM reservations WHERE group_id = ? ORDER BY arrival, id', groupId);
    assert.deepEqual(after.map((x) => x.paid_cents), [rows[0].total_cents, 100000, 0, 0]);
    assert.deepEqual(all('SELECT reference FROM payments WHERE reservation_id IN (?, ?) ORDER BY id', rows[0].id, rows[1].id).map((p) => p.reference), ['NEFT 88231', 'NEFT 88231']);
  });

  test('checking in everyone arriving says who is not ready; then one invoice bills every room', async () => {
    const type = one(`SELECT t.code, t.id FROM room_types t WHERE t.active = 1 ORDER BY t.id`); // the first type with two rooms free tonight
    const free = all('SELECT code, id FROM room_types WHERE active = 1').find((t) => website.roomsLeft(hotel.db, t.id, '2026-09-24', '2026-09-25') >= 2) || type;
    const r = await book({ name: 'Sen family', arrival: '2026-09-24', departure: '2026-09-25', [`rooms_${free.code}`]: '2', adults: '1', company: 'Sen Weddings Pvt Ltd', gstin: '19AAGCS7744K1Z3' });
    assert.equal(r.status, 303, r.text.match(/field-error[^>]*>([^<]+)/)?.[1]);
    const id = Number(r.headers.get('location').match(/\/groups\/(\d+)/)[1]);
    let page = await desk.get(`/groups/${id}`);
    assert.match(page.text, /Check in everyone arriving/);
    let res = await desk.post(`/groups/${id}/check-in`);
    assert.match(res.text, /Nobody was checked in/);
    assert.match(res.text, /registration card \(GRC\)|still being cleaned/);
    hotel.db.run("UPDATE rooms SET hk_status = 'clean' WHERE id IN (SELECT room_id FROM reservations WHERE group_id = ?)", id);
    setSetting('require_grc', false);
    res = await desk.post(`/groups/${id}/check-in`);
    setSetting('require_grc', true);
    assert.match(res.text, /2 rooms checked in/);
    assert.equal(one("SELECT COUNT(*) AS n FROM reservations WHERE group_id = ? AND status = 'checked_in'", id).n, 2);

    page = await desk.get(`/groups/${id}`);
    assert.match(page.text, /value="Sen Weddings Pvt Ltd"/);
    const inv = await desk.post(`/groups/${id}/invoice`, { bill_to: 'Sen Weddings Pvt Ltd', gstin: '19AAGCS7744K1Z3' });
    assert.equal(inv.status, 303);
    const rows = all('SELECT r.id, r.total_cents, g.first_name FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.group_id = ? ORDER BY r.id', id);
    const data = JSON.parse(one('SELECT data FROM invoices WHERE id = ?', Number(inv.headers.get('location').split('/').pop())).data);
    assert.equal(data.group.name, 'Sen family');
    assert.equal(data.billTo.gstin, '19AAGCS7744K1Z3');
    assert.equal(data.total, rows.reduce((n, x) => n + x.total_cents, 0));
    assert.equal(data.lines.filter((l) => l.text.startsWith('Room ')).length, 2);
    assert.ok(rows.every((x) => data.lines.some((l) => l.text.endsWith(`· ${x.first_name} · Sen family`) || l.text.includes(x.first_name))));
    assert.equal(data.tax, data.taxes.reduce((n, t) => n + t.tax, 0));
    const sheet = (await desk.get(inv.headers.get('location'))).text;
    assert.match(sheet, /Sen family · 2 rooms/);
    // a room of the group can't get an invoice of its own
    const member = one('SELECT confirmation FROM reservations WHERE group_id = ? ORDER BY id LIMIT 1', id).confirmation;
    await desk.get(`/reservations/${member}`);
    const own = await desk.post(`/reservations/${member}/invoice`, { bill_to: '' });
    assert.equal(own.status, 422);
    assert.match(own.text, /billed on its group’s invoice/);
  });

  test('housekeeping does not see groups', async () => {
    const hk = hotel.client();
    await hk.login('ramesh.yadav@hooghlyresidency.example.com', STAFF);
    assert.equal((await hk.get('/groups')).status, 403);
    assert.equal((await hk.get(`/groups/${groupId}`)).status, 403);
  });
});

describe('the demo hotel', () => {
  let hotel;
  before(async () => { hotel = await startHotel(); });
  after(() => hotel.stop());

  test('keeps the original reservations page: no Groups button', async () => {
    const c = hotel.client();
    await c.login();
    assert.doesNotMatch((await c.get('/reservations')).text, /href="\/groups"/);
  });
});
