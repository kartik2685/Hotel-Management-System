'use strict';
/* Night audit: close the business day, record its figures and prepare the next day. */
const f = require('../lib/format');
const clock = require('../lib/clock');
const activity = require('../lib/activity');
const settingsService = require('./settings');
const stats = require('./stats');

const STAY = `SELECT r.confirmation, r.eta, g.first_name || ' ' || g.last_name AS name, rm.number AS room
  FROM reservations r JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id`;

function summary(db) {
  const settings = settingsService.all(db);
  const bd = settingsService.businessDate(db);
  const night = stats.night(db, bd);
  const outlet = (name) => (db.get('SELECT amount_cents FROM revenue WHERE date = ? AND outlet = ?', bd, name) || {}).amount_cents || 0;
  return {
    bd, day: f.formatDay(bd), next: f.formatDay(f.addDays(bd, 1)), mode: settings.business_date_mode,
    closed: Boolean(db.get('SELECT 1 FROM daily_stats WHERE date = ?', bd)),
    expected: db.all(`${STAY} WHERE r.status IN ('confirmed', 'tentative') AND r.arrival <= ? ORDER BY r.eta NULLS FIRST, r.id`, bd),
    dueOut: db.all(`${STAY} WHERE r.status = 'checked_in' AND r.departure <= ? ORDER BY rm.number NULLS FIRST, r.id`, bd),
    night: { ...night, occupancyText: f.pct1(night.sold, night.rooms), adrText: f.money(Math.round(night.adr)), revparText: f.money(Math.round(night.revpar)), revenueText: f.money(night.revenue) },
    fnb: outlet('fnb'), spa: outlet('spa'),
    tasksToday: db.get('SELECT COUNT(*) AS n FROM housekeeping_tasks WHERE task_date = ?', bd).n,
  };
}

/* Departure cleans and stayover services for `date`, from who is in house. */
function generateTasks(db, date) {
  if (db.get('SELECT 1 FROM housekeeping_tasks WHERE task_date = ?', date)) return 0;
  const stays = db.all(
    `SELECT r.room_id, r.departure, rm.attendant_id, rt.clean_minutes, rt.service_minutes
       FROM reservations r JOIN rooms rm ON rm.id = r.room_id JOIN room_types rt ON rt.id = rm.room_type_id
      WHERE r.status = 'checked_in' AND r.arrival <= ? AND r.departure >= ?`, date, date,
  );
  for (const s of stays) {
    const leaving = s.departure <= date;
    db.run('INSERT INTO housekeeping_tasks (task_date, room_id, kind, title, minutes, attendant_id) VALUES (?, ?, ?, ?, ?, ?)',
      date, s.room_id, leaving ? 'departure' : 'stayover', leaving ? 'Departure clean' : 'Stayover service', leaving ? s.clean_minutes : s.service_minutes, s.attendant_id);
  }
  return stays.length;
}

function close(db, req, { noShows = false } = {}) {
  const settings = settingsService.all(db);
  const s = summary(db);
  const error = (message) => Object.assign(new Error(message), { status: 422 });
  if (s.dueOut.length) throw error(`Check out (or extend) these guests first: ${s.dueOut.map((x) => `${x.name}${x.room ? ` (${x.room})` : ''}`).join(', ')}.`);
  if (s.expected.length && !noShows) throw error(`${f.plural(s.expected.length, 'arrival is', 'arrivals are')} still expected. Check them in, cancel them, or tick “Mark the rest as no-shows”.`);
  const now = clock.stamp(settings.timezone);
  db.tx(() => {
    if (noShows) db.run("UPDATE reservations SET status = 'no_show', updated_at = ? WHERE status IN ('confirmed', 'tentative') AND arrival <= ?", now, s.bd);
    const n = stats.night(db, s.bd);
    db.run(
      `INSERT INTO daily_stats (date, rooms_available, rooms_sold, room_revenue_cents, adr_cents, revpar_cents, closed_by, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET rooms_available = excluded.rooms_available, rooms_sold = excluded.rooms_sold, room_revenue_cents = excluded.room_revenue_cents,
         adr_cents = excluded.adr_cents, revpar_cents = excluded.revpar_cents, closed_by = excluded.closed_by, closed_at = excluded.closed_at`,
      s.bd, n.rooms, n.sold, n.revenue, Math.round(n.adr), Math.round(n.revpar), req.user.id, now,
    );
    db.run("INSERT INTO revenue (date, outlet, amount_cents) VALUES (?, 'rooms', ?) ON CONFLICT(date, outlet) DO UPDATE SET amount_cents = excluded.amount_cents", s.bd, n.revenue);
    const next = f.addDays(s.bd, 1);
    if (settings.business_date_mode === 'fixed') settingsService.save(db, { business_date: next });
    generateTasks(db, next);
    db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)',
      'calendar-check', '', `Night audit closed for ${s.day}`, `${n.sold} of ${n.rooms} rooms sold · ${f.money(n.revenue)} room revenue`, now);
    activity.log(db, req, 'night-audit.close', `Closed ${s.bd}: ${n.sold}/${n.rooms} rooms, ${f.money(n.revenue)} room revenue${noShows && s.expected.length ? `, ${s.expected.length} no-shows` : ''}`);
  });
}

module.exports = { summary, close, generateTasks };
