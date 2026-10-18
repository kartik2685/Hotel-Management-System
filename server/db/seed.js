'use strict';
/*
 * Database setup (the SQLite file in DB_PATH, or the PostgreSQL database in DATABASE_URL when set).
 *   npm run seed                      -> demo hotel (The Harlow Hotel) with demo staff accounts
 *   npm run seed -- --force           -> wipe the database first (on Postgres: drops the app's tables only)
 *   npm run seed -- --empty --admin-email you@hotel.com --admin-name "Your Name"
 *                                     -> empty hotel with one admin account (password printed once)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { open, isPostgres } = require('./index');
const TABLES = require('./tables');
const { hashPassword } = require('../lib/auth');
const settingsService = require('../services/settings');

const DEMO = path.join(__dirname, 'demo-data.json');

/* Demo hotel extras that are not in demo-data.json (website, invoices, registration). */
const DEMO_SETTINGS = {
  currency_locale: 'en-US', default_room_type: 'DK', confirmation_prefix: 'HLW', country: 'US', require_grc: false,
  hotel_address: '400 North Wabash Avenue, Chicago, IL 60611', hotel_phone: '+1 (312) 555-0100', hotel_email: 'stay@harlowhotel.example',
  invoice_prefix: 'HLW', site_enabled: true,
  site_tagline: 'An art deco hotel on the river, two blocks from the Magnificent Mile.',
  site_intro: 'Forty-eight quiet rooms above the Chicago River, breakfast at Linden every morning and a front desk that remembers how you take your coffee.',
  site_amenities: ['Fast Wi-Fi in every room', 'Breakfast at Linden, 06:30–10:30', '24-hour front desk', 'Valet parking', 'Fitness room', 'Airport transfers'],
  site_policies: 'Check-in from 15:00, check-out by 12:00. Free cancellation up to 48 hours before arrival unless your rate says otherwise. Pets by arrangement.',
};
const ROOM_CONTENT = [
  ['CQ', 'A calm, light room with a queen bed, a writing desk by the window and a walk-in rain shower.', 'Queen bed', 24],
  ['CT', 'Two single beds, a reading chair by the window and room to unpack — good for friends or colleagues.', 'Two single beds', 24],
  ['DK', 'Our most-booked room: a king bed with a velvet headboard, an armchair by the window and the skyline at sunset.', 'King bed', 30],
  ['JS', 'A king bedroom opening onto its own sitting room with a sofa — made for longer stays and small families.', 'King bed and sofa', 42],
  ['HS', 'The corner suite on the top floor, with a living room, a bar cart and views over the river and the lake.', 'King bed and living room', 68],
];
const ROOM_PHOTOS = { CQ: 'classic-queen.jpg', CT: 'classic-twin.jpg', DK: 'deluxe-king.jpg', JS: 'junior-suite.jpg', HS: 'harlow-suite.jpg' };
const NATIONALITY = { Georgia: 'US', Illinois: 'US', California: 'US', Massachusetts: 'US', Texas: 'US', Washington: 'US', Minnesota: 'US', Sweden: 'SE', Quebec: 'CA', Denmark: 'DK' };
const nationalityFor = (city) => (city ? NATIONALITY[city.split(', ').pop()] || null : null);

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
    const insertId = (sql, ...params) => db.get(`${sql} RETURNING id`, ...params).id;
    const settings = { ...data.settings, ...DEMO_SETTINGS, site_secret: crypto.randomBytes(32).toString('base64url') };
    for (const [key, value] of Object.entries(settings)) db.run('INSERT INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));

    const userId = {};
    const userByName = {};
    for (const u of data.users) {
      userId[u.key] = insertId(
        `INSERT INTO users (name, email, password_hash, role, title, department, shift, code, area, floor, avatar_tone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        u.name, u.email, hashes[u.key], u.role, u.title, u.department, u.shift, u.key, u.area || null, u.floor ?? null, u.tone || '', created,
      );
      userByName[u.name] = userId[u.key];
    }

    const typeId = {};
    for (const t of data.roomTypes) {
      typeId[t.code] = insertId(
        'INSERT INTO room_types (code, name, base_rate_cents, max_guests, clean_minutes, service_minutes, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
        t.code, t.name, t.baseRate * 100, t.maxGuests, t.cleanMinutes, t.serviceMinutes, t.sort,
      );
    }
    const roomId = {};
    for (const room of data.rooms) {
      roomId[room.number] = insertId(
        'INSERT INTO rooms (number, floor, room_type_id, hk_status, attendant_id, hk_updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        room.number, room.floor, typeId[room.type], room.hk, room.attendant ? userId[room.attendant] : null, data.hkUpdatedAt,
      );
    }
    for (const b of data.blocks) {
      db.run('INSERT INTO room_blocks (room_id, start_date, end_date, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        roomId[b.room], b.start, b.end, b.reason, userId.gp, `${b.start} 09:00`);
    }

    const planId = {};
    for (const p of data.ratePlans) {
      const adjust = planAdjust(p.adjust);
      planId[p.code] = insertId('INSERT INTO rate_plans (code, name, adjust_type, adjust_value, description, bookable, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
        p.code, p.name, adjust.type, adjust.value, p.description, p.bookable ? 1 : 0, p.sort);
    }
    for (const x of data.extras) {
      db.run('INSERT INTO extras (code, name, price_cents, per, sort) VALUES (?, ?, ?, ?, ?)', x.code, x.name, x.price * 100, x.per, x.sort);
    }
    const sourceId = {};
    for (const s of data.sources) {
      sourceId[s.name] = insertId('INSERT INTO sources (name, kind, sort, form_sort) VALUES (?, ?, ?, ?)', s.name, s.kind, s.sort, s.formSort);
    }

    const guestId = {};
    for (const g of data.guests) {
      const prior = g.prior || { stays: 0, nights: 0, spend: 0 };
      guestId[g.key] = insertId(
        `INSERT INTO guests (first_name, last_name, email, phone, city, company, vip, corporate, preferences, prior_stays, prior_nights, prior_spend_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        g.first, g.last, g.email, g.phone, g.city, g.company, g.vip ? 1 : 0, g.corporate ? 1 : 0, JSON.stringify(g.prefs || {}),
        prior.stays, prior.nights, prior.spend, g.createdAt,
      );
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
    // ---- version 2: website content, cancellation rules, nationalities, payment history
    for (const [code, description, bed, size] of ROOM_CONTENT) {
      db.run('UPDATE room_types SET description = ?, bed = ?, size_sqm = ?, photo = ? WHERE code = ?', description, bed, size, ROOM_PHOTOS[code], code);
    }
    for (const [code, days, online] of [['BAR', 2, 1], ['BB', 2, 1], ['ADV', null, 1], ['CORP', 1, 0]]) {
      db.run('UPDATE rate_plans SET free_cancel_days = ?, online = ? WHERE code = ?', days, online, code);
    }
    for (const g of data.guests) {
      const country = nationalityFor(g.city);
      if (country) db.run('UPDATE guests SET nationality = ? WHERE id = ?', country, guestId[g.key]);
    }
    db.run(`INSERT INTO payments (reservation_id, amount_cents, method, reference, taken_by_name, created_at)
            SELECT id, paid_cents, 'Card', 'Paid before the system went live', 'Imported', COALESCE(checked_in_at, created_at) FROM reservations WHERE paid_cents > 0`);
    db.run("INSERT INTO activity_log (user_id, user_name, action, summary, created_at) VALUES (NULL, 'System', 'setup.demo', 'Demo data loaded', ?)",
      `${data.businessDate} 06:00`);
  });
  settingsService.reset();
  return { users: data.users.map((u) => ({ email: u.email, role: u.role })), password };
}

