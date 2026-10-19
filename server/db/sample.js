'use strict';
/*
 * Sample hotel for trying the system out: a 25-room hotel in Kolkata with 17 staff, 50 guests and four weeks of
 * its life — bookings by phone, email, walk-in, travel sites and the website, registration cards (GRC) and
 * Form III, check-ins and check-outs, payments and refunds, GST invoices, housekeeping, handover notes and
 * night audits. Money is in rupees.
 *
 * Nothing is pasted into the tables. Every booking, payment, invoice and log line is made by the same code the
 * screens use, by the member of staff on duty, at the moment it "happened" (clock.at). So it reads like real
 * use, and every record can be opened and changed. What the sample added is remembered, so it can be taken out
 * again before the hotel starts real work.
 *
 *   npm run sample                  -> adds it to the database in DATABASE_URL / DB_PATH (a hotel with no rooms or guests yet)
 *   npm run sample -- --remove      -> takes it out again
 *   options: --by you@hotel.com (the admin named in the activity log), --site-url https://… (links in booking emails)
 * Admins have the same two buttons in Admin panel → Overview.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const f = require('../lib/format');
const clock = require('../lib/clock');
const activity = require('../lib/activity');
const { hashPassword, randomToken } = require('../lib/auth');
const settingsService = require('../services/settings');
const reservations = require('../services/reservations');
const billing = require('../services/billing');
const registration = require('../services/registration');
const guests = require('../services/guests');
const audit = require('../services/audit');
const stats = require('../services/stats');
const emails = require('../services/emails');
const website = require('../services/website');
const links = require('../services/signin-links');
const folio = require('../services/folio');
const DATA = require('./sample-data');

const ZONE = 'Asia/Kolkata';
const FIRST_AUDIT = -27; // the first business day closed with the system
const TRACKED = ['users', 'room_types', 'rooms', 'room_blocks', 'rate_plans', 'rate_seasons', 'extras', 'sources', 'guests', 'guest_notes', 'reservations',
  'folio_charges', 'booking_groups', 'housekeeping_tasks', 'handover_notes', 'notifications', 'activity_log', 'payments', 'invoices', 'outbox'];
const PHOTO_DIR = path.join(__dirname, '..', '..', 'assets', 'img', 'rooms');

const plusMinutes = (stamp, minutes) => new Date(Date.parse(`${stamp.replace(' ', 'T')}:00Z`) + minutes * 60000).toISOString().slice(0, 16).replace('T', ' ');
const hhmm = (hours, minutes) => {
  const total = hours * 60 + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const rupees = (cents) => (cents / 100).toFixed(2);
const roundRupees = (cents) => Math.round(cents / 100) * 100;
const hash = (text) => {
  let h = 7;
  for (const c of String(text)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return Math.abs(h);
};
const fail = (message) => Object.assign(new Error(message), { status: 422 });

/* ------------------------------------------------------------------ what is there */

/* The sample data currently in the hotel, or null. */
function info(db) {
  const s = settingsService.all(db).sample_data;
  return s ? { addedAt: s.added_at, addedBy: s.added_by, counts: s.counts } : null;
}

/* Why the sample can't be added to this hotel right now, or null when it can. */
function blocker(db) {
  if (info(db)) return 'The sample data is already in this hotel.';
  const count = (table) => db.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
  if (count('reservations') || count('guests')) return 'This hotel already has guests or bookings of its own, so the sample data is not added (it would mix with them).';
  if (count('rooms') || count('room_types')) return 'This hotel already has its own rooms. The sample data brings its own rooms, so it needs a hotel without any yet.';
  return null;
}

/* ------------------------------------------------------------------ adding */

/* A password for every sample staff account, shown once to whoever adds the sample. */
function makePassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(4);
  return `Staff-${Array.from(bytes, (b) => letters[b % letters.length]).join('')}-${crypto.randomInt(1000, 10000)}`;
}

/*
 * Adds the sample hotel. by: the person adding it ({ id, name }) or null for the command line.
 * siteUrl: the guest website's address, for the links in booking emails. Returns { password, counts, staff }.
 */
async function add(db, { by = null, siteUrl = '', password = makePassword() } = {}) {
  const problem = blocker(db);
  if (problem) throw fail(problem);
  const hashes = {};
  await Promise.all(DATA.STAFF.map(async (s) => { hashes[s.key] = await hashPassword(password); }));
  const unknown = await hashPassword(randomToken()); // invited accounts: nobody knows it
  const result = db.tx(() => {
    const again = blocker(db);
    if (again) throw fail(again);
    return new Sample(db, { siteUrl, hashes, unknown }).build(by);
  });
  settingsService.reset();
  return { ...result, password };
}

class Sample {
  constructor(db, { siteUrl, hashes, unknown }) {
    const now = clock.hotelNow(ZONE);
    this.db = db;
    this.today = now.date;
    this.now = `${now.date} ${now.time}`;
    this.siteUrl = String(siteUrl || '').replace(/\/+$/, '');
    this.hashes = hashes;
    this.unknown = unknown;
    this.events = [];
    this.seq = 0;
    this.needed = new Map();
    this.ids = { staff: {}, type: {}, room: {}, plan: {}, source: {}, extra: {}, group: {} };
    this.staff = Object.fromEntries(DATA.STAFF.map((s) => [s.key, s]));
    this.guest = Object.fromEntries(DATA.GUESTS.map((g) => [g.key, g]));
    const current = settingsService.all(db).hotel_name;
    const name = current && current !== settingsService.DEFAULTS.hotel_name ? current : DATA.FILL.hotel_name;
    this.domain = `${name.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'hotel'}.example.com`;
  }

  day(offset) { return f.addDays(this.today, offset); }
  at(offset, time) { return `${this.day(offset)} ${time}`; }
  offset(date) { return f.daysBetween(this.today, date.slice(0, 10)); }

  /* ---------------------------------------------------------------- who is on duty */
  works(key, offset) {
    const s = this.staff[key];
    if (s.until !== undefined && offset > s.until) return false;
    if (s.nights !== undefined) return ((offset % 2) + 2) % 2 === s.nights;
    return s.off === undefined || f.weekday(this.day(offset)) !== s.off;
  }

  nightAuditor(offset) { return ['sc', 'fa'].find((key) => this.works(key, offset)); }

  desk(stamp) {
    const offset = this.offset(stamp);
    const time = stamp.slice(11);
    if (time >= '23:00') return this.nightAuditor(offset);
    if (time < '07:00') return this.nightAuditor(offset - 1);
    const shift = time < '15:00' ? 'morning' : 'evening';
    const team = DATA.STAFF.filter((s) => s.desk && s.shift === shift && this.works(s.key, offset));
    return team[hash(stamp) % team.length].key;
  }

  resolve(who, stamp) {
    if (who === 'web') return null;
    if (this.staff[who]) return who;
    const time = stamp.slice(11);
    const offset = this.offset(stamp);
    if (who === 'desk') return this.desk(stamp);
    if (who === 'res') return this.works('ag', offset) && time >= '09:30' && time < '18:00' ? 'ag' : this.desk(stamp);
    if (who === 'mgr') {
      if (time >= '08:45' && time < '14:20') return 'sb';
      return time >= '14:20' && time < '23:00' ? 'vs' : this.desk(stamp);
    }
    if (who === 'night') return this.nightAuditor(time < '12:00' ? offset - 1 : offset);
    if (who === 'hksup') return this.works('mk', offset) ? 'mk' : 'ar';
    throw new Error(`Sample data: unknown member of staff "${who}"`);
  }

