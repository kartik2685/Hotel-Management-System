'use strict';
/* Guest profiles: who to list, and everything one profile shows. */
const f = require('../lib/format');

const PREF_GROUPS = [['room', 'Room'], ['comfort', 'Comfort'], ['dining', 'Dining'], ['service', 'Service']];
const GROUP_ORDER = { arriving: 0, inhouse: 1, upcoming: 2, past: 3, new: 4 };

const slugify = (text) => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guest';

function slugFor(db, guest) {
  const same = db.get('SELECT COUNT(*) AS n FROM guests WHERE last_name = ? COLLATE NOCASE', guest.last_name).n;
  return same > 1 ? `${slugify(guest.last_name)}-${guest.id}` : slugify(guest.last_name);
}

function idFromSlug(db, slug) {
  const m = String(slug).match(/-(\d+)$/);
  if (m) return Number(m[1]);
  const g = db.get('SELECT id FROM guests WHERE last_name = ? COLLATE NOCASE ORDER BY id', slug.replace(/-/g, ' '))
    || db.all('SELECT id, last_name FROM guests').find((x) => slugify(x.last_name) === slug);
  return g ? g.id : null;
}

/* Current situation of a guest relative to the business date. */
function situation(db, guestId, bd) {
  const stays = db.all(
    `SELECT r.*, rt.name AS type_name, rm.number AS room_number, rp.name AS plan_name
       FROM reservations r JOIN room_types rt ON rt.id = r.room_type_id LEFT JOIN rooms rm ON rm.id = r.room_id
       LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id
      WHERE r.guest_id = ? AND r.status NOT IN ('cancelled', 'no_show') ORDER BY r.arrival DESC`, guestId,
  );
  const inHouse = stays.find((s) => s.status === 'checked_in');
  const arriving = stays.find((s) => s.status === 'confirmed' && s.arrival === bd);
  const upcoming = stays.filter((s) => ['confirmed', 'tentative'].includes(s.status) && s.arrival > bd).sort((a, b) => a.arrival.localeCompare(b.arrival))[0];
  const past = stays.find((s) => s.status === 'checked_out');
  let state = 'new';
  if (arriving) state = 'arriving';
  else if (inHouse) state = 'inhouse';
  else if (upcoming) state = 'upcoming';
  else if (past) state = 'past';
  return { stays, inHouse, arriving, upcoming, past, state };
}

const roomLabel = (s) => (s.room_number ? `${s.type_name} ${s.room_number}` : s.type_name);

