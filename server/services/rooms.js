'use strict';
/* Room states for a business date: occupied, vacant clean/dirty or out of order, with who is in or due. */
const f = require('../lib/format');

const STAY = `r.id, r.confirmation, r.arrival, r.departure, r.status, r.eta, r.checked_in_at, r.checked_out_at, r.adults, r.children,
  r.room_id, r.total_cents, r.paid_cents, g.first_name, g.last_name, g.vip`;

function roomStates(db, bd) {
  const rooms = db.all(
    `SELECT rm.id, rm.number, rm.floor, rm.hk_status, rm.attendant_id, rm.hk_updated_at, rt.name AS type_name, rt.code AS type_code,
            rt.clean_minutes, rt.service_minutes, u.code AS attendant_code, u.name AS attendant_name
       FROM rooms rm JOIN room_types rt ON rt.id = rm.room_type_id LEFT JOIN users u ON u.id = rm.attendant_id
      WHERE rm.active = 1 ORDER BY rm.floor, CAST(rm.number AS INTEGER), rm.number`,
  );
  const inHouse = new Map();
  for (const s of db.all(`SELECT ${STAY} FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.status = 'checked_in' AND r.room_id IS NOT NULL`)) {
    inHouse.set(s.room_id, s);
  }
  const arriving = new Map();
  for (const s of db.all(
    `SELECT ${STAY} FROM reservations r JOIN guests g ON g.id = r.guest_id
      WHERE r.arrival = ? AND r.status = 'confirmed' AND r.room_id IS NOT NULL ORDER BY r.eta`, bd,
  )) {
    if (!arriving.has(s.room_id)) arriving.set(s.room_id, s);
  }
  const blocks = new Map();
  for (const b of db.all('SELECT * FROM room_blocks WHERE start_date <= ? AND end_date > ? ORDER BY end_date', bd, bd)) {
    if (!blocks.has(b.room_id)) blocks.set(b.room_id, b);
  }
  const lastOut = new Map();
  for (const row of db.all(
    `SELECT room_id, MAX(departure) AS last FROM reservations WHERE status = 'checked_out' AND departure <= ? AND room_id IS NOT NULL GROUP BY room_id`, bd,
  )) {
    lastOut.set(row.room_id, row.last);
  }

  return rooms.map((room) => {
    const block = blocks.get(room.id) || null;
    const occupant = inHouse.get(room.id) || null;
    const arrival = arriving.get(room.id) || null;
    let status = room.hk_status; // vacant: clean or dirty
    let occupancy = 'vacant';
    if (block) {
      status = 'ooo';
      occupancy = 'ooo';
    } else if (occupant) {
      status = 'occupied';
      occupancy = 'occupied';
    }
    return { ...room, block, occupant, arrival, lastOut: lastOut.get(room.id) || null, status, occupancy };
  });
}

/* Counts used by the sidebar, dashboard and room board. */
function summarize(states) {
  const count = (fn) => states.filter(fn).length;
  return {
    total: states.length,
    occupied: count((r) => r.status === 'occupied'),
    occupiedClean: count((r) => r.status === 'occupied' && r.hk_status === 'clean'),
    occupiedDirty: count((r) => r.status === 'occupied' && r.hk_status === 'dirty'),
    clean: count((r) => r.status === 'clean'),
    dirty: count((r) => r.status === 'dirty'),
    dirtyWithArrival: count((r) => r.status === 'dirty' && r.arrival),
    ooo: count((r) => r.status === 'ooo'),
    floors: new Set(states.map((r) => r.floor)).size,
  };
}

