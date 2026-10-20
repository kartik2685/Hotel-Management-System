'use strict';
/* Everything the dashboard shows, computed from the database. */
const f = require('../lib/format');
const stats = require('./stats');

const CURRENCY_NAMES = { USD: 'US dollars', INR: 'Indian rupees', EUR: 'euros', GBP: 'pounds sterling', AED: 'UAE dirhams', CAD: 'Canadian dollars', AUD: 'Australian dollars' };
const greeting = (time) => {
  const hour = Number(time.slice(0, 2));
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
};
const signed = (value, text) => (value > 0 ? '+' : value < 0 ? '−' : '±') + text;
const trend = (value) => (value > 0 ? 'up' : value < 0 ? 'down' : 'flat');

function build(db, shell, user) {
  const { settings, bd, now, states, roomCounts, night: tonight, tasks } = shell;

  // ---- arrivals
  const arrivals = db.all(
    `SELECT r.*, g.first_name, g.last_name, g.vip, g.corporate, rt.name AS type_name, rm.number AS room_number, rm.hk_status, rp.name AS plan_name,
            g.prior_stays + (SELECT COUNT(*) FROM reservations x WHERE x.guest_id = r.guest_id AND x.id <> r.id AND x.status IN ('checked_in', 'checked_out')) AS guest_stays
       FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN room_types rt ON rt.id = r.room_type_id
       LEFT JOIN rooms rm ON rm.id = r.room_id LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id
      WHERE r.arrival = ? AND r.status IN ('confirmed', 'checked_in') ORDER BY r.id`, bd,
  ).map((r) => {
    const name = `${r.first_name} ${r.last_name}`;
    const tags = JSON.parse(r.tags || '[]');
    const chips = [];
    if (r.vip) chips.push({ cls: 'chip chip--gold', text: 'VIP' });
    if (!r.corporate && r.guest_stays > 0) chips.push({ cls: 'chip', text: 'Returning' });
    if (tags.includes('first-stay')) chips.push({ cls: 'chip', text: 'First stay' });
    if (tags.includes('early')) chips.push({ cls: 'chip chip--blue', text: 'Early arrival' });
    if (tags.includes('late')) chips.push({ cls: 'chip chip--blue', text: 'Late arrival' });
    if (tags.includes('anniversary')) chips.push({ cls: 'chip chip--rose', text: 'Anniversary' });
    const inHouse = r.status === 'checked_in';
    let action = 'check-in';
    if (inHouse) action = 'in';
    else if (!r.room_id) action = 'unassigned';
    else if (r.hk_status !== 'clean') action = 'cleaning';
    else if (settings.require_grc && !r.grc_at) action = 'grc';
    const time = inHouse ? f.clock(r.checked_in_at) : r.eta || '';
    return {
      confirmation: r.confirmation, name, vip: Boolean(r.vip), initials: f.initials(name), chips, inHouse, action, time,
      meta: `${f.plural(f.daysBetween(r.arrival, r.departure), 'night', 'nights')} · ${r.plan_name || 'Room only'} · ${f.guestCount(r.adults, r.children)}`,
      room: r.room_number || '—', roomSort: r.room_number ? Number(r.room_number) || 0 : 1e9, typeName: r.type_name,
    };
  }).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.roomSort - b.roomSort);
  const arrived = arrivals.filter((a) => a.inHouse).length;

  // ---- departures
  const departures = db.all(
    `SELECT r.*, g.first_name, g.last_name, rt.name AS type_name, rm.number AS room_number
       FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN room_types rt ON rt.id = r.room_type_id LEFT JOIN rooms rm ON rm.id = r.room_id
      WHERE r.departure = ? AND r.status IN ('checked_in', 'checked_out') ORDER BY r.id`, bd,
  ).map((r) => ({
    due: r.status === 'checked_in', room: r.room_number || '—', name: `${r.first_name} ${r.last_name}`,
    sub: `${r.type_name} · ${f.plural(f.daysBetween(r.arrival, r.departure), 'night', 'nights')}`,
    when: r.status === 'checked_in' ? `Due by ${settings.check_out_time}` : `Out ${f.clock(r.checked_out_at)}`,
    owing: Math.max(0, r.total_cents - r.paid_cents), out: r.checked_out_at || '',
  })).sort((a, b) => (a.due === b.due ? (a.due ? Number(a.room) - Number(b.room) : a.out.localeCompare(b.out)) : a.due ? -1 : 1));
  const stillIn = departures.filter((d) => d.due).length;

  // ---- KPIs
  const lastWeek = stats.day(db, f.addDays(bd, -7));
  const weekdayName = f.formatDay(f.addDays(bd, -7)).split(' ')[0];
  const lastWeekLabel = `vs last ${{ Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' }[weekdayName]}`;
  const occupancy = f.pct1(tonight.sold, tonight.rooms);
  const adr = Math.round(tonight.adr);
  const revpar = Math.round(tonight.revpar);
  const kpi = {
    occupancy, sold: tonight.sold, rooms: tonight.rooms,
    occupancyDelta: lastWeek ? Math.round((tonight.occupancy - lastWeek.occupancy) * 10) / 10 : null,
    adr: f.moneyParts(adr), revpar: f.moneyParts(revpar),
    adrDelta: lastWeek ? adr - lastWeek.adr : null,
    revparDelta: lastWeek && lastWeek.revpar ? Math.round(((tonight.revpar / lastWeek.revpar) - 1) * 1000) / 10 : null,
    lastWeekLabel,
  };
  kpi.occupancyTrend = kpi.occupancyDelta === null ? null
    : { dir: trend(kpi.occupancyDelta), text: signed(kpi.occupancyDelta, `${Math.abs(kpi.occupancyDelta).toFixed(1)} pts`) };
  kpi.adrTrend = kpi.adrDelta === null ? null : { dir: trend(kpi.adrDelta), text: signed(kpi.adrDelta, f.money(Math.abs(kpi.adrDelta))) };
  kpi.revparTrend = kpi.revparDelta === null ? null : { dir: trend(kpi.revparDelta), text: signed(kpi.revparDelta, `${Math.abs(kpi.revparDelta).toFixed(1)}%`) };

  const spark = (key, exact) => {
    const values = stats.trend(db, bd, 12, key);
    const first = values[0];
    const last = values[values.length - 1];
    return {
      data: values.map((v) => (v / 100).toFixed(1)).join(','),
      label: `${key === 'adr' ? 'ADR' : 'RevPAR'} over the last ${values.length} days, ${last > first ? 'rising' : last < first ? 'falling' : 'steady'} from ${f.money(Math.round(first))} to ${f.money(exact)}`,
    };
  };
  const sparkAdr = spark('adr', adr);
  const sparkRevpar = spark('revpar', revpar);

  // ---- revenue
  const weeks = stats.weeklyRevenue(db, bd, 12).map((w) => ({ ...w, label: f.dayMonth(w.week) }));
  const revenueTotal = weeks.reduce((sum, w) => sum + w.total, 0);

  // ---- room status
  const ooo = states.filter((r) => r.status === 'ooo').map((r) => `${r.number} until ${r.block.end_date === f.addDays(bd, 1) ? 'tomorrow' : f.dayMonth(r.block.end_date)}`);
  let dirtyNote;
  if (!roomCounts.dirty) dirtyNote = 'Nothing waiting for a clean';
  else if (roomCounts.dirtyWithArrival === roomCounts.dirty) dirtyNote = roomCounts.dirty === 1 ? 'It has an arrival today' : `All ${f.numberWord(roomCounts.dirty).toLowerCase()} with arrivals today`;
  else if (!roomCounts.dirtyWithArrival) dirtyNote = 'None with an arrival today';
  else dirtyNote = `${roomCounts.dirtyWithArrival} with ${roomCounts.dirtyWithArrival === 1 ? 'an arrival' : 'arrivals'} today`;

  const attendantsOnShift = db.get('SELECT COUNT(DISTINCT attendant_id) AS n FROM housekeeping_tasks WHERE task_date = ? AND attendant_id IS NOT NULL', bd).n;
  const hkPercent = tasks.total ? Math.round((tasks.done / tasks.total) * 100) : 0;

  // ---- handover notes (latest four, oldest first)
  const handover = db.all(
    `SELECT h.*, u.avatar_tone FROM handover_notes h LEFT JOIN users u ON u.id = h.author_id ORDER BY h.created_at DESC, h.id DESC LIMIT 4`,
  ).reverse().map((h) => ({
    ...h, initials: f.initials(h.author_name),
    when: h.created_at.slice(0, 10) === bd ? f.clock(h.created_at) : `${f.formatDay(h.created_at)} ${f.clock(h.created_at)}`,
  }));

  const needClean = roomCounts.dirtyWithArrival;
  const lead = `${f.plural(arrivals.length, 'arrival', 'arrivals')} and ${f.plural(departures.length, 'departure', 'departures')} today. ` + (needClean
    ? `${f.numberWord(needClean)} ${needClean === 1 ? 'room still needs a clean before its guest arrives' : 'rooms still need a clean before their guests arrive'}.`
    : 'Every arriving guest’s room is ready.');

  return {
    kicker: `${f.longDate(bd)} · ${shell.user.shiftLabel}`,
    greeting: `${greeting(now.time)}, ${user.name.split(' ')[0]}`,
    lead, kpi, sparkAdr, sparkRevpar, weeks, revenueTotal,
    currencyName: CURRENCY_NAMES[settings.currency_code] || settings.currency_code,
    arrivals, arrived, departures, stillIn, checkedOut: departures.length - stillIn,
    roomCounts, ooo: ooo.length ? ooo.join(' · ') : 'None today', dirtyNote, attendantsOnShift, hkPercent, tasks, handover,
  };
}

module.exports = { build, greeting };
