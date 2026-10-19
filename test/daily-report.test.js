'use strict';
/* The owner's morning report (services/daily.js): yesterday's rooms, revenue and money in, today's arrivals and
   departures, money still to collect and the week ahead, with the same in one WhatsApp message. The test clock
   reads Thu 24 Sep 2026, so the report is about Wed 23 Sep, which the sample's night audit has closed. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const sample = require('../server/db/sample');
const daily = require('../server/services/daily');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];
const STAFF = 'Staff-Test-2026';

describe('daily report', () => {
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

  test('managers get yesterday by default; the front desk does not get it', async () => {
    const page = (await manager.get('/admin/daily')).text;
    assert.match(page, /<h2 class="daily-title">Wed 23 Sep<\/h2>/);
    assert.match(page, /This day was closed by the night audit\./);
    assert.match(page, /<h2 class="card__title" id="d-today">Thu 24 Sep<\/h2>/);
    assert.match((await manager.get('/admin/daily?day=garbage')).text, /<h2 class="daily-title">Wed 23 Sep<\/h2>/);
    assert.match((await manager.get('/admin/daily?day=2026-09-20')).text, /<h2 class="daily-title">Sun 20 Sep<\/h2>/);
    const desk = hotel.client();
    await desk.login('priya.das@hooghlyresidency.example.com', STAFF);
    assert.equal((await desk.get('/admin/daily')).status, 403);
  });

  test('the figures are the hotel’s own: night audit, payments, arrivals, money to collect', () => {
    const r = daily.build(hotel.db, '2026-09-23');
    const audit = one("SELECT * FROM daily_stats WHERE date = '2026-09-23'");
    assert.deepEqual([r.closed, r.rooms.sold, r.rooms.available, r.revenue.rooms], [true, audit.rooms_sold, audit.rooms_available, audit.room_revenue_cents]);
    assert.equal(r.money.in, one("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE created_at LIKE '2026-09-23%' AND amount_cents > 0").n);
    assert.equal(r.money.byMethod.reduce((n, m) => n + m.amount, 0), r.money.in);
    assert.equal(r.arrivals.length, one("SELECT COUNT(*) AS n FROM reservations WHERE arrival = '2026-09-24' AND status IN ('tentative', 'confirmed', 'checked_in')").n);
    assert.equal(r.inHouse.length, one("SELECT COUNT(*) AS n FROM reservations WHERE status = 'checked_in'").n);
    assert.equal(r.toCollect, one("SELECT COALESCE(SUM(CASE WHEN total_cents > paid_cents THEN total_cents - paid_cents ELSE 0 END), 0) AS n FROM reservations WHERE status = 'checked_in'").n);
    assert.equal(r.bookings.made, one("SELECT COUNT(*) AS n FROM reservations WHERE created_at LIKE '2026-09-23%'").n);
    assert.equal(r.week.length, 7);
    assert.equal(r.week[0].date, '2026-09-24');
  });

  test('one tap sends it on WhatsApp: the same figures in a short message', async () => {
    const page = (await manager.get('/admin/daily')).text;
    const href = page.match(/href="(https:\/\/wa\.me\/\?text=[^"]+)"/)[1].replace(/&amp;/g, '&');
    const text = decodeURIComponent(href.split('?text=')[1]);
    const r = daily.build(hotel.db, '2026-09-23');
    assert.match(text, /^The Hooghly Residency · Wed 23 Sep\n/);
    assert.match(text, new RegExp(`\\nRooms: ${r.rooms.sold} of ${r.rooms.available} sold \\(${r.rooms.occupancy}%\\) · ADR ₹[\\d,]+ · RevPAR ₹[\\d,]+\\n`));
    assert.match(text, /\nMoney in: ₹[\d,]+/);
    assert.match(text, new RegExp(`\\nThu 24 Sep: ${r.arrivals.length} arrivals?`));
    assert.match(text, /\nStill to collect from guests in house: ₹[\d,]+\n/);
    assert.match(text, /\nNext 7 nights: (\d+% · ){6}\d+%$/);
    assert.match(page, /<pre class="daily-message">The Hooghly Residency · Wed 23 Sep/); // the page shows what will be sent
  });
});