  attendant(number, offset) {
    const room = DATA.ROOMS.find((r) => r.number === number);
    return [room.attendant, 'ar', 'mk'].find((key) => this.works(key, offset)) || room.attendant;
  }

  /* ---------------------------------------------------------------- the timeline */
  add(at, run, label) {
    this.events.push({ at, seq: this.seq++, run, label });
  }

  /* An action by a member of staff (who: a key or a role, see resolve). They sign in before it. */
  act(at, who, run, label) {
    const key = this.resolve(who, at);
    if (key) {
      let shiftDay = this.offset(at);
      if (this.staff[key].shift === 'night' && at.slice(11) < '12:00') shiftDay -= 1;
      const k = `${key}|${shiftDay}`;
      if (!this.needed.has(k) || this.needed.get(k) > at) this.needed.set(k, at);
    }
    this.add(at, () => run(key), label);
    return key;
  }

  req(key) {
    const s = key ? this.staff[key] : null;
    return {
      user: s ? { id: this.ids.staff[key], name: s.name, role: s.role, title: s.title } : null,
      settings: settingsService.all(this.db), ip: s ? s.ip : `49.37.${(hash(clock.stamp(ZONE)) % 200) + 20}.${(hash(`${clock.stamp(ZONE)}#`) % 250) + 3}`,
      protocol: 'https', get: () => '',
    };
  }

  /* "{room:shah}" -> the guest's room now; "{5}" -> "Sat 24 Oct" (day 5). */
  text(template) {
    return template
      .replace(/\{room:(\w+)\}/g, (all, key) => {
        const r = this.db.get(`SELECT rm.number FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN rooms rm ON rm.id = r.room_id
          WHERE lower(g.email) = lower(?) AND r.status IN ('checked_in', 'checked_out') ORDER BY r.checked_in_at DESC LIMIT 1`, this.guest[key].email);
        return r ? r.number : 'their room';
      })
      .replace(/\{(-?\d+)\}/g, (all, n) => f.formatDay(this.day(Number(n))));
  }

