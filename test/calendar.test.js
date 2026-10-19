'use strict';
/* Rate calendar (services/calendar.js): each room type's rate per night after seasons and weekends, and the rooms
   still free, counted like bookings count them. The sample hotel's rules: Weekend +10% on Friday and Saturday
   nights, Festive season +25% on 6–15 Oct 2026 (the test clock reads Thu 24 Sep 2026). */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const sample = require('../server/db/sample');
const calendar = require('../server/services/calendar');
const website = require('../server/services/website');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];
const STAFF = 'Staff-Test-2026';

describe('rate calendar', () => {
  let hotel;
  let manager;
  const one = (sql, ...args) => hotel.db.get(sql, ...args);

  before(async () => {
    hotel = await startHotel({
      load: async (db) => {
        await seed.createEmptyHotel(db, { email: OWNER[0], name: 'Hotel Owner', password: OWNER[1] });
        await sample.add(db, { password: STAFF });
      },
    });
    manager = hotel.client();
    await manager.login('sneha.banerjee@hooghlyresidency.example.com', STAFF);
  });
  after(() => hotel.stop());

  test('managers see 30 nights from the business date; the front desk does not', async () => {
    const page = (await manager.get('/admin/calendar')).text;
    assert.match(page, /<h2 class="card__title" id="cal-title">Thu 24 Sep → Fri 23 Oct<\/h2>/);
    assert.equal((page.match(/class="rate-cal__day/g) || []).length, 30);
    assert.match(page, /href="\/admin\/calendar\?from=2026-10-24"/); // the next 30 nights
    assert.match((await manager.get('/admin/calendar?from=nonsense')).text, /Thu 24 Sep → Fri 23 Oct/);
    assert.match((await manager.get('/admin/calendar?from=2026-10-06')).text, /Tue 6 Oct → Wed 4 Nov/);
    const desk = hotel.client();
    await desk.login('priya.das@hooghlyresidency.example.com', STAFF);
    assert.equal((await desk.get('/admin/calendar')).status, 403);
  });

  test('rates: a weekend night +10%, a festival night +25%, and on a festival Friday the festival wins', () => {
    const c = calendar.build(hotel.db, '2026-09-24');
    const dlx = c.rows.find((r) => r.code === 'DLX');
    const at = (date) => dlx.cells[c.dates.findIndex((d) => d.date === date)];
    assert.deepEqual([at('2026-09-24').rate, at('2026-09-25').rate, at('2026-10-08').rate, at('2026-10-09').rate], [480000, 528000, 600000, 600000]);
    assert.deepEqual([at('2026-09-25').season, at('2026-10-09').season], ['Weekend', 'Festive season']);
    assert.equal(c.dates.find((d) => d.date === '2026-10-09').season, 'Festive season');
    assert.ok(c.dates.find((d) => d.date === '2026-09-26').weekend);
  });

  test('rooms left match what a booking for that night can get', () => {
    const c = calendar.build(hotel.db, '2026-09-24');
    for (const row of c.rows) {
      for (const i of [0, 1, 7]) {
        const date = c.dates[i].date;
        assert.equal(row.cells[i].left, website.roomsLeft(hotel.db, row.id, date, c.dates[i + 1].date), `${row.code} on ${date}`);
      }
    }
    assert.equal(c.totals[0].left, c.rows.reduce((n, r) => n + r.cells[0].left, 0));
  });

  test('a room out of order is one fewer to sell, and says why', async () => {
    const room = one("SELECT rm.id, rm.room_type_id FROM rooms rm JOIN room_types t ON t.id = rm.room_type_id WHERE t.code = 'STD' AND rm.active = 1 ORDER BY rm.id LIMIT 1");
    const before = calendar.build(hotel.db, '2026-11-02').rows.find((r) => r.id === room.room_type_id).cells[0];
    hotel.db.run("INSERT INTO room_blocks (room_id, start_date, end_date, reason, created_at) VALUES (?, '2026-11-02', '2026-11-04', 'Repainting', '2026-09-24 10:42')", room.id);
    const after = calendar.build(hotel.db, '2026-11-02').rows.find((r) => r.id === room.room_type_id).cells[0];
    assert.deepEqual([after.left, after.blocked], [before.left - 1, 1]);
    assert.match((await manager.get('/admin/calendar?from=2026-11-02')).text, /Standard Room, Mon 2 Nov: ₹3,200\.00 · \d+ booked, 1 out of order/);
  });
});