async function createEmptyHotel(db, { email, name, hotelName, password: chosen } = {}) {
  // A password chosen by the owner is kept; a generated one has to be changed at first sign-in.
  const password = chosen || crypto.randomBytes(9).toString('base64url');
  const hash = await hashPassword(password);
  db.tx(() => {
    const settings = { ...settingsService.DEFAULTS, hotel_name: hotelName || 'My Hotel', business_date_mode: 'auto', site_secret: crypto.randomBytes(32).toString('base64url') };
    for (const [key, value] of Object.entries(settings)) db.run('INSERT INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));
    db.run(`INSERT INTO users (name, email, password_hash, role, title, department, shift, code, avatar_tone, must_change_password, created_at)
            VALUES (?, ?, ?, 'admin', 'Administrator', 'Management', 'morning', 'ad', 'gold', ?, ?)`, name || 'Administrator', email, hash, chosen ? 0 : 1,
      new Date().toISOString().slice(0, 19).replace('T', ' '));
    db.run("INSERT INTO sources (name, kind, sort, form_sort) VALUES ('Walk-in', 'walk_in', 1, 1), ('Phone', 'direct', 2, 2), ('Website', 'direct', 3, 3)");
    db.run("INSERT INTO rate_plans (code, name, adjust_type, adjust_value, description, sort) VALUES ('BAR', 'Best available', 'amount', 0, 'Flexible rate', 1)");
  });
  settingsService.reset();
  return { email, password };
}

const isEmpty = (db) => db.get('SELECT COUNT(*) AS n FROM users').n === 0;

/* What a new, empty database starts with when the server starts (server/index.js):
   - ADMIN_EMAIL set: an empty hotel for real use, with that admin account. ADMIN_PASSWORD sets its
     password; without it a one-time password is printed once and must be changed at first sign-in.
   - otherwise the demo hotel. On a live server (NODE_ENV=production) its staff password comes from
     DEMO_PASSWORD, or is random and printed once; never the public default from the README.
   Returns { kind, email, password }; password is null when it came from the environment. */
async function firstRun(db, env = process.env) {
  for (const name of ['ADMIN_PASSWORD', 'DEMO_PASSWORD']) {
    const value = env[name];
    if (value && (value.length < 8 || value.length > 200)) throw new Error(`${name} must be 8 to 200 characters long.`);
  }
  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`ADMIN_EMAIL is not an email address: ${email}`);
    const result = await createEmptyHotel(db, { email, name: env.ADMIN_NAME, hotelName: env.HOTEL_NAME, password: env.ADMIN_PASSWORD });
    return { kind: 'empty', email, password: env.ADMIN_PASSWORD ? null : result.password };
  }
  const live = env.NODE_ENV === 'production';
  const password = env.DEMO_PASSWORD || (live ? crypto.randomBytes(9).toString('base64url') : 'harlow-demo');
  const result = await loadDemo(db, { password });
  return { kind: 'demo', email: result.users[0].email, password: env.DEMO_PASSWORD ? null : password };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const target = option('--db') || config.databaseUrl || config.dbPath;
  if (args.includes('--force')) {
    if (isPostgres(target)) {
      const old = open(target);
      old.exec(`DROP TABLE IF EXISTS ${['app_meta', ...TABLES].join(', ')} CASCADE`);
      old.close();
    } else {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
    }
  }
  const db = open(target);
  const file = db.label;
  if (!isEmpty(db)) {
    console.error(`The database (${file}) already has data. Run with --force to wipe it first.`);
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

module.exports = { loadDemo, createEmptyHotel, isEmpty, firstRun };
