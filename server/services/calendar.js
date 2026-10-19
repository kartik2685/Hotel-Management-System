'use strict';
/* Rate and availability calendar (Admin panel → Rate calendar): for each room type and night, the room rate after
   seasons and weekends (before a rate plan), and how many rooms are still free, counted the way bookings are
   (services/reservations.js: unassigned bookings and out-of-order rooms count too). */
const f = require('../lib/format');
const reservations = require('./reservations');
const seasons = require('./seasons');

const DAYS = 30;
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

function build(db, from) {
  const to = f.addDays(from, DAYS); // exclusive
  const types = db.all('SELECT id, code, name, base_rate_cents FROM room_types WHERE active = 1 ORDER BY sort, name');
  const rooms = db.all('SELECT id, room_type_id FROM rooms WHERE active = 1');
  const stays = db.all(`SELECT room_type_id, arrival, departure FROM reservations WHERE status IN ${reservations.HOLDS_ROOM} AND arrival < ? AND departure > ?`, to, from);
  const blocks = db.all('SELECT b.room_id, b.start_date, b.end_date, rm.room_type_id FROM room_blocks b JOIN rooms rm ON rm.id = b.room_id WHERE rm.active = 1 AND b.start_date < ? AND b.end_date > ?', to, from);
  const rules = seasons.active(db);

  const dates = Array.from({ length: DAYS }, (_, i) => {
    const date = f.addDays(from, i);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    // a season with dates that covers every room type names the column
    const named = rules.find((r) => r.start_date && !r.room_type_id && date >= r.start_date && date <= r.end_date);
    return { date, label: f.formatDay(date), weekend: day === 5 || day === 6, season: named ? named.name : '' };
  });

  const totals = dates.map(() => ({ rooms: 0, left: 0 }));
  const rows = types.map((type) => {
    const total = rooms.filter((r) => r.room_type_id === type.id).length;
    const cells = dates.map(({ date }, i) => {
      const rule = seasons.ruleFor(rules, type.id, date);
      const blocked = new Set(blocks.filter((b) => b.room_type_id === type.id && b.start_date <= date && b.end_date > date).map((b) => b.room_id)).size;
      const booked = stays.filter((s) => s.room_type_id === type.id && s.arrival <= date && s.departure > date).length;
      const left = Math.max(0, total - blocked - booked);
      totals[i].rooms += total - blocked;
      totals[i].left += left;
      return { rate: seasons.nightRates(rules, type, null, date, 1)[0], season: rule ? rule.name : '', changed: Boolean(rule), left, booked, blocked };
    });
    return { ...type, total, cells };
  });
  return {
    from, to, days: DAYS, dates, rows,
    totals: totals.map((t) => ({ ...t, occupancy: t.rooms ? Math.round(((t.rooms - t.left) / t.rooms) * 100) : 0 })),
    prev: f.addDays(from, -DAYS), next: f.addDays(from, DAYS),
  };
}

module.exports = { build, isDate, DAYS };