/* Room card text, e.g. "Night 4 of 7 · out Mon 28 Sep". */
function cardText(room, bd, checkOutTime) {
  if (room.status === 'ooo') {
    return { icon: 'wrench', guest: room.block.reason, note: `Back in service ${f.formatDay(room.block.end_date)}` };
  }
  if (room.occupant) {
    const s = room.occupant;
    const nights = f.daysBetween(s.arrival, s.departure);
    let note;
    if (s.departure <= bd) note = `Due out today by ${checkOutTime}`;
    else if (s.arrival === bd && s.checked_in_at) note = `Checked in ${f.clock(s.checked_in_at)} · ${f.plural(nights, 'night', 'nights')}`;
    else note = `Night ${f.daysBetween(s.arrival, bd) + 1} of ${nights} · out ${f.formatDay(s.departure)}`;
    return { icon: 'user', guest: f.shortName(s.first_name, s.last_name), note };
  }
  const since = !room.lastOut ? 'empty' : room.lastOut === bd ? 'vacated this morning' : `empty since ${f.dayMonth(room.lastOut)}`;
  if (room.arrival) {
    const eta = room.arrival.eta ? `Arrives ${room.arrival.eta}` : 'Arrives today';
    return { icon: 'luggage', guest: f.shortName(room.arrival.first_name, room.arrival.last_name), note: since === 'empty' ? eta : `${eta} · ${since}` };
  }
  return { icon: 'bed', guest: 'No arrival today', note: since === 'empty' ? 'Ready to sell' : since.charAt(0).toUpperCase() + since.slice(1) };
}

module.exports = { roomStates, summarize, cardText };

/* ---------------------------------------------------------------- page model */
const OCCUPANCY_LABEL = { occupied: 'Occupied', vacant: 'Vacant', ooo: 'Out of order' };

function attendants(db) {
  return db.all(
    `SELECT id, code, name, floor, area, avatar_tone FROM users
      WHERE role = 'housekeeping' AND active = 1 AND (floor IS NOT NULL OR area IS NOT NULL)
      ORDER BY floor IS NULL, floor, name`,
  ).map((a) => ({ ...a, short: f.firstAndInitial(a.name), initials: f.initials(a.name) }));
}

function page(db, shell, { canEdit, canAssign }) {
  const { states, roomCounts, settings, bd, now } = shell;
  const people = attendants(db);
  const tasks = db.all('SELECT room_id, kind, done_at FROM housekeeping_tasks WHERE task_date = ?', bd);
  const flagsFor = (r) => {
    const flags = [];
    const vip = (r.occupant && r.occupant.vip) || (!r.occupant && r.arrival && r.arrival.vip);
    if (vip) flags.push({ cls: 'chip chip--gold', text: 'VIP' });
    if (r.occupant && r.occupant.departure <= bd) flags.push({ cls: 'chip chip--blue', text: 'Due out' });
    if (r.status === 'dirty' && r.arrival) flags.push({ cls: 'chip chip--amber', text: 'Rush' });
    const cleaned = tasks.find((t) => t.room_id === r.id && t.kind === 'departure' && t.done_at);
    if (r.status === 'clean' && cleaned) flags.push({ cls: 'chip', text: `Cleaned ${f.clock(cleaned.done_at)}` });
    const stayover = r.occupant && r.occupant.departure > bd && !(r.occupant.arrival === bd);
    if (stayover && !vip && !tasks.some((t) => t.room_id === r.id && t.kind === 'stayover')) flags.push({ cls: 'chip', text: 'Service declined' });
    return flags;
  };
  const floors = [...new Set(states.map((r) => r.floor))].sort((a, b) => a - b).map((number) => {
    const list = states.filter((r) => r.floor === number);
    const count = (s) => list.filter((r) => r.status === s).length;
    const parts = [`${count('occupied')} occupied`, `${count('clean')} clean`, `${count('dirty')} dirty`];
    if (count('ooo')) parts.push(`${count('ooo')} out of order`);
    return {
      number, stats: parts.join(' · '), lead: people.find((a) => a.floor === number) || null,
      rooms: list.map((r) => ({ ...r, occupancyLabel: OCCUPANCY_LABEL[r.occupancy], text: cardText(r, bd, settings.check_out_time), flags: flagsFor(r) })),
    };
  });
  const latest = states.reduce((max, r) => (r.hk_updated_at && r.hk_updated_at > max ? r.hk_updated_at : max), '');
  const updated = !latest ? 'today' : latest.slice(0, 10) === now.date ? f.clock(latest) : f.formatDay(latest);
  return { counts: roomCounts, floors, attendants: people, updated, canEdit, canAssign };
}

module.exports.page = page;
module.exports.attendants = attendants;
