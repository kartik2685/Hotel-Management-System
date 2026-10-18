'use strict';
/* Data for the tape chart (same shape as the original window.TAPE_CHART_DATA). */
const f = require('../lib/format');

const asNumber = (value) => (/^\d+$/.test(String(value)) ? Number(value) : String(value));

function data(db, settings, bd) {
  const from = f.addDays(bd, -14);
  const to = f.addDays(bd, 45);
  const types = {};
  for (const t of db.all('SELECT code, name FROM room_types ORDER BY sort, name')) types[t.code] = t.name;
  const rooms = db.all(
    `SELECT rm.number, rt.code FROM rooms rm JOIN room_types rt ON rt.id = rm.room_type_id
      WHERE rm.active = 1 ORDER BY rm.floor, leading_int(rm.number), rm.number`,
  ).map((r) => [asNumber(r.number), r.code]);
  const bookings = db.all(
    `SELECT r.confirmation, rm.number, r.arrival, r.departure, g.first_name, g.last_name, r.status, r.adults, r.children,
            r.nightly_rate_cents, src.name AS source, r.notes
       FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN rooms rm ON rm.id = r.room_id LEFT JOIN sources src ON src.id = r.source_id
      WHERE r.status NOT IN ('cancelled', 'no_show') AND r.arrival < ? AND r.departure > ?
      ORDER BY r.arrival, leading_int(rm.number), r.confirmation`, to, from,
  ).map((r) => {
    let status = { checked_out: 'out', checked_in: 'in', tentative: 'tent' }[r.status] || 'conf';
    if (r.status === 'confirmed' && r.arrival <= bd) status = 'arr';
    return [r.confirmation, asNumber(r.number), f.daysBetween(bd, r.arrival), f.daysBetween(bd, r.departure), r.first_name, r.last_name,
      status, r.adults, r.children, r.nightly_rate_cents / 100, r.source || '', r.notes || ''];
  });
  const blocks = db.all(
    `SELECT rm.number, b.start_date, b.end_date, b.reason FROM room_blocks b JOIN rooms rm ON rm.id = b.room_id
      WHERE b.start_date < ? AND b.end_date > ? ORDER BY b.start_date, b.id`, to, from,
  ).map((b) => [asNumber(b.number), f.daysBetween(bd, b.start_date), f.daysBetween(bd, b.end_date), b.reason]);
  return { businessDate: bd, checkInTime: settings.check_in_time, checkOutTime: settings.check_out_time, types, rooms, bookings, blocks };
}

/* JSON that is safe inside <script type="application/json">. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

module.exports = { data, scriptJson };