function profile(db, guestId, bd) {
  const g = db.get('SELECT * FROM guests WHERE id = ?', guestId);
  if (!g) return null;
  const sit = situation(db, guestId, bd);
  const counted = sit.stays.filter((s) => ['checked_out', 'checked_in'].includes(s.status));
  const stays = g.prior_stays + counted.length;
  const nights = g.prior_nights + counted.reduce((sum, s) => sum + f.daysBetween(s.arrival, s.departure), 0);
  const spend = g.prior_spend_cents + counted.reduce((sum, s) => sum + s.total_cents, 0);
  const name = `${g.first_name} ${g.last_name}`;
  const slug = slugFor(db, g);

  const tags = [];
  if (g.vip) tags.push({ cls: 'chip chip--gold', text: 'VIP' });
  if (g.corporate) tags.push({ cls: 'chip chip--blue', text: 'Corporate' });
  else tags.push({ cls: 'chip', text: stays > 0 ? 'Returning' : 'First stay' });

  let now = { label: 'New guest', detail: 'No stays yet' };
  if (sit.arriving) {
    const s = sit.arriving;
    now = { label: 'Arriving today', detail: [roomLabel(s), s.eta ? `ETA ${s.eta}` : null, f.plural(f.daysBetween(s.arrival, s.departure), 'night', 'nights')].filter(Boolean).join(' · ') };
  } else if (sit.inHouse) {
    const s = sit.inHouse;
    const detail = s.arrival === bd && s.checked_in_at ? `checked in ${f.clock(s.checked_in_at)}` : `night ${Math.min(f.daysBetween(s.arrival, bd) + 1, f.daysBetween(s.arrival, s.departure))} of ${f.daysBetween(s.arrival, s.departure)}`;
    now = { label: 'In house', detail: `${roomLabel(s)} · ${detail}` };
  } else if (sit.upcoming) {
    now = { label: 'Upcoming', detail: `${roomLabel(sit.upcoming)} · ${f.dateRange(sit.upcoming.arrival, sit.upcoming.departure)}` };
  } else if (sit.past) {
    now = { label: 'Past guest', detail: `Last stay ${f.dateRange(sit.past.arrival, sit.past.departure)}` };
  }

  const prefs = JSON.parse(g.preferences || '{}');
  const notes = db.all('SELECT * FROM guest_notes WHERE guest_id = ? ORDER BY created_at DESC, id DESC', guestId)
    .map((n) => ({ body: n.body, by: `${n.author_name} · ${f.dayMonth(n.created_at, bd)}` }));
  const history = counted.slice(0, 5).map((s) => ({
    dates: f.dateRange(s.arrival, s.departure), room: s.room_number || '—', type: s.type_name, nights: f.daysBetween(s.arrival, s.departure),
    plan: s.plan_name || '—', inHouse: s.status === 'checked_in', spend: f.moneyWhole(s.total_cents),
  }));

  return {
    id: g.id, slug, name, initials: f.initials(name), vip: Boolean(g.vip), tags,
    contact: [
      g.email ? { icon: 'mail', email: g.email } : null, g.phone ? { icon: 'phone', text: g.phone } : null,
      g.city ? { icon: 'map-pin', text: g.city } : null, g.company ? { icon: 'building', text: g.company } : null,
    ].filter(Boolean),
    now,
    stats: { stays, nights, spend: f.moneyWhole(spend), average: nights ? f.moneyWhole(spend / nights) : '—' },
    prefs: PREF_GROUPS.map(([key, label]) => ({ label, items: prefs[key] || [] })).filter((p) => p.items.length),
    notes,
    history,
    historyNote: stays > history.length && history.length ? `Latest ${history.length} of ${stays} stays` : '',
    newToday: g.created_at.slice(0, 10) === bd,
    state: sit.state,
    sub: { arriving: `Arriving today · ${sit.arriving ? sit.arriving.room_number || sit.arriving.type_name : ''}`, inhouse: `In house · ${sit.inHouse ? sit.inHouse.room_number || '' : ''}`,
      upcoming: sit.upcoming ? `Next stay ${f.dayMonth(sit.upcoming.arrival)}` : '', past: sit.past ? `Last stay ${f.monthName(sit.past.departure)}` : '', new: 'New guest' }[sit.state],
  };
}

/* Guests on the profiles page: in house, arriving today, returning soon, or with saved details. */
function listIds(db, bd, query) {
  if (query) {
    const like = `%${query.replace(/[%_]/g, '')}%`;
    return db.all(
      `SELECT id FROM guests WHERE (first_name || ' ' || last_name) LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY last_name, first_name LIMIT 100`,
      like, like, like,
    ).map((r) => r.id);
  }
  return db.all(
    `SELECT DISTINCT g.id FROM guests g
      WHERE EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id = g.id AND r.status = 'checked_in')
         OR EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id = g.id AND r.status = 'confirmed' AND r.arrival = ?)
         OR (EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('confirmed', 'tentative') AND r.arrival > ? AND r.arrival <= ?)
             AND (g.prior_stays > 0 OR EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id = g.id AND r.status = 'checked_out')))
         OR g.preferences NOT IN ('{}', '')
         OR EXISTS (SELECT 1 FROM guest_notes n WHERE n.guest_id = g.id)`,
    bd, bd, f.addDays(bd, 7),
  ).map((r) => r.id);
}

function page(db, bd, { query = '', selected = null } = {}) {
  const ids = listIds(db, bd, query);
  if (selected && !ids.includes(selected)) ids.unshift(selected);
  const people = ids.map((id) => profile(db, id, bd)).filter(Boolean)
    .sort((a, b) => (b.vip - a.vip) || GROUP_ORDER[a.state] - GROUP_ORDER[b.state] || a.name.split(' ').slice(-1)[0].localeCompare(b.name.split(' ').slice(-1)[0]) || a.name.localeCompare(b.name));
  const active = people.find((p) => p.id === selected) || people[0] || null;
  return { people, active, query };
}

module.exports = { page, profile, idFromSlug, slugFor, situation };
