'use strict';
/* Seasons and weekends (services/seasons.js): each night at its own rate, GST by the night's band, kept when the
   stay is edited, shown night by night on the booking page, the website and the invoice. The sample hotel has
   Weekend (+10% on Friday and Saturday nights) and Festive season (+25%, 6–15 Oct 2026 on the test clock). */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const sample = require('../server/db/sample');
const seasons = require('../server/services/seasons');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];
const STAFF = 'Staff-Test-2026';

describe('seasons and weekends', () => {
  let hotel;
  let owner;
  let desk;
  let weekend; // the booking across a weekend
  const one = (sql, ...args) => hotel.db.get(sql, ...args);
  const book = async (type, arrival, departure, email) => {
    await desk.get('/reservations');
    const r = await desk.api('/reservations', { arrival, departure, type, adults: '1', children: '0', plan: 'BAR', first: 'Season', last: 'Guest', email, phone: '' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return one('SELECT * FROM reservations WHERE confirmation = ?', r.body.booking.confirmation);
  };

  before(async () => {
    hotel = await startHotel({
      load: async (db) => {
        await seed.createEmptyHotel(db, { email: OWNER[0], name: 'Hotel Owner', password: OWNER[1] });
        await sample.add(db, { password: STAFF });
      },
    });
    owner = hotel.client();
    await owner.login(...OWNER);
    desk = hotel.client();
    await desk.login('priya.das@hooghlyresidency.example.com', STAFF);
  });
  after(() => hotel.stop());

  test('one rule a night: dates before weekdays, one room type or all, then the rate plan', () => {
    const rules = [
      { start_date: '2026-10-16', end_date: '2026-10-17', weekdays: '', room_type_id: null, adjust_type: 'percent', adjust_value: 25 },
      { start_date: null, end_date: null, weekdays: '56', room_type_id: null, adjust_type: 'amount', adjust_value: 50000 },
      { start_date: null, end_date: null, weekdays: '0', room_type_id: 9, adjust_type: 'percent', adjust_value: -10 },
    ];
    const type = { id: 3, base_rate_cents: 400000 };
    // Thu, Fri (festival), Sat (festival), Sun, Mon: the festival beats the weekend; the Sunday rule is another room's
    assert.deepEqual(seasons.nightRates(rules, type, null, '2026-10-15', 5), [400000, 500000, 500000, 400000, 400000]);
    assert.deepEqual(seasons.nightRates(rules, type, null, '2026-10-23', 2), [450000, 450000]); // a plain weekend: +₹500
    assert.deepEqual(seasons.nightRates(rules, { id: 9, base_rate_cents: 400000 }, null, '2026-10-25', 1), [360000]);
    assert.deepEqual(seasons.nightRates(rules, type, { adjust_type: 'percent', adjust_value: -10 }, '2026-10-23', 1), [405000]); // the plan after the season
  });

  test('a stay across a weekend: each night at its rate, the average kept, GST by the night', async () => {
    weekend = await book('DLX', '2026-11-05', '2026-11-08', 'weekend.guest@example.com'); // Thu, Fri, Sat nights
    assert.equal(weekend.night_rates, '[480000,528000,528000]');
    assert.equal(weekend.room_total_cents, 1536000);
    assert.equal(weekend.nightly_rate_cents, 512000);
    assert.equal(weekend.tax_cents, 24000 + 52800); // 5% of ₹4,800 and of 2 × ₹5,280
    const page = (await desk.get(`/reservations/${weekend.confirmation}`)).text;
    assert.match(page, /<dt>1 night × ₹4,800\.00<\/dt><dd>₹4,800\.00<\/dd>/);
    assert.match(page, /<dt>2 nights × ₹5,280\.00<\/dt><dd>₹10,560\.00<\/dd>/);
    assert.match(page, /Nightly rate \(₹\) <span class="field-label__hint">average<\/span>/);
  });

  test('a festival night above ₹7,500 takes 18% GST, the weekend night next to it 5%', async () => {
    const b = await book('PRM', '2026-10-14', '2026-10-17', 'festive.guest@example.com'); // Wed, Thu in the festival; Fri a weekend night
    assert.equal(b.night_rates, '[775000,775000,682000]');
    assert.equal(b.tax_cents, Math.round(775000 * 2 * 0.18) + Math.round(682000 * 0.05));
  });

  test('editing: a longer stay prices only the new night, a typed rate counts for every night', async () => {
    const g = one('SELECT g.* FROM guests g WHERE g.id = ?', weekend.guest_id);
    const room = one('SELECT number FROM rooms WHERE id = ?', weekend.room_id);
    const form = (changes) => ({
      arrival: weekend.arrival, departure: weekend.departure, room_type_id: String(weekend.room_type_id), room: room ? room.number : '', adults: '1', children: '0',
      rate_plan_id: String(weekend.rate_plan_id), nightly_rate: '5120', source_id: String(weekend.source_id || ''), eta: '', first: g.first_name, last: g.last_name,
      email: g.email, phone: g.phone || '', notes: '', requests: '', ...changes,
    });
    await desk.get(`/reservations/${weekend.confirmation}`);
    let r = await desk.post(`/reservations/${weekend.confirmation}`, form({ eta: '19:30' }));
    assert.equal(r.status, 303, r.text.match(/field-error">([^<]+)/)?.[1]);
    assert.equal(one('SELECT total_cents FROM reservations WHERE id = ?', weekend.id).total_cents, weekend.total_cents, 'nothing about the price changed');
    r = await desk.post(`/reservations/${weekend.confirmation}`, form({ departure: '2026-11-09' })); // + Sunday night
    assert.equal(r.status, 303);
    assert.equal(one('SELECT night_rates FROM reservations WHERE id = ?', weekend.id).night_rates, '[480000,528000,528000,480000]');
    r = await desk.post(`/reservations/${weekend.confirmation}`, form({ departure: '2026-11-09', nightly_rate: '5000' }));
    const after = one('SELECT * FROM reservations WHERE id = ?', weekend.id);
    assert.deepEqual([after.night_rates, after.nightly_rate_cents, after.room_total_cents], [null, 500000, 2000000]);
  });

  test('the website prices each night the same way', async () => {
    const guest = hotel.client();
    const q = new URLSearchParams({ arrival: '2026-11-05', departure: '2026-11-08', adults: '1', children: '0', type: 'DLX', plan: 'BAR' });
    const page = (await guest.get(`/hotel/book/details?${q}`)).text;
    assert.match(page, /data-base="1612800"/); // ₹15,360 + ₹768 GST
    assert.match(page, /<dt>2 nights × ₹5,280\.00<\/dt>/);
    assert.match(page, /<dt>GST 5%<\/dt>/);
    const results = (await guest.get(`/hotel/book?${q}`)).text;
    assert.match(results, /₹16,128\.00<\/strong>3 nights incl\. tax/);
  });

  test('the invoice has a line for each rate, and adds up to the bill', async () => {
    const stay = one("SELECT * FROM reservations WHERE status = 'checked_in' AND night_rates IS NOT NULL ORDER BY id LIMIT 1");
    await desk.get(`/reservations/${stay.confirmation}`);
    assert.equal((await desk.post(`/reservations/${stay.confirmation}/invoice`, { bill_to: '', gstin: '' })).status, 303);
    const inv = JSON.parse(one('SELECT data FROM invoices WHERE reservation_id = ? ORDER BY id DESC', stay.id).data);
    const rooms = inv.lines.filter((l) => l.sac === '996311' && l.text.startsWith('Room'));
    assert.ok(rooms.length >= 2, JSON.stringify(rooms));
    assert.equal(rooms.reduce((n, l) => n + l.amount, 0), stay.room_total_cents);
    assert.equal(inv.tax, inv.taxes.reduce((n, t) => n + t.tax, 0));
    assert.equal(inv.total, stay.total_cents);
  });

  test('leaving early keeps the nights stayed at their rates', async () => {
    const stay = one("SELECT * FROM reservations WHERE status = 'checked_in' AND night_rates IS NOT NULL AND departure > '2026-09-25' AND arrival < '2026-09-23' ORDER BY id LIMIT 1");
    const kept = JSON.parse(stay.night_rates).slice(0, (Date.parse('2026-09-24') - Date.parse(stay.arrival)) / 864e5);
    await desk.get('/dashboard');
    const r = await desk.api(`/api/reservations/${stay.confirmation}/check-out`, { settle: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = one('SELECT * FROM reservations WHERE id = ?', stay.id);
    assert.equal(after.room_total_cents, kept.reduce((n, x) => n + x, 0));
    assert.equal(after.night_rates, kept.some((x) => x !== kept[0]) ? JSON.stringify(kept) : null);
  });

  test('the admin adds a season; it needs dates or days, and both dates', async () => {
    await owner.get('/admin/rates');
    const base = { name: 'Durga Puja', adjust_type: 'percent', adjust_value: '30', active: 'on' };
    let r = await owner.post('/admin/seasons', base);
    assert.equal(r.status, 422);
    assert.match(r.text, /Choose dates, days of the week, or both\./);
    r = await owner.post('/admin/seasons', { ...base, start_date: '2026-10-17' });
    assert.match(r.text, /Give both dates, or neither for every week\./);
    r = await owner.post('/admin/seasons', { ...base, start_date: '2026-10-21', end_date: '2026-10-17' });
    assert.match(r.text, /The last night comes after the first\./);
    r = await owner.post('/admin/seasons', { ...base, start_date: '2026-10-17', end_date: '2026-10-21', room_type_id: String(one("SELECT id FROM room_types WHERE code = 'EXS'").id) });
    assert.equal(r.status, 303);
    const page = (await owner.get('/admin/rates')).text;
    assert.match(page, /<strong>Durga Puja<\/strong><\/td><td>Sat 17 Oct → Wed 21 Oct<\/td><td>Executive Suite<\/td><td class="numeric">\+30%<\/td>/);
    assert.match(page, /<strong>Weekend<\/strong><\/td><td>Fri, Sat<\/td><td>Every room type<\/td><td class="numeric">\+10%<\/td>/);
    // the staff booking form gets the rules for its own quote
    assert.match((await desk.get('/reservations')).text, /<script type="application\/json" id="rate-seasons">\[.*"days":"56".*\]<\/script>/);
  });
});
