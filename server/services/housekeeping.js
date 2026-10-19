'use strict';
/* Housekeeping tasks for the business date, grouped by floor with progress figures. */
const f = require('../lib/format');
const { attendants } = require('./rooms');

const KINDS = [['departure', 'Departure cleans'], ['stayover', 'Stayover services'], ['maintenance', 'Engineering prep']];
const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);

function tasksFor(db, bd) {
  const tasks = db.all(
    `SELECT t.*, rm.number AS room_number, rm.floor, rt.name AS type_name, u.code AS attendant_code, u.name AS attendant_name
       FROM housekeeping_tasks t JOIN rooms rm ON rm.id = t.room_id JOIN room_types rt ON rt.id = rm.room_type_id
       LEFT JOIN users u ON u.id = t.attendant_id
      WHERE t.task_date = ?`, bd,
  );
  const leaving = new Set(db.all("SELECT room_id FROM reservations WHERE status = 'checked_in' AND departure <= ? AND room_id IS NOT NULL", bd).map((r) => r.room_id));
  const arriving = new Map();
  for (const r of db.all("SELECT room_id, eta FROM reservations WHERE status = 'confirmed' AND arrival = ? AND room_id IS NOT NULL ORDER BY eta NULLS FIRST, id", bd)) {
    if (!arriving.has(r.room_id)) arriving.set(r.room_id, r);
  }
  const perRoom = {};
  for (const t of tasks) perRoom[t.room_id] = (perRoom[t.room_id] || 0) + 1;

  return tasks.map((t) => {
    const tags = [];
    let priority = t.kind === 'maintenance' ? 1 : t.kind === 'stayover' ? 3 : 2;
    if (t.kind === 'departure' && t.done_at) tags.push({ cls: 'chip', text: 'Inspected' });
    else if (t.kind === 'departure' && leaving.has(t.room_id)) {
      tags.push({ cls: 'chip chip--blue', text: 'Waiting for checkout' });
      priority = 4;
    } else if (t.kind === 'departure' && arriving.has(t.room_id)) {
      const eta = arriving.get(t.room_id).eta;
      tags.push({ cls: 'chip chip--amber', text: eta ? `Rush · arrival ${eta}` : 'Rush · arriving today' });
      priority = 0;
    }
    if (t.note) tags.push({ cls: t.note_tone ? `chip chip--${t.note_tone}` : 'chip', text: t.note });
    return {
      ...t, tags, priority, done: Boolean(t.done_at), initials: t.attendant_name ? f.initials(t.attendant_name) : '—',
      domId: perRoom[t.room_id] > 1 ? `task-${t.room_number}-${t.id}` : `task-${t.room_number}`,
    };
  });
}

const order = (a, b) => (a.done !== b.done ? (a.done ? 1 : -1)
  : (a.done ? 0 : a.priority - b.priority) || (Number(a.room_number) || 0) - (Number(b.room_number) || 0) || a.id - b.id);

function page(db, shell) {
  const { bd, settings } = shell;
  const tasks = tasksFor(db, bd).sort(order);
  const people = attendants(db);
  const done = tasks.filter((t) => t.done).length;
  const working = people.filter((a) => tasks.some((t) => t.attendant_id === a.id));
  const floors = [...new Set(tasks.map((t) => t.floor))].sort((a, b) => a - b).map((number) => {
    const list = tasks.filter((t) => t.floor === number);
    const lead = people.find((a) => a.floor === number);
    const floaters = people.filter((a) => a.floor === null && list.some((t) => t.attendant_id === a.id));
    // Attendants whose home floor is another one but who look after rooms here (e.g. "Floors 4–5").
    const covering = people.filter((a) => a.floor !== null && a.floor !== number && list.some((t) => t.attendant_id === a.id));
    const names = [lead ? lead.name : null, ...covering.map((a) => a.name), ...floaters.map((a) => `${a.name} on rush`)].filter(Boolean);
    const floorDone = list.filter((t) => t.done).length;
    return { number, subtitle: names.join(' · ') || 'Unassigned', tasks: list, done: floorDone, total: list.length, pct: pct(floorDone, list.length) };
  });
  const morning = (settings.shifts && settings.shifts.morning) || ['07:00', '15:00'];
  return {
    tasks, floors, done, total: tasks.length, percent: pct(done, tasks.length), open: tasks.length - done,
    kinds: KINDS.map(([kind, label]) => {
      const list = tasks.filter((t) => t.kind === kind);
      const kDone = list.filter((t) => t.done).length;
      return { kind, label, done: kDone, total: list.length, pct: pct(kDone, list.length) };
    }).filter((k) => k.total > 0),
    team: working.map((a) => {
      const mine = tasks.filter((t) => t.attendant_id === a.id);
      const mDone = mine.filter((t) => t.done).length;
      return { ...a, done: mDone, total: mine.length, left: mine.filter((t) => !t.done).reduce((sum, t) => sum + t.minutes, 0), pct: pct(mDone, mine.length) };
    }),
    attendants: people,
    shiftHours: `${morning[0]}–${morning[1]}`,
    kicker: `Operations · ${shell.user.shiftLabel.toLowerCase()}`,
  };
}

module.exports = { page, tasksFor };