  build(by) {
    const before = {};
    for (const table of TRACKED) before[table] = this.db.get(`SELECT COALESCE(MAX(id), 0) AS n FROM ${table}`).n;
    const settingsBefore = Object.fromEntries(this.db.all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
    f.setCurrency('₹', 'en-IN');

    this.planSetup();
    this.planStays();
    this.planProfiles();
    this.planBlocks();
    this.planChanges();
    this.planHousekeeping();
    this.planHandover();
    this.planAudits();
    this.planSignIns();
    this.run();

    const ids = {};
    for (const table of TRACKED) ids[table] = this.db.all(`SELECT id FROM ${table} WHERE id > ? ORDER BY id`, before[table]).map((r) => r.id);
    const settingsAfter = Object.fromEntries(this.db.all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
    const changed = [...new Set([...Object.keys(settingsBefore), ...Object.keys(settingsAfter)])].filter((k) => settingsBefore[k] !== settingsAfter[k]);
    const counts = {
      guests: ids.guests.length, bookings: ids.reservations.length, staff: ids.users.length, rooms: ids.rooms.length, roomTypes: ids.room_types.length,
      payments: ids.payments.length, invoices: ids.invoices.length, logLines: ids.activity_log.length,
    };
    const stamp = clock.stamp(ZONE);
    settingsService.save(this.db, {
      sample_data: {
        added_at: stamp, added_by: by ? by.name : 'Command line', counts, ids,
        days: this.audited,
        settings: Object.fromEntries(changed.map((k) => [k, { before: settingsBefore[k] ?? null, after: settingsAfter[k] ?? null }])),
      },
    });
    activity.log(this.db, { user: by, settings: settingsService.all(this.db) }, 'sample.add',
      `Added the sample data: ${counts.guests} guests, ${counts.bookings} bookings, ${counts.staff} staff accounts and ${counts.rooms} rooms`, 'System');
    return {
      counts,
      staff: DATA.STAFF.map((s) => ({ name: s.name, email: this.emailOf(s), role: s.role, title: s.title, active: s.until === undefined })),
    };
  }

  run() {
    this.events.sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
    for (const e of this.events) {
      if (e.at > this.now) break; // the rest has not happened yet
      try {
        clock.at(e.at, () => e.run());
      } catch (error) {
        const detail = error.errors ? ` ${JSON.stringify(error.errors)}` : '';
        error.message = `Sample data, ${e.label || 'step'} at ${e.at}: ${error.message}${detail}`;
        throw error;
      }
    }
  }

  emailOf(s) {
    const [first, ...rest] = s.name.toLowerCase().split(' ');
    return `${first}.${rest.join('')}@${this.domain}`;
  }

  /* ---------------------------------------------------------------- the hotel is set up (admin panel) */
  planSetup() {
    // The general manager is the hotel's first admin, made when the hotel was set up (like an empty hotel's admin).
    this.add(this.at(-36, '18:00'), () => this.createStaff('am', null), 'first admin');
    this.act(this.at(-35, '10:05'), 'am', (k) => this.saveSettings(k), 'hotel settings');
    DATA.ROOM_TYPES.forEach((t, i) => this.act(this.at(-35, hhmm(10, 20 + i * 4)), 'am', (k) => this.addRoomType(k, t, i), `room type ${t.code}`));
    DATA.STAFF.filter((s) => s.key !== 'am').forEach((s, i) => this.act(this.at(-35, hhmm(11, 30 + i * 2)), 'am', (k) => this.createStaff(s.key, k), `staff ${s.key}`));
    DATA.ROOMS.forEach((r, i) => this.act(this.at(-35, hhmm(12, 20 + i)), 'am', (k) => this.addRoom(k, r), `room ${r.number}`));
    this.act(this.at(-34, '10:10'), 'am', (k) => this.saveBar(k), 'rate plan BAR');
    DATA.PLANS.forEach((p, i) => this.act(this.at(-34, hhmm(10, 13 + i * 3)), 'am', (k) => this.addPlan(k, p, i), `rate plan ${p.code}`));
    DATA.EXTRAS.forEach((x, i) => this.act(this.at(-34, hhmm(10, 30 + i * 2)), 'am', (k) => this.addExtra(k, x, i), `extra ${x.code}`));
    DATA.SEASONS.forEach((x, i) => this.act(this.at(-34, hhmm(10, 45 + i * 2)), 'am', (k) => this.addSeason(k, x), `season ${x.name}`));
    DATA.SOURCES.forEach((x, i) => this.act(this.at(-34, hhmm(11, 5 + i)), 'am', (k) => this.saveSource(k, x, i), `source ${x.name}`));
    this.act(this.at(-34, '16:30'), 'sb', (k) => this.saveWebsite(k), 'website');
  }

  /* Short code shown on the staff avatar, unique like the admin panel makes it. */
  codeFor(name) {
    const initials = f.initials(name).toLowerCase() || 'st';
    let code = initials;
    for (let n = 2; this.db.get('SELECT 1 FROM users WHERE code = ?', code); n++) code = `${initials}${n}`;
    return code;
  }

  createStaff(key, byKey) {
    const s = this.staff[key];
    const code = this.codeFor(s.name);
    this.ids.staff[key] = this.db.get(
      `INSERT INTO users (name, email, password_hash, role, title, department, shift, code, area, floor, active, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
      s.name, this.emailOf(s), this.hashes[key], s.role, s.title, s.department, s.shift, code, s.area || null, s.floor ?? null, byKey ? 1 : 0, clock.stamp(ZONE),
    ).id;
    if (byKey) activity.log(this.db, this.req(byKey), 'staff.save', `Added staff account ${s.name} (${s.role}), password set`);
  }

  saveSettings(key) {
    const current = settingsService.all(this.db);
    const changes = { ...DATA.INDIA };
    for (const [name, value] of Object.entries(DATA.FILL)) {
      if (!current[name] || (name === 'hotel_name' && current[name] === settingsService.DEFAULTS.hotel_name)) changes[name] = value;
    }
    settingsService.save(this.db, changes);
    f.setCurrency('₹', 'en-IN');
    activity.log(this.db, this.req(key), 'settings.update', 'Hotel settings updated');
  }

  addRoomType(key, t, i) {
    const photo = t.photo && fs.existsSync(path.join(PHOTO_DIR, t.photo)) ? t.photo : '';
    this.ids.type[t.code] = this.db.get(
      `INSERT INTO room_types (code, name, base_rate_cents, max_guests, clean_minutes, service_minutes, sort, active, description, bed, size_sqm, photo, online)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?) RETURNING id`,
      t.code, t.name, t.rate * 100, t.max, t.clean, t.service, i + 1, t.description, t.bed, t.size, photo, t.online === false ? 0 : 1,
    ).id;
    activity.log(this.db, this.req(key), 'room-type.save', `Added room type ${t.name} (${f.money(t.rate * 100)})`);
  }

  addRoom(key, r) {
    this.ids.room[r.number] = this.db.get(
      "INSERT INTO rooms (number, floor, room_type_id, attendant_id, active, hk_status, hk_updated_at) VALUES (?, ?, ?, ?, 1, 'clean', ?) RETURNING id",
      r.number, r.floor, this.ids.type[r.type], this.ids.staff[r.attendant], clock.stamp(ZONE),
    ).id;
    activity.log(this.db, this.req(key), 'room.save', `Added room ${r.number}`);
  }

  /* The empty hotel's "Best available" plan stays (room only) and gets free cancellation. */
  saveBar(key) {
    const req = this.req(key);
    const bar = this.db.get('SELECT * FROM rate_plans WHERE code = ?', DATA.BAR.code);
    if (bar) {
      this.db.run('UPDATE rate_plans SET description = ?, free_cancel_days = ?, sort = 1, bookable = 1, online = 1, active = 1 WHERE id = ?', DATA.BAR.description, DATA.BAR.cancel, bar.id);
    } else {
      this.db.run("INSERT INTO rate_plans (code, name, adjust_type, adjust_value, description, bookable, sort, active, free_cancel_days, online) VALUES (?, ?, 'amount', 0, ?, 1, 1, 1, ?, 1)",
        DATA.BAR.code, DATA.BAR.name, DATA.BAR.description, DATA.BAR.cancel);
    }
    activity.log(this.db, req, 'rate-plan.save', `${bar ? 'Updated' : 'Added'} rate plan ${bar ? bar.name : DATA.BAR.name}`);
  }

  addPlan(key, p, i) {
    const percent = typeof p.adjust === 'string' && p.adjust.endsWith('%');
    this.db.run('INSERT INTO rate_plans (code, name, adjust_type, adjust_value, description, bookable, sort, active, free_cancel_days, online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      p.code, p.name, percent ? 'percent' : 'amount', percent ? Number(p.adjust.slice(0, -1)) : p.adjust * 100, p.description, p.bookable ? 1 : 0, i + 2,
      p.active === false ? 0 : 1, p.cancel, p.online ? 1 : 0);
    activity.log(this.db, this.req(key), 'rate-plan.save', `Added rate plan ${p.name}`);
  }

  addSeason(key, x) {
    this.db.run('INSERT INTO rate_seasons (name, start_date, end_date, weekdays, adjust_type, adjust_value, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      x.name, x.from === undefined ? null : this.day(x.from), x.to === undefined ? null : this.day(x.to), x.days || '', x.kind, x.value, clock.stamp(ZONE));
    activity.log(this.db, this.req(key), 'season.save', `Added rates for ${x.name}`);
  }

  addExtra(key, x, i) {
    this.db.run('INSERT INTO extras (code, name, price_cents, per, sort, active, gst_kind) VALUES (?, ?, ?, ?, ?, 1, ?)', x.code, x.name, x.price * 100, x.per, i + 1, x.gst || 'none');
    activity.log(this.db, this.req(key), 'extra.save', `Added extra ${x.name}`);
  }

  saveSource(key, x, i) {
    const existing = this.db.get('SELECT * FROM sources WHERE lower(name) = lower(?)', x.name);
    if (existing) this.db.run('UPDATE sources SET kind = ?, sort = ?, form_sort = ?, active = 1 WHERE id = ?', x.kind, i + 1, x.form, existing.id);
    else this.db.run('INSERT INTO sources (name, kind, sort, form_sort, active) VALUES (?, ?, ?, ?, 1)', x.name, x.kind, i + 1, x.form);
    activity.log(this.db, this.req(key), 'source.save', `${existing ? 'Updated' : 'Added'} booking source ${x.name}`);
  }

  saveWebsite(key) {
    const current = settingsService.all(this.db);
    const changes = { site_enabled: true };
    for (const [name, value] of Object.entries(DATA.WEBSITE)) {
      if (name !== 'site_enabled' && (!current[name] || (Array.isArray(current[name]) && !current[name].length))) changes[name] = value;
    }
    settingsService.save(this.db, changes);
    activity.log(this.db, this.req(key), 'website.update', 'Website on; texts updated');
  }

  /* ---------------------------------------------------------------- guests and their stays */
  planStays() {
    this.stays = DATA.STAYS.map((s, i) => {
      const arrival = this.day(s.a);
      const departure = this.day(s.a + s.n);
      const end = s.shorten ? this.day(s.a + s.shorten.nights) : departure;
      return {
        ...s, i, guest: this.guest[s.g], arrival, departure, end, ch: s.ch ?? 0, finalType: s.upgrade || s.type,
        ad: s.ad ?? (s.plan === 'CORP' || this.guest[s.g].corporate ? 1 : 2), // business travellers mostly come alone
        bookAt: this.at(s.book[0], s.book[1]), inAt: s.in ? `${arrival} ${s.in}` : null, outAt: s.out ? `${end} ${s.out}` : null,
      };
    });
    this.allocate();
    for (const g of DATA.GROUPS) this.act(this.at(g.at[0], g.at[1]), g.at[2], (k) => this.createGroup(k, g), `group ${g.name}`);
    for (const s of this.stays) this.planStay(s);
  }

  /* Rooms for every stay, so none overlap, out-of-order rooms are left alone and a room is cleaned
     before its next guest checks in. Bookings that are later cancelled keep their room meanwhile. */
  allocate() {
    const busy = new Map(DATA.ROOMS.map((r) => [r.number, []]));
    for (const b of DATA.BLOCKS) busy.get(b.room).push({ from: this.day(b.start), to: this.day(b.ended ? b.ended[0] : b.end), block: true });
    const free = (number, from, to) => busy.get(number).every((x) => x.to <= from || x.from >= to);
    const order = [...this.stays].sort((a, b) => a.arrival.localeCompare(b.arrival) || Number(Boolean(b.room)) - Number(Boolean(a.room))
      || (a.inAt || '99').localeCompare(b.inAt || '99') || a.i - b.i);
    for (const s of order) {
      const take = (type, except, wanted) => {
        const before = f.addDays(s.arrival, -1);
        const options = DATA.ROOMS.filter((r) => r.type === type && r.number !== except && free(r.number, s.arrival, s.departure)).filter((r) => {
          const leaving = busy.get(r.number).find((x) => !x.block && x.to === s.arrival);
          return !leaving || !s.inAt || !leaving.outAt || plusMinutes(leaving.outAt, 45) <= s.inAt;
        });
        const vacant = (r) => Number(free(r.number, before, s.arrival));
        options.sort((a, b) => Number(b.number === wanted) - Number(a.number === wanted) || vacant(b) - vacant(a) || Number(a.number) - Number(b.number));
        if (!options.length) throw new Error(`Sample data: no ${type} room is free for ${s.g} from ${s.arrival}`);
        busy.get(options[0].number).push({ from: s.arrival, to: s.departure, outAt: s.outAt });
        return options[0].number;
      };
      s.room = take(s.finalType, null, s.room);
      s.firstRoom = s.upgrade ? take(s.type) : s.move ? take(s.type, s.room, s.move.from) : s.room;
      s.inRoom = s.upgrade ? s.room : s.firstRoom; // the room the guest checks in to
    }
  }

  planStay(s) {
    const g = s.guest;
    const label = `${g.first} ${g.last} (${s.arrival})`;
    s.bookKey = s.book[2] === 'web' ? null : this.resolve(s.book[2], s.bookAt);
    if (s.book[2] === 'web') this.add(s.bookAt, () => this.webBooking(s), `online booking ${label}`);
    else this.act(s.bookAt, s.bookKey, (k) => this.staffBooking(s, k), `booking ${label}`);
    if (s.tentative) this.act(plusMinutes(s.bookAt, 2), s.bookKey, (k) => this.edit(s, k, { notes: this.text(s.notes) }), `hold note ${label}`);
    if (s.edit) this.act(this.at(s.edit.at[0], s.edit.at[1]), s.edit.at[2], (k) => this.edit(s, k, { eta: s.edit.eta, tags: s.edit.tags }), `ETA ${label}`);
    for (const [day, time, who, amount, method, reference] of s.pay || []) {
      this.act(this.at(day, time), who, (k) => this.pay(s, k, amount, method, reference), `payment ${label}`);
    }
    if (s.cancel) {
      const at = this.at(s.cancel.at[0], s.cancel.at[1]);
      if (s.cancel.online) this.add(at, () => this.cancelOnline(s), `online cancellation ${label}`);
      else {
        const key = this.resolve(s.cancel.at[2], at);
        if (s.cancel.refund) this.act(plusMinutes(at, -4), key, (k) => this.refund(s, k, 'all', ...s.cancel.refund), `refund ${label}`);
        this.act(at, key, (k) => reservations.cancel(this.db, this.req(k), s.conf), `cancellation ${label}`);
      }
      return;
    }
    if (s.noShow || !s.inAt) return;

    s.inKey = this.resolve(s.inBy || 'desk', s.inAt);
    if (s.upgrade) this.act(plusMinutes(s.inAt, -8), s.inKey, (k) => this.edit(s, k, { type: s.upgrade, room: s.room }), `upgrade ${label}`);
    this.act(plusMinutes(s.inAt, -4), s.inKey, (k) => this.grc(s, k), `GRC ${label}`);
    this.act(s.inAt, s.inKey, (k) => reservations.checkIn(this.db, this.req(k), s.conf), `check-in ${label}`);
    const form3 = registration.needsForm3({ country: 'IN' }, g.nationality);
    if (form3 && s.f3 && s.f3.arr) this.act(this.at(...s.f3.arr), 'desk', (k) => this.form3(s, k, 'arrival'), `Form III ${label}`);
    // Charges during the stay: [day of the stay (0 = arrival day), time, kind, text, rupees before tax]
    for (const [day, time, kind, text, rupees] of s.charges || []) {
      const at = this.at(s.a + day, time);
      if (at <= s.inAt || (s.outAt && at >= s.outAt)) throw new Error(`Sample data: a charge outside the stay of ${label}`);
      this.act(at, 'desk', (k) => folio.post(this.db, this.req(k), s.conf, { charge_kind: kind, charge_text: text, charge_amount: String(rupees) }), `charge ${label}`);
    }
    if (s.move) {
      const at = this.at(s.move.at[0], s.move.at[1]);
      this.act(at, s.move.at[2], (k) => this.edit(s, k, { room: s.room }), `room move ${label}`);
      this.act(this.at(s.move.at[0] + 1, '09:15'), 'hksup', (k) => this.roomStatus(k, s.firstRoom, 'clean'), `room ${s.firstRoom} fixed`);
    }
    if (s.shorten) {
      const at = this.at(s.shorten.at[0], s.shorten.at[1]);
      const key = this.resolve(s.shorten.at[2], at);
      this.act(at, key, (k) => this.edit(s, k, { departure: s.end, notes: s.shorten.note }), `early departure ${label}`);
      this.act(plusMinutes(at, 4), key, (k) => this.refund(s, k, 'extra', ...s.shorten.refund), `refund ${label}`);
    }
    if (!s.outAt) return;
    const outKey = this.resolve('desk', s.outAt);
    if (Array.isArray(s.settle)) this.act(plusMinutes(s.outAt, -2), outKey, (k) => this.pay(s, k, 'all', s.settle[0], s.settle[1]), `payment ${label}`);
    this.act(s.outAt, outKey, (k) => reservations.checkOut(this.db, this.req(k), s.conf, { settle: true, method: typeof s.settle === 'string' ? s.settle : 'Card' }), `check-out ${label}`);
    if (s.inv) this.act(plusMinutes(s.outAt, 3), outKey, (k) => this.invoice(s, k, s.inv), `invoice ${label}`);
    if (s.reissue) this.act(plusMinutes(s.outAt, s.reissue), 'desk', (k) => this.invoice(s, k, 'company'), `new invoice ${label}`);
    if (form3 && s.f3 && s.f3.dep) this.act(this.at(...s.f3.dep), 'desk', (k) => this.form3(s, k, 'departure'), `Form III ${label}`);
  }

  bookingInput(s) {
    const g = s.guest;
    return {
      arrival: s.arrival, departure: s.departure, type: s.type, adults: String(s.ad), children: String(s.ch), plan: s.plan,
      first: g.first, last: g.last, email: g.email, phone: g.phone, source: s.src, requests: s.req || '', extras: s.extras || [],
    };
  }

  /* Puts the booking in the room planned for it (a front desk would pick the room by hand the same way). */
  place(s, booking) {
    s.conf = booking.confirmation;
    s.id = booking.id;
    const roomId = this.ids.room[s.firstRoom];
    if (booking.room_id !== roomId) this.db.run('UPDATE reservations SET room_id = ? WHERE id = ?', roomId, booking.id);
  }

  /* A group as the reservations desk opens it before booking its rooms (services/groups.js does the same). */
  createGroup(key, g) {
    const guest = this.guest[g.contact];
    const last = this.db.get('SELECT code FROM booking_groups ORDER BY id DESC LIMIT 1');
    const code = `GRP-${last ? Number(last.code.replace(/\D/g, '')) + 1 : 101}`;
    this.ids.group[g.key] = this.db.get(`INSERT INTO booking_groups (code, name, contact_name, contact_email, contact_phone, company, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, code, g.name, `${guest.first} ${guest.last}`, guest.email, guest.phone, g.company || null, g.notes || null,
    this.ids.staff[key], clock.stamp(ZONE)).id;
    activity.log(this.db, this.req(key), 'group.create', `Booked group ${code} (${g.name})`);
  }

  staffBooking(s, key) {
    const booking = reservations.create(this.db, this.req(key), this.bookingInput(s));
    if (s.group) this.db.run('UPDATE reservations SET group_id = ? WHERE id = ?', this.ids.group[s.group], booking.id);
    this.place(s, booking);
    if (s.tentative) this.db.run("UPDATE reservations SET status = 'tentative' WHERE id = ?", booking.id);
  }

  /* A booking made by the guest on the hotel website (as services/website.js does), with its confirmation email. */
  webBooking(s) {
    const settings = settingsService.all(this.db);
    const v = reservations.readBooking(this.db, this.bookingInput(s), settingsService.businessDate(this.db));
    v.nationality = s.guest.nationality || 'IN';
    const booking = reservations.insertBooking(this.db, this.req(null), v, { createdBy: null, actor: 'Website', online: true });
    this.place(s, booking);
    const link = `${this.siteUrl}/hotel/booking/${booking.confirmation}?t=${website.token(this.db, booking.confirmation, booking.email)}`;
    this.mail(settings, emails.bookingConfirmed(settings, reservations.byConfirmation(this.db, booking.confirmation), link));
  }

  /* The guest cancels on the website (services/website.js), with the email it sends. */
  cancelOnline(s) {
    const settings = settingsService.all(this.db);
    const b = reservations.byConfirmation(this.db, s.conf);
    if (!website.bookingView(this.db, b).canCancel) throw new Error(`${s.conf} can no longer be cancelled online`);
    const stamp = clock.stamp(ZONE);
    this.db.run("UPDATE reservations SET status = 'cancelled', cancelled_at = ?, room_id = NULL, updated_at = ? WHERE id = ?", stamp, stamp, b.id);
    this.db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)', 'calendar-check', 'warn',
      `Cancelled online ${b.confirmation}`, `${b.name} · ${f.formatDay(b.arrival)} → ${f.formatDay(b.departure)}`, stamp);
    activity.log(this.db, this.req(null), 'reservation.cancel', `Guest cancelled ${b.confirmation} online`, 'Website');
    this.mail(settings, emails.bookingCancelled(settings, b));
  }

