'use strict';
/* The owner's morning report (Admin panel → Daily report): how a day went (rooms, revenue, money in, bookings)
   and what the next day holds (arrivals, departures, money still to collect, the week ahead), on one page and in
   one short message to send on WhatsApp. */
const f = require('../lib/format');
const settingsService = require('./settings');
const stats = require('./stats');
const feedback = require('./feedback');

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const METHODS = ['Cash', 'Card', 'UPI', 'Bank transfer'];

function build(db, day) {
  const next = f.addDays(day, 1);
  const like = `${day}%`;
  const closed = stats.day(db, day);
  const rooms = closed || stats.night(db, day);
  const outlet = Object.fromEntries(db.all('SELECT outlet, amount_cents FROM revenue WHERE date = ?', day).map((r) => [r.outlet, r.amount_cents]));
  const charges = db.get("SELECT COALESCE(SUM(amount_cents + tax_cents), 0) AS n FROM folio_charges WHERE posted_at LIKE ? AND voided_at IS NULL", like).n;
  const payments = db.all('SELECT method, amount_cents FROM payments WHERE created_at LIKE ?', like);
  const byMethod = METHODS.map((method) => ({ method, amount: payments.filter((p) => p.method === method && p.amount_cents > 0).reduce((n, p) => n + p.amount_cents, 0) }))
    .filter((m) => m.amount);
  const made = db.all('SELECT total_cents, booked_online FROM reservations WHERE created_at LIKE ?', like);
  const stay = (sql, ...args) => db.all(`SELECT r.confirmation, r.status, r.total_cents, r.paid_cents, g.first_name || ' ' || g.last_name AS name, g.vip, rm.number AS room
    FROM reservations r JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id WHERE ${sql} ORDER BY r.arrival, rm.number`, ...args);
  const arrivals = stay("r.arrival = ? AND r.status IN ('tentative', 'confirmed', 'checked_in')", next);
  const departures = stay("r.departure = ? AND r.status IN ('checked_in', 'checked_out')", next);
  const inHouse = stay("r.status = 'checked_in'");
  const owing = (list) => list.reduce((n, b) => n + Math.max(0, b.total_cents - b.paid_cents), 0);
  const week = [...stats.nights(db, next, f.addDays(next, 6)).values()].map((n) => ({ date: n.date, occupancy: Math.round(n.occupancy), sold: n.sold, rooms: n.rooms }));
  return {
    day, next, closed: Boolean(closed),
    rooms: { sold: rooms.sold, available: rooms.rooms, occupancy: f.pct1(rooms.sold, rooms.rooms), adr: Math.round(rooms.adr), revpar: Math.round(rooms.revpar), revenue: rooms.revenue },
    revenue: { rooms: rooms.revenue, fnb: outlet.fnb || 0, spa: outlet.spa || 0, charges },
    money: {
      in: payments.filter((p) => p.amount_cents > 0).reduce((n, p) => n + p.amount_cents, 0),
      refunds: -payments.filter((p) => p.amount_cents < 0).reduce((n, p) => n + p.amount_cents, 0),
      byMethod,
    },
    bookings: {
      made: made.length, value: made.reduce((n, b) => n + b.total_cents, 0), online: made.filter((b) => b.booked_online).length,
      cancelled: db.get('SELECT COUNT(*) AS n FROM reservations WHERE cancelled_at LIKE ?', like).n,
      noShows: db.get("SELECT COUNT(*) AS n FROM reservations WHERE status = 'no_show' AND arrival = ?", day).n,
    },
    arrivals, departures, inHouse,
    vip: arrivals.filter((a) => a.vip).length,
    toCollect: owing(inHouse), dueOut: departures.filter((d) => d.status === 'checked_in' && d.total_cents > d.paid_cents),
    outOfOrder: db.get('SELECT COUNT(*) AS n FROM room_blocks WHERE start_date <= ? AND end_date > ?', next, next).n,
    dirty: db.get("SELECT COUNT(*) AS n FROM rooms WHERE active = 1 AND hk_status = 'dirty'").n,
    week, feedback: feedback.summary(db, day, day),
  };
}

/* The report as one short message (WhatsApp, SMS, email). */
function text(settings, r) {
  const m = f.moneyWhole;
  const other = r.revenue.fnb + r.revenue.spa;
  return [
    `${settings.hotel_name} · ${f.formatDay(r.day)}`,
    `Rooms: ${r.rooms.sold} of ${r.rooms.available} sold (${r.rooms.occupancy}%) · ADR ${m(r.rooms.adr)} · RevPAR ${m(r.rooms.revpar)}`,
    `Revenue: rooms ${m(r.revenue.rooms)}${other ? ` · food & spa ${m(other)}` : ''}${r.revenue.charges ? ` · charged to rooms ${m(r.revenue.charges)}` : ''}`,
    `Money in: ${m(r.money.in)}${r.money.byMethod.length ? ` (${r.money.byMethod.map((x) => `${x.method} ${m(x.amount)}`).join(' · ')})` : ''}${r.money.refunds ? ` · refunds ${m(r.money.refunds)}` : ''}`,
    `Bookings: ${r.bookings.made} new (${m(r.bookings.value)}${r.bookings.online ? `, ${r.bookings.online} online` : ''}) · ${r.bookings.cancelled} cancelled · ${r.bookings.noShows} no-show${r.bookings.noShows === 1 ? '' : 's'}`,
    r.feedback.count ? `Guest feedback: ${r.feedback.count} · average ${r.feedback.averageText}★${r.feedback.low.length ? ` · ${r.feedback.low.length} unhappy` : ''}` : null,
    '',
    `${f.formatDay(r.next)}: ${f.plural(r.arrivals.length, 'arrival', 'arrivals')}${r.vip ? ` (${r.vip} VIP)` : ''} · ${f.plural(r.departures.length, 'departure', 'departures')} · ${r.inHouse.length} in house`,
    `Still to collect from guests in house: ${m(r.toCollect)}`,
    `Next 7 nights: ${r.week.map((w) => `${w.occupancy}%`).join(' · ')}`,
  ].filter((line) => line !== null).join('\n');
}

/* The day a morning report is about: the one before the business date. */
const defaultDay = (db) => f.addDays(settingsService.businessDate(db), -1);

module.exports = { build, text, isDate, defaultDay };
