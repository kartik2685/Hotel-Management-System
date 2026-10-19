'use strict';
/* Occupancy, ADR and RevPAR: live for open dates, from the night-audit history for closed ones. */
const f = require('../lib/format');

function totalRooms(db) {
  return db.get('SELECT COUNT(*) AS n FROM rooms WHERE active = 1').n;
}

/* Rooms sold and room revenue for each night from `from` to `to` (inclusive), from reservations: a Map by date.
   One query for the whole period, so long reports stay quick on a database across the network. */
function nights(db, from, to) {
  const rooms = totalRooms(db);
  const stays = db.all(
    "SELECT arrival, departure, nightly_rate_cents FROM reservations WHERE status IN ('confirmed', 'checked_in', 'checked_out') AND arrival <= ? AND departure > ?",
    to, from,
  );
  const out = new Map();
  for (let date = from; date <= to; date = f.addDays(date, 1)) {
    let sold = 0;
    let revenue = 0;
    for (const r of stays) {
      if (r.arrival <= date && r.departure > date) {
        sold += 1;
        revenue += r.nightly_rate_cents;
      }
    }
    out.set(date, {
      date, rooms, sold, revenue,
      adr: sold ? revenue / sold : 0,
      revpar: rooms ? revenue / rooms : 0,
      occupancy: rooms ? (sold / rooms) * 100 : 0,
    });
  }
  return out;
}

/* Rooms sold and room revenue for the night of `date`, from reservations. */
function night(db, date) {
  return nights(db, date, date).get(date);
}

/* Closed days (night audit history) from `from` to `to` (inclusive): a Map by date. */
function days(db, from, to) {
  const out = new Map();
  for (const s of db.all('SELECT * FROM daily_stats WHERE date >= ? AND date <= ?', from, to)) {
    out.set(s.date, {
      date: s.date, rooms: s.rooms_available, sold: s.rooms_sold, revenue: s.room_revenue_cents, adr: s.adr_cents, revpar: s.revpar_cents,
      occupancy: s.rooms_available ? (s.rooms_sold / s.rooms_available) * 100 : 0,
    });
  }
  return out;
}

/* A closed day from daily_stats, or null when the day was never closed. */
function day(db, date) {
  return days(db, date, date).get(date) || null;
}

/* Values for the last `n` days ending today (today is live). Missing history is skipped. */
function trend(db, bd, n, key) {
  const closed = days(db, f.addDays(bd, -(n - 1)), f.addDays(bd, -1));
  const values = [];
  for (let i = n - 1; i >= 1; i--) {
    const d = closed.get(f.addDays(bd, -i));
    if (d) values.push(d[key]);
  }
  values.push(night(db, bd)[key]);
  return values;
}

/* Revenue by outlet for the last `weeks` full weeks (Monday to Sunday) before the business week. */
function weeklyRevenue(db, bd, weeks = 12) {
  const monday = f.addDays(bd, -((f.weekday(bd) + 6) % 7));
  const entries = db.all('SELECT date, outlet, amount_cents FROM revenue WHERE date >= ? AND date < ?', f.addDays(monday, -7 * weeks), monday);
  const rows = [];
  for (let i = weeks; i >= 1; i--) {
    const start = f.addDays(monday, -7 * i);
    const end = f.addDays(start, 7);
    const sums = { rooms: 0, fnb: 0, spa: 0 };
    for (const r of entries) if (r.date >= start && r.date < end) sums[r.outlet] += r.amount_cents;
    rows.push({ week: start, ...sums, total: sums.rooms + sums.fnb + sums.spa });
  }
  return rows;
}

module.exports = { totalRooms, nights, night, days, day, trend, weeklyRevenue };