  /* Emails are only written to the outbox, never sent: the addresses are made up. */
  mail(settings, { to, subject, text }) {
    this.db.run("INSERT INTO outbox (to_address, subject, body, status, created_at) VALUES (?, ?, ?, 'logged', ?)", to, subject, text, clock.stamp(ZONE));
  }

  /* The booking page's form, with everything as it is except `changes`. */
  edit(s, key, changes) {
    const b = reservations.byConfirmation(this.db, s.conf);
    const tags = changes.tags || JSON.parse(b.tags || '[]');
    const body = {
      arrival: b.arrival, departure: changes.departure || b.departure, room_type_id: String(changes.type ? this.ids.type[changes.type] : b.room_type_id),
      room: changes.room || b.room_number || '', adults: String(b.adults), children: String(b.children), rate_plan_id: b.rate_plan_id ? String(b.rate_plan_id) : '',
      nightly_rate: rupees(b.nightly_rate_cents), source_id: b.source_id ? String(b.source_id) : '', eta: changes.eta || b.eta || '',
      notes: changes.notes !== undefined ? changes.notes : b.notes || '', requests: b.requests || '',
      first: b.first_name, last: b.last_name, email: b.email || '', phone: b.phone || '',
    };
    for (const tag of ['early', 'late', 'anniversary']) if (tags.includes(tag)) body[`tag_${tag}`] = 'on';
    reservations.update(this.db, this.req(key), s.conf, body);
  }

