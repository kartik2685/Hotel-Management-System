'use strict';
/*
 * Database setup.
 *   npm run seed                      -> demo hotel (The Harlow Hotel) with demo staff accounts
 *   npm run seed -- --force           -> wipe the database first
 *   npm run seed -- --empty --admin-email you@hotel.com --admin-name "Your Name"
 *                                     -> empty hotel with one admin account (password printed once)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { open } = require('./index');
const { hashPassword } = require('../lib/auth');
const settingsService = require('../services/settings');

const DEMO = path.join(__dirname, 'demo-data.json');

function planAdjust(text) {
  if (text.endsWith('%')) return { type: 'percent', value: Number(text.slice(0, -1)) };
  return { type: 'amount', value: Math.round(Number(text) * 100) };
}

async function loadDemo(db, { password = config.demoPassword } = {}) {
  const data = JSON.parse(fs.readFileSync(DEMO, 'utf8'));
  const hashes = {};
  for (const u of data.users) hashes[u.key] = await hashPassword(password);
  const created = '2026-01-05 09:00';

  db.tx(() => {
    const settings = { ...data.settings, currency_locale: 'en-US', default_room_type: 'DK', confirmation_prefix: 'HLW' };
    for (const [key, value] of Object.entries(settings)) db.run('INSERT INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));

    const userId = {};
    const userByName = {};
    for (const u of data.users) {
      const r = db.run(
        `INSERT INTO users (name, email, password_hash, role, title, department, shift, code, area, floor, avatar_tone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        u.name, u.email, hashes[u.key], u.role, u.title, u.department, u.shift, u.key, u.area || null, u.floor ?? null, u.tone || '', created,
      );
      userId[u.key] = Number(r.lastInsertRowid);
      userByName[u.name] = userId[u.key];
    }

    const typeId = {};
    for (const t of data.roomTypes) {
      const r = db.run(
        'INSERT INTO room_types (code, name, base_rate_cents, max_guests, clean_minutes, service_minutes, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
        t.code, t.name, t.baseRate * 100, t.maxGuests, t.cleanMinutes, t.serviceMinutes, t.sort,
      );
      typeId[t.code] = Number(r.lastInsertRowid);
    }
    const roomId = {};
    for (const room of data.rooms) {
      const r = db.run(
        'INSERT INTO rooms (number, floor, room_type_id, hk_status, attendant_id, hk_updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        room.number, room.floor, typeId[room.type], room.hk, room.attendant ? userId[room.attendant] : null, data.hkUpdatedAt,
      );
      roomId[room.number] = Number(r.lastInsertRowid);
    }
    for (const b of data.blocks) {
      db.run('INSERT INTO room_blocks (room_id, start_date, end_date, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        roomId[b.room], b.start, b.end, b.reason, userId.gp, `${b.start} 09:00`);
    }

    const planId = {};
    for (const p of data.ratePlans) {
      const adjust = planAdjust(p.adjust);
      const r = db.run('INSERT INTO rate_plans (code, name, adjust_type, adjust_value, description, bookable, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
        p.code, p.name, adjust.type, adjust.value, p.description, p.bookable ? 1 : 0, p.sort);
      planId[p.code] = Number(r.lastInsertRowid);
    }
    for (const x of data.extras) {
      db.run('INSERT INTO extras (code, name, price_cents, per, sort) VALUES (?, ?, ?, ?, ?)', x.code, x.name, x.price * 100, x.per, x.sort);
    }
    const sourceId = {};
    for (const s of data.sources) {
      const r = db.run('INSERT INTO sources (name, kind, sort, form_sort) VALUES (?, ?, ?, ?)', s.name, s.kind, s.sort, s.formSort);
      sourceId[s.name] = Number(r.lastInsertRowid);
    }

    const guestId = {};
    for (const g of data.guests) {
      const prior = g.prior || { stays: 0, nights: 0, spend: 0 };
      const r = db.run(
        `INSERT INTO guests (first_name, last_name, email, phone, city, company, vip, corporate, preferences, prior_stays, prior_nights, prior_spend_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        g.first, g.last, g.email, g.phone, g.city, g.company, g.vip ? 1 : 0, g.corporate ? 1 : 0, JSON.stringify(g.prefs || {}),
        prior.stays, prior.nights, prior.spend, g.createdAt,
      );
      guestId[g.key] = Number(r.lastInsertRowid);
    }
    for (const n of data.guestNotes) {
      db.run('INSERT INTO guest_notes (guest_id, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)',
        guestId[n.guest], userByName[n.author] || null, n.author, n.body, n.date);
    }

    for (const r of data.reservations) {
      db.run(
        `INSERT INTO reservations (confirmation, guest_id, room_type_id, room_id, arrival, departure, adults, children, rate_plan_id,
           nightly_rate_cents, source_id, status, eta, checked_in_at, checked_out_at, cancelled_at, tags, notes, requests,
           room_total_cents, tax_cents, extras_cents, total_cents, paid_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.conf, guestId[r.guest], typeId[r.type], r.room ? roomId[r.room] : null, r.arrival, r.departure, r.adults, r.children, planId[r.plan],
        r.rate, sourceId[r.source], r.status, r.eta, r.checkedInAt, r.checkedOutAt, r.cancelledAt, JSON.stringify(r.tags), r.notes, r.requests,
        r.roomTotal, r.tax, r.extras, r.total, r.paid, r.createdAt,
      );
    }

    for (const t of data.tasks) {
      db.run(
        `INSERT INTO housekeeping_tasks (task_date, room_id, kind, title, minutes, attendant_id, note, note_tone, done_at, done_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        data.businessDate, roomId[t.room], t.kind, t.title, t.minutes, userId[t.attendant], t.note, t.noteTone, t.done, t.done ? userId[t.attendant] : null,
      );
    }
    for (const h of data.handover) {
      db.run('INSERT INTO handover_notes (author_id, author_name, department, lead, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        userByName[h.author] || null, h.author, h.department, h.lead, h.body, h.createdAt);
    }
    for (const n of data.notifications) {
      db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)', n.icon, n.tone, n.title, n.detail, n.createdAt);
    }
    for (const s of data.dailyStats) {
      db.run(
        'INSERT INTO daily_stats (date, rooms_available, rooms_sold, room_revenue_cents, adr_cents, revpar_cents, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        s.date, s.roomsAvailable, s.roomsSold, s.roomRevenue, s.adr, s.revpar, `${s.date} 23:59`,
      );
    }
    for (const w of data.revenue) {
      for (const outlet of ['rooms', 'fnb', 'spa']) db.run('INSERT INTO revenue (date, outlet, amount_cents) VALUES (?, ?, ?)', w.date, outlet, w[outlet]);
    }
    db.run("INSERT INTO activity_log (user_id, user_name, action, summary, created_at) VALUES (NULL, 'System', 'setup.demo', 'Demo data loaded', ?)",
      `${data.businessDate} 06:00`);
  });
  settingsService.reset();
  return { users: data.users.map((u) => ({ email: u.email, role: u.role })), password };
}

async function createEmptyHotel(db, { email, name, hotelName }) {
  const password = crypto.randomBytes(9).toString('base64url');
  const hash = await hashPassword(password);
  db.tx(() => {
    const settings = { ...settingsService.DEFAULTS, hotel_name: hotelName || 'My Hotel', business_date_mode: 'auto' };
    for (const [key, value] of Object.entries(settings)) db.run('INSERT INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));
    db.run(`INSERT INTO users (name, email, password_hash, role, title, department, shift, code, avatar_tone, must_change_password, created_at)
            VALUES (?, ?, ?, 'admin', 'Administrator', 'Management', 'morning', 'ad', 'gold', 1, datetime('now'))`, name || 'Administrator', email, hash);
    db.run("INSERT INTO sources (name, kind, sort, form_sort) VALUES ('Walk-in', 'walk_in', 1, 1), ('Phone', 'direct', 2, 2), ('Website', 'direct', 3, 3)");
    db.run("INSERT INTO rate_plans (code, name, adjust_type, adjust_value, description, sort) VALUES ('BAR', 'Best available', 'amount', 0, 'Flexible rate', 1)");
  });
  settingsService.reset();
  return { email, password };
}

const isEmpty = (db) => db.get('SELECT COUNT(*) AS n FROM users').n === 0;

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const file = option('--db') || config.dbPath;
  if (args.includes('--force')) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  }
  const db = open(file);
  if (!isEmpty(db)) {
    console.error(`The database ${file} already has data. Run with --force to wipe it first.`);
    process.exit(1);
  }
  if (args.includes('--empty')) {
    const email = option('--admin-email');
    if (!email) {
      console.error('Add --admin-email you@hotel.com (and optionally --admin-name "Your Name" --hotel "Hotel name").');
      process.exit(1);
    }
    const result = await createEmptyHotel(db, { email, name: option('--admin-name'), hotelName: option('--hotel') });
    console.log(`Empty hotel created in ${file}.\nSign in as ${result.email} with the password ${result.password}\n(you will be asked to change it).`);
  } else {
    const result = await loadDemo(db);
    console.log(`Demo hotel loaded into ${file}.\nSign in as ${result.users[0].email} with the password ${result.password}`);
  }
  db.close();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { loadDemo, createEmptyHotel, isEmpty };
