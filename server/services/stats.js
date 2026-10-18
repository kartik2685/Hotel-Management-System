'use strict';
/* Occupancy, ADR and RevPAR: live for open dates, from the night-audit history for closed ones. */
const f = require('../lib/format');

const SOLD = `status IN ('confirmed', 'checked_in', 'checked_out') AND arrival <= ? AND departure > ?`;

function totalRooms(db) {
  return db.get('SELECT COUNT(*) AS n FROM rooms WHERE active = 1').n;
}

/* Rooms sold and room revenue for the night of `date`, from reservations. */
function night(db, date) {
  const row = db.get(`SELECT COUNT(*) AS sold, COALESCE(SUM(nightly_rate_cents), 0) AS revenue FROM reservations WHERE ${SOLD}`, date, date);
  const rooms = totalRooms(db);
  return {
    date, rooms, sold: row.sold, revenue: row.revenue,
    adr: row.sold ? row.revenue / row.sold : 0,
    revpar: rooms ? row.revenue / rooms : 0,
    occupancy: rooms ? (row.sold / rooms) * 100 : 0,
  };
}

/* A closed day from daily_stats, or a live figure when the day was never closed. */
function day(db, date) {
  const s = db.get('SELECT * FROM daily_stats WHERE date = ?', date);
  if (!s) return null;
  return {
    date, rooms: s.rooms_available, sold: s.rooms_sold, revenue: s.room_revenue_cents, adr: s.adr_cents, revpar: s.revpar_cents,
    occupancy: s.rooms_available ? (s.rooms_sold / s.rooms_available) * 100 : 0,
  };
}

/* Values for the last `n` days ending today (today is live). Missing history is skipped. */
function trend(db, bd, n, key) {
  const values = [];
  for (let i = n - 1; i >= 1; i--) {
    const d = day(db, f.addDays(bd, -i));
    if (d) values.push(d[key]);
  }
  values.push(night(db, bd)[key]);
  return values;
}

/* Revenue by outlet for the last `weeks` full weeks (Monday to Sunday) before the business week. */
function weeklyRevenue(db, bd, weeks = 12) {
  const monday = f.addDays(bd, -((f.weekday(bd) + 6) % 7));
  const rows = [];
  for (let i = weeks; i >= 1; i--) {
    const start = f.addDays(monday, -7 * i);
    const end = f.addDays(start, 7);
    const sums = { rooms: 0, fnb: 0, spa: 0 };
    for (const r of db.all('SELECT outlet, SUM(amount_cents) AS total FROM revenue WHERE date >= ? AND date < ? GROUP BY outlet', start, end)) {
      sums[r.outlet] = r.total;
    }
    rows.push({ week: start, ...sums, total: sums.rooms + sums.fnb + sums.spa });
  }
  return rows;
}

module.exports = { totalRooms, night, day, trend, weeklyRevenue };