  amount(s, what) {
    const b = reservations.byConfirmation(this.db, s.conf);
    const owing = b.total_cents - b.paid_cents;
    const night = roundRupees((b.room_total_cents + b.tax_cents) / b.nights);
    if (what === 'all') return owing;
    if (what === 'half') return Math.min(owing, roundRupees(b.total_cents / 2));
    if (what === 'night') return Math.min(owing, night);
    if (what === 'extra') return b.paid_cents - b.total_cents; // paid for nights no longer in the stay
    if (what && what.n) return Math.min(owing, night * what.n);
    return Math.min(owing, Math.round(what * 100));
  }

  pay(s, key, what, method, reference) {
    const cents = this.amount(s, what);
    if (cents > 0) billing.addPayment(this.db, this.req(key), s.conf, { amount: rupees(cents), method, reference: reference || '' });
  }

  refund(s, key, what, method, reason) {
    const cents = what === 'all' ? reservations.byConfirmation(this.db, s.conf).paid_cents : this.amount(s, what);
    if (cents > 0) billing.refund(this.db, this.req(key), s.conf, { refund_amount: rupees(cents), refund_method: method, refund_reason: reason });
  }

  grc(s, key) {
    const g = s.guest;
    const foreign = Boolean(g.nationality && g.nationality !== 'IN');
    const city = g.city.split(',')[0];
    const body = {
      nationality: g.nationality || 'IN', date_of_birth: g.dob || '', address: g.address || '',
      id_type: foreign ? '' : g.id[0], id_number: foreign ? '' : g.id[1], passport_number: g.passport || '',
      visa_type: g.visa ? g.visa[0] : '', visa_number: g.visa ? g.visa[1] : '', visa_valid_until: g.visa ? f.addDays(s.arrival, 150) : '',
      arrived_in_india: foreign ? f.addDays(s.arrival, g.port && !g.port.includes('CCU') && !g.port.includes('Petrapole') ? -5 : 0) : '',
      port_of_arrival: foreign ? g.port || '' : '',
      purpose: (s.grc && s.grc.purpose) || (s.plan === 'CORP' || g.corporate ? 'Business' : 'Leisure'),
      arriving_from: (s.grc && s.grc.from) || city, going_to: (s.grc && s.grc.to) || city,
    };
    if (!registration.saveGrc(this.db, this.req(key), s.conf, body)) throw new Error(`the registration card for ${g.first} ${g.last} is not complete`);
  }

  form3(s, key, which) {
    const reference = `FRRO/KOL/${this.day(0).slice(2, 4)}/${String(100000 + (hash(`${s.conf}${which}`) % 900000))}`;
    registration.recordForm3(this.db, this.req(key), s.conf, { report: which, reference });
  }

  invoice(s, key, to) {
    const b = reservations.byConfirmation(this.db, s.conf);
    const g = this.db.get('SELECT * FROM guests WHERE id = ?', b.guest_id);
    let body = { bill_to: `${g.first_name} ${g.last_name}`, gstin: '' };
    if (to === 'company') body = { bill_to: g.company || body.bill_to, gstin: g.gstin || '' };
    else if (Array.isArray(to)) body = { bill_to: to[1], gstin: to[2] || '' };
    billing.createInvoice(this.db, this.req(key), s.conf, body); // place of supply is the hotel, so CGST + SGST
  }

  /* Profiles: typed in after the first booking (online guests: at check-in); notes added later. */
  planProfiles() {
    for (const g of DATA.GUESTS) {
      const mine = this.stays.filter((s) => s.g === g.key).sort((a, b) => a.bookAt.localeCompare(b.bookAt));
      if (!mine.length) throw new Error(`Sample data: ${g.first} ${g.last} has no stay`);
      const first = mine[0];
      if (first.bookKey) this.act(plusMinutes(first.bookAt, 3), first.bookKey, (k) => this.profile(k, g), `profile ${g.key}`);
      else {
        const stay = mine.find((s) => s.inAt);
        if (stay) this.act(plusMinutes(stay.inAt, 4), stay.inKey, (k) => this.profile(k, g), `profile ${g.key}`);
      }
      for (const [day, time, who, note] of g.notes || []) this.act(this.at(day, time), who, (k) => this.profile(k, g, this.text(note)), `note ${g.key}`);
    }
  }

  profile(key, g, note = '') {
    const row = this.db.get('SELECT * FROM guests WHERE lower(email) = lower(?)', g.email);
    const filled = Boolean(row.updated_at && (row.city || row.company));
    const prefs = filled ? JSON.parse(row.preferences || '{}') : g.prefs || {};
    const body = {
      first: row.first_name, last: row.last_name, email: row.email || '', phone: row.phone || '',
      city: filled ? row.city || '' : g.city, company: filled ? row.company || '' : g.company || '', gstin: filled ? row.gstin || '' : g.gstin || '',
      note,
    };
    if (filled ? row.vip : g.vip) body.vip = 'on';
    if (filled ? row.corporate : g.corporate) body.corporate = 'on';
    for (const [group] of guests.PREF_GROUPS) body[`pref_${group}`] = (prefs[group] || []).join('\n');
    const result = guests.saveProfile(this.db, this.req(key), row.id, body);
    if (!result || result.errors) throw new Error(`profile of ${g.first} ${g.last}: ${JSON.stringify(result && result.errors)}`);
  }

  /* ---------------------------------------------------------------- rooms off sale, later changes */
  planBlocks() {
    for (const b of DATA.BLOCKS) {
      this.act(this.at(b.at[0], b.at[1]), b.at[2], (k) => this.block(k, b), `room ${b.room} out of order`);
      if (b.ended) this.act(this.at(b.ended[0], b.ended[1]), b.ended[2], (k) => this.unblock(k, b), `room ${b.room} back`);
    }
  }

  block(key, b) {
    const req = this.req(key);
    const stamp = clock.stamp(ZONE);
    const start = this.day(b.start);
    const end = this.day(b.end);
    const roomId = this.ids.room[b.room];
    const clash = this.db.get("SELECT confirmation FROM reservations WHERE room_id = ? AND status IN ('confirmed', 'tentative', 'checked_in') AND arrival < ? AND departure > ? LIMIT 1", roomId, end, start);
    if (clash) throw new Error(`booking ${clash.confirmation} is in room ${b.room}`);
    b.id = this.db.get('INSERT INTO room_blocks (room_id, start_date, end_date, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      roomId, start, end, b.reason, req.user.id, stamp).id;
    this.db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)', 'wrench', '', `${b.room} out of order`, `${b.reason} · back ${f.formatDay(end)}`, stamp);
    activity.log(this.db, req, 'room.block', `Room ${b.room} out of order ${start} to ${end}: ${b.reason}`);
  }

  unblock(key, b) {
    const bd = settingsService.businessDate(this.db);
    if (this.day(b.start) < bd) this.db.run('UPDATE room_blocks SET end_date = ? WHERE id = ?', bd, b.id);
    else this.db.run('DELETE FROM room_blocks WHERE id = ?', b.id);
    activity.log(this.db, this.req(key), 'room.unblock', `Room ${b.room} back in service`);
  }

  planChanges() {
    for (const c of DATA.CHANGES) {
      this.act(this.at(c.at[0], c.at[1]), c.at[2], (k) => {
        const req = this.req(k);
        if (c.kind === 'rate') {
          for (const t of DATA.ROOM_TYPES.filter((x) => x.later)) {
            this.db.run('UPDATE room_types SET base_rate_cents = ? WHERE code = ?', t.later * 100, t.code);
            activity.log(this.db, req, 'room-type.save', `Updated room type ${t.name} (${f.money(t.later * 100)})`);
          }
        } else if (c.kind === 'staff-left') {
          const s = this.staff[c.staff];
          this.db.run('UPDATE users SET active = 0 WHERE id = ?', this.ids.staff[c.staff]);
          this.db.run('DELETE FROM sessions WHERE user_id = ?', this.ids.staff[c.staff]);
          activity.log(this.db, req, 'staff.save', `Updated staff account ${s.name} (${s.role})`);
        } else if (c.kind === 'source-off') {
          this.db.run('UPDATE sources SET active = 0 WHERE name = ?', c.source);
          activity.log(this.db, req, 'source.save', `Updated booking source ${c.source}`);
        } else if (c.kind === 'invite') {
          this.invite(k, c.person);
        }
      }, `change ${c.kind}`);
    }
  }

  /* A new account with an invite link, as Admin panel → Staff accounts makes it: no password until the person
     opens the link, which is only in the email (logged, like every sample email). Links expire on the real
     clock, so the link is given as many real hours as the invite is old in the sample. */
  invite(key, person) {
    const req = this.req(key);
    const email = this.emailOf(person);
    const id = this.db.get(
      `INSERT INTO users (name, email, password_hash, role, title, department, shift, code, active, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?) RETURNING id`,
      person.name, email, this.unknown, person.role, person.title, person.department, person.shift, this.codeFor(person.name), clock.stamp(ZONE),
    ).id;
    activity.log(this.db, req, 'staff.save', `Added staff account ${person.name} (${person.role})`);
    const age = Date.parse(`${this.now.replace(' ', 'T')}:00Z`) - Date.parse(`${clock.stamp(ZONE).replace(' ', 'T')}:00Z`);
    const created = Date.now() - age;
    const token = randomToken();
    this.db.run('INSERT INTO password_resets (user_id, token_hash, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      id, links.hashOf(token), 'invite', created + links.LIFETIME.invite, created);
    this.mail(req.settings, emails.staffLink(req.settings, { name: person.name, email }, this.siteUrl + links.pathOf('invite', token), req.user, 'invite', links.LASTS.invite));
    activity.log(this.db, req, 'staff.link', `Invite link made for ${person.name}`);
  }

  /* ---------------------------------------------------------------- housekeeping */
  planHousekeeping() {
    const sheet = new Map(); // tasks the night audit will create: "date room" -> kind
    for (const s of this.stays) {
      if (!s.inAt || s.noShow || s.cancel) continue;
      for (let date = f.addDays(s.arrival, 1); date <= s.end; date = f.addDays(date, 1)) {
        const offset = this.offset(date);
        if (offset - 1 < FIRST_AUDIT || offset > 0) continue;
        const kind = date === s.end ? 'departure' : 'stayover';
        sheet.set(`${date} ${s.room}`, kind);
        let at;
        if (kind === 'departure') {
          if (!s.outAt) continue;
          at = plusMinutes(s.outAt, 30 + (hash(s.room + date) % 35));
          const next = this.stays.find((x) => x !== s && x.inRoom === s.room && x.arrival === date && x.inAt && !x.cancel && !x.noShow);
          if (next && at > plusMinutes(next.inAt, -15)) at = plusMinutes(next.inAt, -15);
        } else {
          at = `${date} ${hhmm(10, (hash(s.room + date) % 27) * 10)}`;
        }
        this.act(at, this.attendant(s.room, offset), (k) => this.taskDone(k, date, s.room, kind), `${kind} clean ${s.room}`);
      }
    }
    // First thing today the executive housekeeper marks the rooms that need a stayover service as dirty.
    const stayovers = [...sheet].filter(([k, kind]) => k.startsWith(this.today) && kind === 'stayover').map(([k]) => k.slice(11)).sort();
    stayovers.forEach((room, i) => this.act(this.at(0, hhmm(7, 20 + i)), 'hksup', (k) => this.roomStatus(k, room, 'dirty'), `room ${room} dirty`));
    // Engineering jobs on today's sheet.
    this.add(this.at(0, '07:05'), () => {
      for (const [room, title, minutes] of DATA.MAINTENANCE) {
        this.db.run("INSERT INTO housekeeping_tasks (task_date, room_id, kind, title, minutes, attendant_id, note, note_tone) VALUES (?, ?, 'maintenance', ?, ?, ?, ?, 'blue')",
          this.today, this.ids.room[room], title, minutes, this.ids.staff.sk, 'Engineering');
      }
    }, 'maintenance jobs');
    for (const [room, , , done] of DATA.MAINTENANCE) {
      if (done && this.works('sk', 0)) this.act(this.at(0, done), 'sk', (k) => this.taskDone(k, this.today, room, 'maintenance'), `maintenance ${room}`);
    }
  }

  taskDone(key, date, number, kind) {
    const task = this.db.get(`SELECT t.*, rm.number FROM housekeeping_tasks t JOIN rooms rm ON rm.id = t.room_id
      WHERE t.task_date = ? AND rm.number = ? AND t.kind = ? AND t.done_at IS NULL ORDER BY t.id LIMIT 1`, date, number, kind);
    if (!task) throw new Error(`no ${kind} task for room ${number} on ${date}`);
    const stamp = clock.stamp(ZONE);
    this.db.run('UPDATE housekeeping_tasks SET done_at = ?, done_by = ? WHERE id = ?', stamp, this.ids.staff[key], task.id);
    if (kind !== 'maintenance') this.db.run("UPDATE rooms SET hk_status = 'clean', hk_updated_at = ? WHERE id = ?", stamp, task.room_id);
    activity.log(this.db, this.req(key), 'task.update', `${task.title} for room ${number} done`);
  }

  roomStatus(key, number, status) {
    this.db.run('UPDATE rooms SET hk_status = ?, hk_updated_at = ? WHERE id = ?', status, clock.stamp(ZONE), this.ids.room[number]);
    activity.log(this.db, this.req(key), 'room.status', `Room ${number} marked ${status}`);
  }

  /* ---------------------------------------------------------------- handover notes */
  planHandover() {
    const mornings = new Set();
    for (const [day, time, who, lead, body] of DATA.HANDOVER) {
      this.act(this.at(day, time), who, (k) => this.handover(k, this.text(lead), this.text(body)), 'handover note');
      if (who === 'night') mornings.add(day);
    }
    for (let day = FIRST_AUDIT + 1; day <= 0; day++) {
      if (!mornings.has(day)) this.act(this.at(day, hhmm(6, 50 + (hash(day) % 9))), 'night', (k) => this.auditNote(k, day - 1), 'audit note');
    }
  }

  handover(key, lead, body) {
    const s = this.staff[key];
    this.db.run('INSERT INTO handover_notes (author_id, author_name, department, lead, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      this.ids.staff[key], s.name, s.department || 'Front office', lead, body, clock.stamp(ZONE));
    activity.log(this.db, this.req(key), 'handover.create', `Handover note: ${lead}`);
  }

  auditNote(key, day) {
    const date = this.day(day);
    const closed = stats.day(this.db, date);
    if (!closed) return;
    const today = this.day(day + 1);
    const count = (sql) => this.db.get(sql, today).n;
    const arrivals = count("SELECT COUNT(*) AS n FROM reservations WHERE arrival = ? AND status IN ('confirmed', 'checked_in')");
    const departures = count("SELECT COUNT(*) AS n FROM reservations WHERE departure = ? AND status IN ('checked_in', 'checked_out')");
    this.handover(key, `Night audit for ${f.formatDay(date)} closed.`,
      `${closed.sold} of ${closed.rooms} rooms sold, ${f.money(closed.revenue)} room revenue, ADR ${f.money(Math.round(closed.adr))}. `
      + `Today: ${f.plural(arrivals, 'arrival', 'arrivals')} and ${f.plural(departures, 'departure', 'departures')}.`);
  }

  /* ---------------------------------------------------------------- night audits */
  planAudits() {
    this.audited = [];
    const noShows = new Set(this.stays.filter((s) => s.noShow).map((s) => s.arrival));
    for (let day = FIRST_AUDIT; day <= 0; day++) {
      const key = this.nightAuditor(day);
      const date = this.day(day);
      if (`${date} 23:44` <= this.now) this.audited.push(date);
      this.act(this.at(day, hhmm(23, 30 + (hash(date) % 5))), key, (k) => this.outletRevenue(k, day), `outlet revenue ${date}`);
      this.act(this.at(day, '23:44'), key, (k) => audit.close(this.db, this.req(k), { noShows: noShows.has(date) }), `night audit ${date}`);
    }
  }

  /* Restaurant and spa takings, entered by the night auditor (Admin → Night audit). */
  outletRevenue(key, day) {
    const date = this.day(day);
    const sold = stats.night(this.db, date).sold;
    const weekend = [5, 6].includes(f.weekday(date));
    const fnb = Math.round((sold * (850 + (hash(`f${date}`) % 450)) + (weekend ? 11000 : 5500) + (hash(`w${date}`) % 6000)) / 10) * 1000;
    const spa = Math.round((1200 + (hash(`s${date}`) % 4800) + (weekend ? 2500 : 0)) / 10) * 1000;
    for (const [outlet, amount] of [['fnb', fnb], ['spa', spa]]) {
      this.db.run('INSERT INTO revenue (date, outlet, amount_cents) VALUES (?, ?, ?) ON CONFLICT(date, outlet) DO UPDATE SET amount_cents = excluded.amount_cents', date, outlet, amount);
    }
    activity.log(this.db, this.req(key), 'revenue.save', `Outlet revenue for ${date}: F&B ${f.money(fnb)}, spa & other ${f.money(spa)}`);
  }

  /* ---------------------------------------------------------------- signing in */
  planSignIns() {
    for (const s of DATA.STAFF) {
      const firstDay = s.key === 'am' ? -35 : s.key === 'sb' ? -34 : -33;
      let first = s.key !== 'am';
      for (let day = firstDay; day <= 0; day++) {
        const needed = this.needed.get(`${s.key}|${day}`);
        const regular = this.works(s.key, day) && !(s.key === 'am' && f.weekday(this.day(day)) === 0);
        if (!needed && !regular) continue;
        const [h, m] = s.start.split(':').map(Number);
        let at = this.at(day, hhmm(h, m - (hash(`${s.key}${day}`) % 9)));
        if (needed && needed <= at) at = plusMinutes(needed, -5);
        const isFirst = first;
        this.add(at, () => this.signIn(s.key, isFirst), `sign-in ${s.key}`);
        first = false;
      }
    }
  }

  signIn(key, first) {
    const s = this.staff[key];
    const req = this.req(key);
    this.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', clock.stamp(ZONE), this.ids.staff[key]);
    activity.log(this.db, req, 'auth.sign-in', `${s.name} signed in`);
    if (first) { // the temporary password from the admin is changed at the first sign-in
      this.db.run('UPDATE users SET must_change_password = 0 WHERE id = ?', this.ids.staff[key]);
      activity.log(this.db, req, 'auth.password', `${s.name} changed their password`);
    }
  }
}

/* ------------------------------------------------------------------ removing */

/* Takes the sample out again: its bookings, guests, payments, invoices, staff accounts, log lines and the
   settings it changed (unless they were changed again since). Rooms, rates and sources it brought go too,
   unless real bookings use them. Returns the counts that were in the sample. */
function remove(db, { by = null } = {}) {
  const s = settingsService.all(db).sample_data;
  if (!s) throw fail('There is no sample data in this hotel.');
  const ids = (table) => (s.ids[table] || []).map(Number).filter(Number.isInteger);
  const among = (column, list) => (list.length ? `${column} IN (${list.join(', ')})` : '1 = 0');
  db.tx(() => {
    const bookings = ids('reservations');
    db.run(`DELETE FROM invoices WHERE ${among('reservation_id', bookings)} OR ${among('id', ids('invoices'))}`);
    db.run(`DELETE FROM payments WHERE ${among('reservation_id', bookings)} OR ${among('id', ids('payments'))}`);
    db.run(`DELETE FROM reservation_extras WHERE ${among('reservation_id', bookings)}`);
    db.run(`DELETE FROM folio_charges WHERE ${among('reservation_id', bookings)}`);
    db.run(`DELETE FROM reservations WHERE ${among('id', bookings)}`);
    db.run(`DELETE FROM booking_groups WHERE ${among('id', ids('booking_groups'))}`);
    db.run(`DELETE FROM guest_notes WHERE ${among('id', ids('guest_notes'))}`);
    db.run(`DELETE FROM guests WHERE ${among('id', ids('guests'))} AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id = guests.id)`);
    for (const table of ['housekeeping_tasks', 'handover_notes', 'notifications', 'outbox', 'activity_log', 'room_blocks']) {
      db.run(`DELETE FROM ${table} WHERE ${among('id', ids(table))}`);
    }
    // Every day's figures since the sample came in (also days closed later by hand: they count sample bookings).
    const first = (s.days || [])[0];
    if (first) {
      const last = settingsService.businessDate(db) > s.added_at.slice(0, 10) ? settingsService.businessDate(db) : s.added_at.slice(0, 10);
      db.run('DELETE FROM daily_stats WHERE date >= ? AND date <= ?', first, f.addDays(last, 1));
      db.run('DELETE FROM revenue WHERE date >= ? AND date <= ?', first, f.addDays(last, 1));
    }
    db.run(`DELETE FROM rooms WHERE ${among('id', ids('rooms'))} AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.room_id = rooms.id)`);
    db.run(`DELETE FROM room_types WHERE ${among('id', ids('room_types'))}
              AND NOT EXISTS (SELECT 1 FROM rooms rm WHERE rm.room_type_id = room_types.id) AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.room_type_id = room_types.id)`);
    db.run(`DELETE FROM rate_plans WHERE ${among('id', ids('rate_plans'))} AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.rate_plan_id = rate_plans.id)`);
    db.run(`DELETE FROM extras WHERE ${among('id', ids('extras'))} AND NOT EXISTS (SELECT 1 FROM reservation_extras x WHERE x.extra_id = extras.id)`);
    db.run(`DELETE FROM rate_seasons WHERE ${among('id', ids('rate_seasons'))}`);
    db.run(`DELETE FROM sources WHERE ${among('id', ids('sources'))} AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.source_id = sources.id)`);
    db.run(`DELETE FROM users WHERE ${among('id', ids('users'))}`);
    const now = Object.fromEntries(db.all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
    for (const [key, { before, after }] of Object.entries(s.settings || {})) {
      if ((now[key] ?? null) !== after) continue; // changed again since: keep it
      if (before === null) db.run('DELETE FROM settings WHERE key = ?', key);
      else db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, before);
    }
    // Invoice numbers start again at 0001 in a financial year that has no invoices left.
    const counters = db.get("SELECT value FROM settings WHERE key = 'invoice_counters'");
    if (counters) {
      const kept = Object.fromEntries(Object.entries(JSON.parse(counters.value))
        .filter(([year]) => db.get('SELECT 1 FROM invoices WHERE number LIKE ? LIMIT 1', `%/${year}/%`)));
      if (Object.keys(kept).length) db.run("UPDATE settings SET value = ? WHERE key = 'invoice_counters'", JSON.stringify(kept));
      else db.run("DELETE FROM settings WHERE key = 'invoice_counters'");
    }
    db.run("DELETE FROM settings WHERE key = 'sample_data'");
  });
  settingsService.reset();
  activity.log(db, { user: by, settings: settingsService.all(db) }, 'sample.remove',
    `Removed the sample data (${s.counts.guests} guests, ${s.counts.bookings} bookings, ${s.counts.staff} staff accounts)`, 'System');
  return s.counts;
}

/* ------------------------------------------------------------------ command line */
async function main() {
  const config = require('../config');
  const { open } = require('./index');
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const db = open(option('--db') || config.databaseUrl || config.dbPath);
  try {
    // --by you@hotel.com: the admin named in the activity log (otherwise "System").
    const by = option('--by') ? db.get('SELECT id, name FROM users WHERE lower(email) = lower(?)', option('--by')) : null;
    if (option('--by') && !by) throw fail(`No account with the email ${option('--by')}.`);
    if (args.includes('--remove')) {
      const counts = remove(db, { by });
      console.log(`Sample data removed from ${db.label}: ${counts.guests} guests, ${counts.bookings} bookings, ${counts.staff} staff accounts.`);
    } else {
      const result = await add(db, { by, siteUrl: option('--site-url') || settingsService.all(db).site_url || '' });
      const c = result.counts;
      console.log(`Sample data added to ${db.label}: ${c.guests} guests, ${c.bookings} bookings, ${c.staff} staff accounts, ${c.rooms} rooms, `
        + `${c.payments} payments, ${c.invoices} invoices.`);
      console.log(`Sample staff sign in with their email (for example ${result.staff[3].email}) and this password: ${result.password}`);
    }
  } catch (error) {
    console.error(error.status === 422 ? error.message : error);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (require.main === module) main();

module.exports = { add, remove, info, blocker };
