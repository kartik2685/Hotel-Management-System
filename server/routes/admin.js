'use strict';
/* Admin panel: hotel settings, rooms, rates, booking sources, staff, guests, activity log and night audit. */
const express = require('express');
const { requireAbility, can } = require('../lib/security');
const { Form } = require('../lib/forms');
const { hashPassword, randomToken, safeEqual } = require('../lib/auth');
const activity = require('../lib/activity');
const clock = require('../lib/clock');
const f = require('../lib/format');
const settingsService = require('../services/settings');
const integrationsService = require('../services/integrations');
const onlinePayments = require('../services/online-payments');
const shellService = require('../services/shell');
const stats = require('../services/stats');
const audit = require('../services/audit');
const registration = require('../services/registration');
const mail = require('../lib/mail');
const system = require('../services/system');
const { backupTo } = require('../db/backup');
const sample = require('../db/sample');
const website = require('../services/website');
const links = require('../services/signin-links');
const emails = require('../services/emails');
const gstReturn = require('../services/gst-return');
const taxKinds = require('../services/tax-kinds');
const seasons = require('../services/seasons');
const calendar = require('../services/calendar');
const daily = require('../services/daily');
const whatsapp = require('../services/whatsapp');
const feedback = require('../services/feedback');
const crypto = require('node:crypto');
const multer = require('multer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../config');

const PHOTOS = () => {
  try {
    const base = path.join(config.root, 'assets', 'img', 'rooms');
    const root = fs.readdirSync(base).filter((x) => /\.(jpe?g|png|webp)$/i.test(x));
    const uploadDir = path.join(base, 'uploads');
    const uploads = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir).filter((x) => /\.(jpe?g|png|webp)$/i.test(x)).map((x) => `uploads/${x}`) : [];
    return [...root, ...uploads].sort();
  } catch {
    return [];
  }
};

const router = express.Router();
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 11 } }).fields([{ name: 'photo_upload', maxCount: 1 }, { name: 'gallery_upload', maxCount: 10 }]);
const websiteImages = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 } }).fields([{ name: 'hero_upload', maxCount: 5 }, { name: 'about_upload', maxCount: 5 }]);
const websiteRoomImages = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 11 } }).fields([{ name: 'photo_upload', maxCount: 1 }, { name: 'gallery_upload', maxCount: 10 }]);
const websitePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5 } }).fields([{ name: 'photo_upload', maxCount: 5 }]);
const paymentQrUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('upi_qr_upload');
function imageExtension(file) {
  const b = file.buffer;
  if (b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return '.jpg';
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  throw Object.assign(new Error('Upload a valid JPG, PNG or WebP image (up to 5 MB each).'), { status: 422 });
}
function saveSiteImages(files) {
  if (!files?.length) return [];
  const extensions = files.map(imageExtension);
  const dir = path.join(config.root, 'assets', 'img', 'rooms', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return files.map((file, i) => {
    const name = `${crypto.randomBytes(16).toString('hex')}${extensions[i]}`;
    fs.writeFileSync(path.join(dir, name), file.buffer, { flag: 'wx' });
    return `uploads/${name}`;
  });
}
function savePaymentQr(file) {
  const extension = imageExtension(file);
  const dir = path.join(config.root, 'assets', 'img', 'payments');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}${extension}`;
  fs.writeFileSync(path.join(dir, name), file.buffer, { flag: 'wx' });
  return `/assets/img/payments/${name}`;
}
router.use(requireAbility('manage'));

const TABS = [
  { key: 'overview', href: '/admin', label: 'Overview', ability: 'manage' },
  { key: 'daily', href: '/admin/daily', label: 'Daily report', ability: 'manage' },
  { key: 'settings', href: '/admin/settings', label: 'Hotel settings', ability: 'administer' },
  { key: 'room-types', href: '/admin/room-types', label: 'Room types', ability: 'manage' },
  { key: 'rooms', href: '/admin/rooms', label: 'Rooms', ability: 'manage' },
  { key: 'rates', href: '/admin/rates', label: 'Rates & extras', ability: 'manage' },
  { key: 'calendar', href: '/admin/calendar', label: 'Rate calendar', ability: 'manage' },
  { key: 'sources', href: '/admin/sources', label: 'Booking sources', ability: 'manage' },
  { key: 'staff', href: '/admin/staff', label: 'Staff accounts', ability: 'administer' },
  { key: 'payments', href: '/admin/payments', label: 'Payments', ability: 'administer' },
  { key: 'integrations', href: '/admin/integrations', label: 'Integrations', ability: 'administer' },
  { key: 'website', href: '/admin/website', label: 'Website', ability: 'manage' },
  { key: 'guests', href: '/admin/guests', label: 'Guests', ability: 'manage' },
  { key: 'invoices', href: '/admin/invoices', label: 'Invoices', ability: 'manage' },
  { key: 'reports', href: '/admin/reports', label: 'Reports', ability: 'manage' },
  { key: 'gst-return', href: '/admin/gst-return', label: 'GST returns', ability: 'manage', gst: true },
  { key: 'activity', href: '/admin/activity', label: 'Activity log', ability: 'manage' },
  { key: 'emails', href: '/admin/emails', label: 'Emails', ability: 'administer' },
  { key: 'night-audit', href: '/admin/night-audit', label: 'Night audit', ability: 'manage' },
];
const FLASH = {
  saved: 'Changes saved.', created: 'Added.', removed: 'Removed.', closed: 'The day is closed. The business date has moved on and today’s housekeeping tasks were created.',
  password: 'Password set. The person must choose a new one when they next sign in.', 'back-in-service': 'The room is back in service.', revenue: 'Outlet revenue saved.',
  'sample-removed': 'The sample data has been removed.', 'payments-saved': 'Online payment setting saved.',
  'closed-auto': 'The day is closed: its figures are saved and tomorrow’s housekeeping tasks are ready. The business date moves on by itself at midnight.',
  'photo-added': 'Photo uploaded. It is on the live website now.', 'photo-removed': 'Photo removed from the website.',
  'photo-first': 'That photo now opens the gallery.', 'photo-none': 'Choose a JPG, PNG or WebP photo to upload first.',
  'photo-cleared': 'Photo cleared.',
};

function render(req, res, view, tab, data, status = 200) {
  const shell = shellService.build(req.db, req, tab === 'staff' ? 'admin-staff' : 'admin'); // which sidebar link is lit
  res.status(status).render(`admin/${view}`, {
    title: `${data.heading} · Admin panel · Frontdesk Hotel Management`, description: 'Frontdesk admin panel.', page: 'admin',
    css: ['pages/admin'], scripts: ['admin-upload'], shell, tab, tabs: TABS.filter((t) => can(req.user, t.ability) && (!t.gst || req.settings.tax_mode === 'gst_india')),
    flash: FLASH[req.query.ok] || '', errors: {}, values: {}, ...data,
  });
}
const back = (res, path, key) => res.redirect(303, `${path}${path.includes('?') ? '&' : '?'}ok=${key}`);
const stamp = (req) => clock.stamp(req.settings.timezone);
const toInt = (value) => Number.parseInt(value, 10) || 0;

/* ------------------------------------------------------------------ overview */
function overview(req, res, extra = {}, status = 200) {
  const db = req.db;
  const bd = settingsService.businessDate(db);
  const count = (sql, ...args) => db.get(sql, ...args).n;
  const admin = can(req.user, 'administer');
  render(req, res, 'overview', 'overview', {
    heading: 'Admin panel',
    lead: 'Everything the hotel runs on: settings, rooms and rates, staff logins and the end-of-day close.',
    cards: [
      { href: '/admin/rooms', num: count('SELECT COUNT(*) AS n FROM rooms WHERE active = 1'), label: 'rooms in service' },
      { href: '/admin/room-types', num: count('SELECT COUNT(*) AS n FROM room_types WHERE active = 1'), label: 'room types' },
      { href: '/admin/rates', num: count('SELECT COUNT(*) AS n FROM rate_plans WHERE active = 1'), label: 'rate plans' },
      { href: '/admin/staff', num: count('SELECT COUNT(*) AS n FROM users WHERE active = 1'), label: 'active staff accounts' },
      { href: '/admin/guests', num: count('SELECT COUNT(*) AS n FROM guests'), label: 'guest profiles' },
      { href: '/reservations', num: count("SELECT COUNT(*) AS n FROM reservations WHERE status IN ('confirmed', 'tentative') AND arrival >= ?", bd), label: 'upcoming bookings' },
    ],
    businessDate: f.formatDay(bd),
    demo: req.settings.demo_mode,
    recent: db.all('SELECT * FROM activity_log ORDER BY id DESC LIMIT 8'),
    // Where the data is kept (admins only): lets the owner check the Supabase connection from the browser.
    database: admin ? system.databaseInfo(db, { today: clock.hotelNow(req.settings.timezone).date }) : null,
    lastBackup: admin ? db.get("SELECT created_at, user_name FROM activity_log WHERE action = 'database.backup' ORDER BY id DESC LIMIT 1") || null : null,
    // Sample hotel (admins only): offered while the hotel has no rooms or guests of its own, removable once added.
    sample: admin ? { info: sample.info(db), blocker: sample.blocker(db) } : null,
    sampleAdded: null, sampleError: '',
    ...extra,
  }, status);
}
router.get('/', (req, res) => overview(req, res));

/* ------------------------------------------------------------------ sample data */
// Fills an empty hotel with a sample one (db/sample.js). The sample staff password is shown once, on this page.
router.post('/sample-data', requireAbility('administer'), async (req, res, next) => {
  try {
    const result = await sample.add(req.db, { by: req.user, siteUrl: website.siteUrl(req, req.settings) });
    overview(req, res, { sampleAdded: result });
  } catch (error) {
    if (error.status !== 422) return next(error);
    overview(req, res, { sampleError: error.message }, 422);
  }
});

router.post('/sample-data/remove', requireAbility('administer'), (req, res, next) => {
  if (req.body.sure !== 'on') return overview(req, res, { sampleError: 'Tick “Yes, remove the sample data” to remove it.' }, 422);
  try {
    sample.remove(req.db, { by: req.user });
  } catch (error) {
    if (error.status !== 422) return next(error);
    return overview(req, res, { sampleError: error.message }, 422);
  }
  back(res, '/admin', 'sample-removed');
});

/* ------------------------------------------------------------------ backup */
// The whole database as one SQLite file, straight to the browser. Free databases (Render, Supabase) keep no
// backups of their own, and a free Render instance has no disk to keep them on.
router.post('/backup', requireAbility('administer'), (req, res, next) => {
  const db = req.db;
  const file = path.join(os.tmpdir(), `hms-backup-${process.pid}-${crypto.randomBytes(6).toString('hex')}.db`);
  try {
    backupTo(db, file);
  } catch (error) {
    fs.rmSync(file, { force: true });
    return next(error);
  }
  activity.log(db, req, 'database.backup', 'Downloaded a backup of the database');
  const name = `frontdesk-backup-${stamp(req).replace(' ', '-').replace(':', '')}.db`;
  res.download(file, name, { headers: { 'Content-Type': 'application/vnd.sqlite3', 'Cache-Control': 'no-store' } }, () => fs.rmSync(file, { force: true }));
});

/* ------------------------------------------------------------------ settings */
// Node's list still uses some old zone names (e.g. Asia/Calcutta); show the current ones.
const RENAMED_ZONES = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'Atlantic/Faeroe': 'Atlantic/Faroe' };
const TIMEZONES = (() => {
  let zones = ['UTC', 'Asia/Kolkata', 'America/Chicago', 'Europe/London'];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    /* older runtimes: keep the short list */
  }
  return [...new Set(['UTC', ...zones.map((z) => RENAMED_ZONES[z] || z)])].sort();
})();
const validZone = (zone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }); // eslint-disable-line no-new
    return true;
  } catch {
    return false;
  }
};

router.get('/settings', requireAbility('administer'), (req, res) => {
  render(req, res, 'settings', 'settings', { heading: 'Hotel settings', lead: 'Name, money and tax, times and the business date.', s: req.settings, types: req.db.all('SELECT code, name FROM room_types WHERE active = 1 ORDER BY sort, id'), timezones: TIMEZONES, countries: registration.COUNTRIES });
});

router.post('/settings', requireAbility('administer'), (req, res) => {
  const db = req.db;
  const form = new Form(req.body);
  const v = {
    hotel_name: form.text('hotel_name', { label: 'Hotel name', max: 80, required: true }),
    hotel_city: form.text('hotel_city', { label: 'City', max: 60 }),
    hotel_address: form.text('hotel_address', { label: 'Address', max: 200 }),
    hotel_phone: form.text('hotel_phone', { label: 'Phone', max: 40 }),
    hotel_email: form.text('hotel_email', { label: 'Email', max: 120 }),
    tax_id: form.text('tax_id', { label: 'Tax number', max: 40 }),
    currency_code: form.text('currency_code', { label: 'Currency code', max: 3, required: true, pattern: /^[A-Za-z]{3}$/, message: 'Use a three-letter code such as INR or USD.' })?.toUpperCase(),
    currency_symbol: form.text('currency_symbol', { label: 'Currency symbol', max: 4, required: true }),
    currency_locale: form.oneOf('currency_locale', ['en-US', 'en-IN', 'en-GB', 'de-DE', 'fr-FR'], { label: 'Number format' }),
    tax_mode: form.oneOf('tax_mode', ['flat', 'gst_india', 'none'], { label: 'Tax rule' }),
    tax_rate: form.decimal('tax_rate', { label: 'Tax rate', min: 0, max: 50, required: false }) ?? 0,
    tax_label: form.text('tax_label', { label: 'Tax name', max: 30 }) || 'Tax',
    check_in_time: form.time('check_in_time', { label: 'Check-in time' }),
    check_out_time: form.time('check_out_time', { label: 'Check-out time' }),
    timezone: form.text('timezone', { label: 'Time zone', max: 60, required: true }),
    business_date_mode: form.oneOf('business_date_mode', ['auto', 'fixed'], { label: 'Business date' }),
    business_date: form.date('business_date', { label: 'Business date', required: req.body.business_date_mode === 'fixed' }),
    default_room_type: form.text('default_room_type', { label: 'Default room type', max: 10 }),
    confirmation_prefix: form.text('confirmation_prefix', { label: 'Confirmation prefix', max: 6, required: true, pattern: /^[A-Z0-9]{2,6}$/, message: 'Use 2 to 6 capital letters or digits, e.g. HLW.' }),
    demo_mode: form.bool('demo_mode'),
    country: form.oneOf('country', registration.COUNTRIES.map((c) => c.code), { label: 'Country' }),
    hotel_state: form.text('hotel_state', { label: 'State', max: 40 }),
    require_grc: form.bool('require_grc'),
    invoice_prefix: form.text('invoice_prefix', { label: 'Invoice prefix', max: 6, required: true, pattern: /^[A-Za-z0-9]{2,6}$/, message: 'Use 2 to 6 letters or digits.' })?.toUpperCase(),
    site_url: form.text('site_url', { label: 'Website address', max: 120, pattern: /^https?:\/\/[^\s/]+(\/.*)?$/, message: 'Start with https:// e.g. https://www.yourhotel.com' }),
  };
  if (v.timezone && !validZone(v.timezone)) form.fail('timezone', 'Choose a time zone from the list.');
  const shifts = {};
  for (const name of ['morning', 'evening', 'night']) {
    shifts[name] = [form.time(`${name}_start`, { label: 'Start' }), form.time(`${name}_end`, { label: 'End' })];
  }
  if (!form.ok) {
    return render(req, res, 'settings', 'settings', {
      heading: 'Hotel settings', lead: 'Name, money and tax, times and the business date.', s: { ...req.settings, ...form.values, shifts }, errors: form.errors,
      types: db.all('SELECT code, name FROM room_types WHERE active = 1 ORDER BY sort, id'), timezones: TIMEZONES, countries: registration.COUNTRIES,
    }, 422);
  }
  settingsService.save(db, { ...v, shifts, business_date: v.business_date || req.settings.business_date });
  activity.log(db, req, 'settings.update', 'Hotel settings updated');
  back(res, '/admin/settings', 'saved');
});

/* ------------------------------------------------------------------ room types */
function typesPage(req, res, extra = {}, status = 200) {
  const db = req.db;
  const types = db.all(`SELECT rt.*, (SELECT COUNT(*) FROM rooms WHERE room_type_id = rt.id AND active = 1) AS rooms FROM room_types rt ORDER BY rt.sort, rt.name`);
  const editing = extra.editing !== undefined ? extra.editing : (req.query.edit ? types.find((t) => t.id === toInt(req.query.edit)) : null);
  render(req, res, 'room-types', 'room-types', { heading: 'Room types', lead: 'Each type has a base rate per night, how many guests it sleeps, cleaning times and what the website shows.', types, editing, photos: PHOTOS(), galleries: req.settings.room_type_galleries || {}, ...extra }, status);
}
router.get('/room-types', (req, res) => typesPage(req, res));

router.post(['/room-types', '/room-types/:id'], imageUpload, (req, res) => {
  const db = req.db;
  const id = req.params.id ? toInt(req.params.id) : null;
  const form = new Form(req.body);
  const v = {
    code: form.text('code', { label: 'Code', max: 6, required: true, pattern: /^[A-Z0-9]{1,6}$/, message: 'Use capital letters or digits, e.g. DK.' }),
    name: form.text('name', { label: 'Name', max: 40, required: true }),
    rate: form.money('base_rate', { label: 'Base rate', min: 0, max: 1000000 }),
    max: form.int('max_guests', { label: 'Sleeps', min: 1, max: 12 }),
    clean: form.int('clean_minutes', { label: 'Departure clean', min: 5, max: 240 }),
    service: form.int('service_minutes', { label: 'Stayover service', min: 5, max: 240 }),
    sort: form.int('sort', { label: 'Order', min: 0, max: 999, required: false }) ?? 0,
    active: form.bool('active'),
    description: form.longText('description', { label: 'Description', max: 400 }),
    bed: form.text('bed', { label: 'Beds', max: 60 }),
    size: form.int('size_sqm', { label: 'Size', min: 5, max: 1000, required: false }),
    photo: form.text('photo', { label: 'Photo', max: 80 }),
    online: form.bool('online'),
  };
  if (v.photo && !PHOTOS().includes(v.photo)) form.fail('photo', 'Choose a photo from the list.');
  if (v.code && db.get('SELECT 1 FROM room_types WHERE code = ? AND id <> ?', v.code, id || 0)) form.fail('code', 'Another room type already uses this code.');
  if (id && !v.active && db.get("SELECT 1 FROM reservations WHERE room_type_id = ? AND status IN ('confirmed', 'tentative', 'checked_in')", id)) {
    form.fail('active', 'This type has current or future bookings, so it must stay active.');
  }
  if (!form.ok) return typesPage(req, res, { errors: form.errors, values: form.values, editing: id ? { id } : null }, 422);
  const files = req.files || {};
  let galleryAdded = [];
  try {
    if (files.photo_upload?.[0]) v.photo = saveSiteImages(files.photo_upload)[0];
    galleryAdded = saveSiteImages(files.gallery_upload);
  } catch (error) { return typesPage(req, res, { errors: { photo: error.message }, values: form.values, editing: id ? { id } : null }, 422); }
  if (id) {
    db.run(`UPDATE room_types SET code = ?, name = ?, base_rate_cents = ?, max_guests = ?, clean_minutes = ?, service_minutes = ?, sort = ?, active = ?,
              description = ?, bed = ?, size_sqm = ?, photo = ?, online = ? WHERE id = ?`,
    v.code, v.name, v.rate, v.max, v.clean, v.service, v.sort, v.active ? 1 : 0, v.description, v.bed, v.size, v.photo, v.online ? 1 : 0, id);
  } else {
    db.run(`INSERT INTO room_types (code, name, base_rate_cents, max_guests, clean_minutes, service_minutes, sort, active, description, bed, size_sqm, photo, online)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    v.code, v.name, v.rate, v.max, v.clean, v.service, v.sort, v.active ? 1 : 0, v.description, v.bed, v.size, v.photo, v.online ? 1 : 0);
  }
  if (galleryAdded.length) {
    const settings = settingsService.all(db);
    const galleries = { ...(settings.room_type_galleries || {}) };
    const roomTypeId = id || db.get('SELECT id FROM room_types WHERE code = ?', v.code).id;
    galleries[roomTypeId] = [...(galleries[roomTypeId] || galleries[v.code] || []), ...galleryAdded];
    settingsService.save(db, { room_type_galleries: galleries });
  }
  activity.log(db, req, 'room-type.save', `${id ? 'Updated' : 'Added'} room type ${v.name} (${f.money(v.rate)})`);
  back(res, '/admin/room-types', id ? 'saved' : 'created');
});

/* ------------------------------------------------------------------ rooms and out-of-order periods */
function roomsPage(req, res, extra = {}, status = 200) {
  const db = req.db;
  const bd = settingsService.businessDate(db);
  const rooms = db.all(
    `SELECT rm.*, rt.name AS type_name, u.name AS attendant_name,
            (SELECT reason || ' until ' || end_date FROM room_blocks b WHERE b.room_id = rm.id AND b.start_date <= ? AND b.end_date > ? LIMIT 1) AS block
       FROM rooms rm JOIN room_types rt ON rt.id = rm.room_type_id LEFT JOIN users u ON u.id = rm.attendant_id
      ORDER BY rm.floor, leading_int(rm.number), rm.number`, bd, bd,
  );
  const blocks = db.all(
    `SELECT b.*, rm.number FROM room_blocks b JOIN rooms rm ON rm.id = b.room_id WHERE b.end_date > ? ORDER BY b.start_date, leading_int(rm.number), b.id`, bd,
  ).map((b) => ({ ...b, from: f.formatDay(b.start_date), until: f.formatDay(b.end_date), current: b.start_date <= bd }));
  const editing = extra.editing !== undefined ? extra.editing : (req.query.edit ? rooms.find((r) => r.id === toInt(req.query.edit)) : null);
  render(req, res, 'rooms', 'rooms', {
    heading: 'Rooms', lead: 'Room numbers, floors and types, the usual housekeeper, and out-of-order periods.',
    rooms, blocks, editing, bd, types: db.all('SELECT id, name FROM room_types WHERE active = 1 ORDER BY sort, name'),
    attendants: db.all("SELECT id, name FROM users WHERE role = 'housekeeping' AND active = 1 ORDER BY name"), ...extra,
  }, status);
}
router.get('/rooms', (req, res) => roomsPage(req, res));

router.post(['/rooms', '/rooms/:id'], (req, res) => {
  const db = req.db;
  const id = req.params.id ? toInt(req.params.id) : null;
  const form = new Form(req.body);
  const v = {
    number: form.text('number', { label: 'Room number', max: 8, required: true, pattern: /^[A-Za-z0-9-]+$/, message: 'Use letters, digits or a dash.' }),
    floor: form.int('floor', { label: 'Floor', min: -5, max: 200 }),
    type: form.int('room_type_id', { label: 'Room type', min: 1 }),
    attendant: form.int('attendant_id', { label: 'Housekeeper', min: 1, required: false }),
    active: form.bool('active'),
  };
  if (v.number && db.get('SELECT 1 FROM rooms WHERE number = ? AND id <> ?', v.number, id || 0)) form.fail('number', 'Another room already has this number.');
  if (v.type && !db.get('SELECT 1 FROM room_types WHERE id = ?', v.type)) form.fail('room_type_id', 'Choose a room type.');
  const bd = settingsService.businessDate(db);
  if (id && !v.active && db.get("SELECT 1 FROM reservations WHERE room_id = ? AND status IN ('confirmed', 'tentative', 'checked_in') AND departure > ?", id, bd)) {
    form.fail('active', 'This room has current or future bookings. Move them to another room first.');
  }
  if (id && v.type && db.get("SELECT 1 FROM reservations WHERE room_id = ? AND room_type_id <> ? AND status IN ('confirmed', 'tentative', 'checked_in') AND departure > ?", id, v.type, bd)) {
    form.fail('room_type_id', 'Bookings of the old type are assigned to this room. Move them before changing the type.');
  }
  if (!form.ok) return roomsPage(req, res, { errors: form.errors, values: form.values, editing: id ? { id } : null }, 422);
  if (id) {
    db.run('UPDATE rooms SET number = ?, floor = ?, room_type_id = ?, attendant_id = ?, active = ? WHERE id = ?', v.number, v.floor, v.type, v.attendant, v.active ? 1 : 0, id);
  } else {
    db.run("INSERT INTO rooms (number, floor, room_type_id, attendant_id, active, hk_status, hk_updated_at) VALUES (?, ?, ?, ?, ?, 'clean', ?)",
      v.number, v.floor, v.type, v.attendant, v.active ? 1 : 0, stamp(req));
  }
  activity.log(db, req, 'room.save', `${id ? 'Updated' : 'Added'} room ${v.number}`);
  back(res, '/admin/rooms', id ? 'saved' : 'created');
});

router.post('/blocks', (req, res) => {
  const db = req.db;
  const form = new Form(req.body);
  const bd = settingsService.businessDate(db);
  const roomId = form.int('room_id', { label: 'Room', min: 1 });
  const start = form.date('start_date', { label: 'From' });
  const end = form.date('end_date', { label: 'Back in service' });
  const reason = form.text('reason', { label: 'Reason', max: 80, required: true });
  const room = roomId ? db.get('SELECT * FROM rooms WHERE id = ?', roomId) : null;
  if (roomId && !room) form.fail('room_id', 'Choose a room.');
  if (start && end && end <= start) form.fail('end_date', 'The room must come back after it goes off sale.');
  if (end && end <= bd) form.fail('end_date', 'Choose a date after the business date.');
  if (room && start && end) {
    const clash = db.get(
      "SELECT confirmation FROM reservations WHERE room_id = ? AND status IN ('confirmed', 'tentative', 'checked_in') AND arrival < ? AND departure > ? LIMIT 1", room.id, end, start,
    );
    if (clash) form.fail('start_date', `Booking ${clash.confirmation} is in this room on those dates. Move it to another room first.`);
  }
  if (!form.ok) return roomsPage(req, res, { blockErrors: form.errors, blockValues: form.values }, 422);
  db.run('INSERT INTO room_blocks (room_id, start_date, end_date, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', room.id, start, end, reason, req.user.id, stamp(req));
  db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)', 'wrench', '', `${room.number} out of order`, `${reason} · back ${f.formatDay(end)}`, stamp(req));
  activity.log(db, req, 'room.block', `Room ${room.number} out of order ${start} to ${end}: ${reason}`);
  back(res, '/admin/rooms', 'created');
});

router.post('/blocks/:id/end', (req, res, next) => {
  const db = req.db;
  const block = db.get('SELECT b.*, rm.number FROM room_blocks b JOIN rooms rm ON rm.id = b.room_id WHERE b.id = ?', toInt(req.params.id));
  if (!block) return next();
  const bd = settingsService.businessDate(db);
  if (block.start_date < bd) db.run('UPDATE room_blocks SET end_date = ? WHERE id = ?', bd, block.id);
  else db.run('DELETE FROM room_blocks WHERE id = ?', block.id);
  activity.log(db, req, 'room.unblock', `Room ${block.number} back in service`);
  back(res, '/admin/rooms', 'back-in-service');
});

/* ------------------------------------------------------------------ rate plans and extras */
function ratesPage(req, res, extra = {}, status = 200) {
  const db = req.db;
  const plans = db.all('SELECT * FROM rate_plans ORDER BY sort, name');
  const extras = db.all('SELECT * FROM extras ORDER BY sort, name');
  const gst = taxKinds.isGst(req.settings);
  const gstKinds = gst ? taxKinds.extraKinds(db, req.settings) : [];
  const types = db.all('SELECT id, code, name FROM room_types ORDER BY sort, name');
  const seasonRows = db.all('SELECT * FROM rate_seasons ORDER BY active DESC, (start_date IS NULL), start_date, id')
    .map((r) => ({ ...r, text: seasons.describe(r, (types.find((t) => t.id === r.room_type_id) || {}).name) }));
  render(req, res, 'rates', 'rates', {
    heading: 'Rates & extras', lead: 'Rate plans change the room type’s base rate; seasons and weekends change it on some nights. Extras are added to a booking per stay or per night.',
    plans, extras, gst, gstKinds, types, seasons: seasonRows, days: seasons.DAYS,
    editSeason: extra.editSeason !== undefined ? extra.editSeason : (req.query.season ? seasonRows.find((r) => r.id === toInt(req.query.season)) : null),
    editPlan: extra.editPlan !== undefined ? extra.editPlan : (req.query.plan ? plans.find((p) => p.id === toInt(req.query.plan)) : null),
    editExtra: extra.editExtra !== undefined ? extra.editExtra : (req.query.extra ? extras.find((x) => x.id === toInt(req.query.extra)) : null),
    ...extra,
  }, status);
}
router.get('/rates', (req, res) => ratesPage(req, res));

router.post(['/plans', '/plans/:id'], (req, res) => {
  const db = req.db;
  const id = req.params.id ? toInt(req.params.id) : null;
  const form = new Form(req.body);
  const v = {
    code: form.text('code', { label: 'Code', max: 8, required: true, pattern: /^[A-Z0-9]{2,8}$/, message: 'Use 2 to 8 capital letters or digits.' }),
    name: form.text('name', { label: 'Name', max: 40, required: true }),
    type: form.oneOf('adjust_type', ['amount', 'percent'], { label: 'Adjustment' }),
    description: form.text('description', { label: 'Description', max: 120 }),
    bookable: form.bool('bookable'),
    sort: form.int('sort', { label: 'Order', min: 0, max: 999, required: false }) ?? 0,
    active: form.bool('active'),
    cancelDays: form.int('free_cancel_days', { label: 'Free cancellation', min: 0, max: 60, required: false }),
    online: form.bool('online'),
  };
  v.value = v.type === 'percent' ? form.int('adjust_value', { label: 'Percent', min: -90, max: 200 }) : form.money('adjust_value', { label: 'Amount per night', min: -100000, max: 100000 });
  if (v.code && db.get('SELECT 1 FROM rate_plans WHERE code = ? AND id <> ?', v.code, id || 0)) form.fail('code', 'Another rate plan already uses this code.');
  if (!form.ok) return ratesPage(req, res, { planErrors: form.errors, planValues: form.values, editPlan: id ? { id } : null }, 422);
  if (id) {
    db.run('UPDATE rate_plans SET code = ?, name = ?, adjust_type = ?, adjust_value = ?, description = ?, bookable = ?, sort = ?, active = ?, free_cancel_days = ?, online = ? WHERE id = ?',
      v.code, v.name, v.type, v.value, v.description, v.bookable ? 1 : 0, v.sort, v.active ? 1 : 0, v.cancelDays, v.online ? 1 : 0, id);
  } else {
    db.run('INSERT INTO rate_plans (code, name, adjust_type, adjust_value, description, bookable, sort, active, free_cancel_days, online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      v.code, v.name, v.type, v.value, v.description, v.bookable ? 1 : 0, v.sort, v.active ? 1 : 0, v.cancelDays, v.online ? 1 : 0);
  }
  activity.log(db, req, 'rate-plan.save', `${id ? 'Updated' : 'Added'} rate plan ${v.name}`);
  back(res, '/admin/rates', id ? 'saved' : 'created');
});

router.post(['/extras', '/extras/:id'], (req, res) => {
  const db = req.db;
  const id = req.params.id ? toInt(req.params.id) : null;
  const form = new Form(req.body);
  const v = {
    code: form.text('code', { label: 'Code', max: 20, required: true, pattern: /^[a-z0-9-]{2,20}$/, message: 'Use lower-case letters, digits or dashes.' }),
    name: form.text('name', { label: 'Name', max: 40, required: true }),
    price: form.money('price', { label: 'Price', min: 0, max: 100000 }),
    per: form.oneOf('per', ['stay', 'night'], { label: 'Charged' }),
    sort: form.int('sort', { label: 'Order', min: 0, max: 999, required: false }) ?? 0,
    active: form.bool('active'),
    // GST on the extra (GST hotels only): elsewhere the field is not shown and the kind stays as it is
    gstKind: taxKinds.isGst(req.settings) ? form.oneOf('gst_kind', taxKinds.EXTRA_KINDS.map((k) => k.value), { label: 'GST' }) : null,
  };
  if (v.code && db.get('SELECT 1 FROM extras WHERE code = ? AND id <> ?', v.code, id || 0)) form.fail('code', 'Another extra already uses this code.');
  if (!form.ok) return ratesPage(req, res, { extraErrors: form.errors, extraValues: form.values, editExtra: id ? { id } : null }, 422);
  if (id) db.run('UPDATE extras SET code = ?, name = ?, price_cents = ?, per = ?, sort = ?, active = ?, gst_kind = COALESCE(?, gst_kind) WHERE id = ?', v.code, v.name, v.price, v.per, v.sort, v.active ? 1 : 0, v.gstKind, id);
  else db.run('INSERT INTO extras (code, name, price_cents, per, sort, active, gst_kind) VALUES (?, ?, ?, ?, ?, ?, ?)', v.code, v.name, v.price, v.per, v.sort, v.active ? 1 : 0, v.gstKind || 'none');
  activity.log(db, req, 'extra.save', `${id ? 'Updated' : 'Added'} extra ${v.name}`);
  back(res, '/admin/rates', id ? 'saved' : 'created');
});

/* ------------------------------------------------------------------ the owner's morning report */
router.get('/daily', (req, res) => {
  const day = daily.isDate(req.query.day) ? req.query.day : daily.defaultDay(req.db);
  const r = daily.build(req.db, day);
  render(req, res, 'daily', 'daily', {
    heading: 'Daily report', lead: 'How a day went and what today holds, on one page: for the owner every morning.',
    r, message: daily.text(req.settings, r), whatsapp: whatsapp.link('', daily.text(req.settings, r)), today: settingsService.businessDate(req.db), stars: feedback.stars,
    scripts: ['pages/print'],
  });
});

/* ------------------------------------------------------------------ rate and availability calendar */
router.get('/calendar', (req, res) => {
  const from = calendar.isDate(req.query.from) ? req.query.from : settingsService.businessDate(req.db);
  render(req, res, 'calendar', 'calendar', {
    heading: 'Rate calendar', lead: 'The room rate and the rooms still free for every room type, 30 nights at a time. Rates include seasons and weekends, before a rate plan.',
    c: calendar.build(req.db, from), today: settingsService.businessDate(req.db),
  });
});

/* ------------------------------------------------------------------ seasons and weekends */
router.post(['/seasons', '/seasons/:id'], (req, res) => {
  const db = req.db;
  const id = req.params.id ? toInt(req.params.id) : null;
  const form = new Form(req.body);
  const v = {
    name: form.text('name', { label: 'Name', max: 40, required: true }),
    from: form.date('start_date', { label: 'From', required: false }),
    to: form.date('end_date', { label: 'To', required: false }),
    weekdays: [0, 1, 2, 3, 4, 5, 6].filter((d) => form.bool(`day_${d}`)).join(''),
    typeId: form.int('room_type_id', { label: 'Room type', min: 1, required: false }),
    type: form.oneOf('adjust_type', ['percent', 'amount'], { label: 'Change' }),
    active: form.bool('active'),
  };
  v.value = v.type === 'amount' ? form.money('adjust_value', { label: 'Amount', min: -100000, max: 100000 }) : form.int('adjust_value', { label: 'Percentage', min: -90, max: 300 });
  if (Boolean(v.from) !== Boolean(v.to)) form.fail(v.from ? 'end_date' : 'start_date', 'Give both dates, or neither for every week.');
  else if (v.from && v.to < v.from) form.fail('end_date', 'The last night comes after the first.');
  else if (v.from && f.daysBetween(v.from, v.to) > 366) form.fail('end_date', 'A season lasts at most a year.');
  if (!v.from && !v.weekdays) form.fail('start_date', 'Choose dates, days of the week, or both.');
  if (v.value === 0) form.fail('adjust_value', 'A change of 0 changes nothing.');
  if (v.typeId && !db.get('SELECT 1 FROM room_types WHERE id = ?', v.typeId)) form.fail('room_type_id', 'Choose a room type.');
  if (!form.ok) return ratesPage(req, res, { seasonErrors: form.errors, seasonValues: form.values, editSeason: id ? { id } : null }, 422);
  const args = [v.name, v.from || null, v.to || null, v.weekdays, v.typeId || null, v.type, v.value, v.active ? 1 : 0];
  if (id) db.run('UPDATE rate_seasons SET name = ?, start_date = ?, end_date = ?, weekdays = ?, room_type_id = ?, adjust_type = ?, adjust_value = ?, active = ? WHERE id = ?', ...args, id);
  else db.run('INSERT INTO rate_seasons (name, start_date, end_date, weekdays, room_type_id, adjust_type, adjust_value, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ...args, stamp(req));
  activity.log(db, req, 'season.save', `${id ? 'Updated' : 'Added'} rates for ${v.name}`);
  back(res, '/admin/rates', id ? 'saved' : 'created');
});

/* ------------------------------------------------------------------ booking sources */
function sourcesPage(req, res, extra = {}, status = 200) {
  const sources = req.db.all('SELECT * FROM sources ORDER BY sort, name');
  render(req, res, 'sources', 'sources', {
    heading: 'Booking sources', lead: 'Where bookings come from. Sources with a form position appear on the new booking form.',
    sources, editing: extra.editing !== undefined ? extra.editing : (req.query.edit ? sources.find((s) => s.id === toInt(req.query.edit)) : null), ...extra,
  }, status);
}
router.get('/sources', (req, res) => sourcesPage(req, res));

router.post(['/sources', '/sources/:id'], (req, res) => {
  const db = req.db;
  const id = req.params.id ? toInt(req.params.id) : null;
  const form = new Form(req.body);
  const v = {
    name: form.text('name', { label: 'Name', max: 40, required: true }),
    kind: form.oneOf('kind', ['direct', 'ota', 'corporate', 'walk_in'], { label: 'Kind' }),
    sort: form.int('sort', { label: 'Order', min: 0, max: 999, required: false }) ?? 0,
    formSort: form.int('form_sort', { label: 'Form position', min: 1, max: 99, required: false }),
    active: form.bool('active'),
  };
  if (v.name && db.get('SELECT 1 FROM sources WHERE lower(name) = lower(?) AND id <> ?', v.name, id || 0)) form.fail('name', 'This source already exists.');
  if (!form.ok) return sourcesPage(req, res, { errors: form.errors, values: form.values, editing: id ? { id } : null }, 422);
  if (id) db.run('UPDATE sources SET name = ?, kind = ?, sort = ?, form_sort = ?, active = ? WHERE id = ?', v.name, v.kind, v.sort, v.formSort, v.active ? 1 : 0, id);
  else db.run('INSERT INTO sources (name, kind, sort, form_sort, active) VALUES (?, ?, ?, ?, ?)', v.name, v.kind, v.sort, v.formSort, v.active ? 1 : 0);
  activity.log(db, req, 'source.save', `${id ? 'Updated' : 'Added'} booking source ${v.name}`);
  back(res, '/admin/sources', id ? 'saved' : 'created');
});

/* ------------------------------------------------------------------ staff accounts */
const ROLES = [
  { value: 'admin', label: 'Admin — everything, including settings and staff' },
  { value: 'manager', label: 'Manager — front office plus rooms, rates and reports' },
  { value: 'frontdesk', label: 'Front desk — bookings, check-in and check-out' },
  { value: 'housekeeping', label: 'Housekeeping — room board and task sheets' },
];
/* "Mon 26 Oct, 12:20" in hotel time, for when a link stops working. */
const untilText = (ms, timeZone) => new Intl.DateTimeFormat('en-GB', {
  timeZone: timeZone || 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(ms));

function staffPage(req, res, extra = {}, status = 200) {
  const now = Date.now();
  const staff = req.db.all(`SELECT id, name, email, role, title, department, shift, area, floor, ${links.PERSON_COLUMNS} FROM users ORDER BY active DESC, role, name`)
    .map((person) => {
      const invite = links.inviteState(person, now);
      return { ...person, invite, inviteUntil: invite === 'sent' ? untilText(person.invite_until, req.settings.timezone) : '' };
    });
  render(req, res, 'staff', 'staff', {
    heading: 'Staff accounts', lead: 'Who can sign in, and what each person may do.', staff, roles: ROLES, me: req.user.id,
    scripts: extra.linkMade ? ['pages/staff'] : [],
    editing: extra.editing !== undefined ? extra.editing : (req.query.edit ? staff.find((s) => s.id === toInt(req.query.edit)) : null), ...extra,
  }, status);
}
router.get('/staff', requireAbility('administer'), (req, res) => staffPage(req, res));

router.post(['/staff', '/staff/:id'], requireAbility('administer'), async (req, res, next) => {
  try {
    const db = req.db;
    const id = req.params.id ? toInt(req.params.id) : null;
    const existing = id ? db.get('SELECT * FROM users WHERE id = ?', id) : null;
    if (id && !existing) return next();
    const form = new Form(req.body);
    const v = {
      name: form.text('name', { label: 'Name', max: 60, required: true }),
      email: form.email('email'),
      role: form.oneOf('role', ROLES.map((r) => r.value), { label: 'Role' }),
      title: form.text('title', { label: 'Job title', max: 60 }),
      department: form.text('department', { label: 'Department', max: 40 }),
      shift: form.oneOf('shift', ['morning', 'evening', 'night'], { label: 'Usual shift' }),
      area: form.text('area', { label: 'Housekeeping area', max: 40 }),
      floor: form.int('floor', { label: 'Home floor', min: -5, max: 200, required: false }),
      active: form.bool('active'),
    };
    // A new account without a password gets an invite link instead: the person chooses their own.
    const password = String(req.body.password || '');
    if (password && (password.length < 8 || password.length > 200)) form.fail('password', 'Use 8 to 200 characters.');
    if (v.email && db.get('SELECT 1 FROM users WHERE lower(email) = lower(?) AND id <> ?', v.email, id || 0)) form.fail('email', 'Another account already uses this email.');
    if (existing && existing.id === req.user.id && (!v.active || v.role !== 'admin')) form.fail('role', 'You can’t remove your own admin access or deactivate yourself.');
    const otherAdmins = db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", id || 0).n;
    if (existing && existing.role === 'admin' && (v.role !== 'admin' || !v.active) && otherAdmins === 0) form.fail('role', 'Keep at least one active admin.');
    if (!form.ok) return staffPage(req, res, { errors: form.errors, values: form.values, editing: id ? { id } : null }, 422);

    const invite = !id && !password;
    // An invited account gets a password nobody knows until the person opens the link.
    const hash = password ? await hashPassword(password) : invite ? await hashPassword(randomToken()) : null;
    let newId = null;
    if (id) {
      db.run('UPDATE users SET name = ?, email = ?, role = ?, title = ?, department = ?, shift = ?, area = ?, floor = ?, active = ? WHERE id = ?',
        v.name, v.email, v.role, v.title, v.department, v.shift, v.area || null, v.floor, v.active ? 1 : 0, id);
      if (hash) db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', hash, id);
      if (!v.active || hash) db.run('DELETE FROM sessions WHERE user_id = ?', id); // sign them out everywhere
    } else {
      let code = f.initials(v.name).toLowerCase() || 'st';
      for (let n = 2; db.get('SELECT 1 FROM users WHERE code = ?', code); n++) code = `${f.initials(v.name).toLowerCase()}${n}`;
      newId = db.get(`INSERT INTO users (name, email, password_hash, role, title, department, shift, code, area, floor, active, must_change_password, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      v.name, v.email, hash, v.role, v.title, v.department, v.shift, code, v.area || null, v.floor, v.active ? 1 : 0, invite ? 0 : 1, stamp(req)).id;
    }
    activity.log(db, req, 'staff.save', `${id ? 'Updated' : 'Added'} staff account ${v.name} (${v.role})${hash && !invite ? ', password set' : ''}`);
    if (invite) {
      if (v.active) return sendLink(req, res, { id: newId, name: v.name, email: v.email }, 'invite');
      links.create(db, newId, 'invite'); // marks the account as invited: send a link once it may sign in
    }
    back(res, '/admin/staff', hash && id ? 'password' : id ? 'saved' : 'created');
  } catch (error) {
    next(error);
  }
});

/* A one-time link for someone to choose their own password, shown once to the admin (to send on WhatsApp or
   copy) and emailed to the person when email is set up. Earlier open links for them stop working. */
function sendLink(req, res, person, kind) {
  const db = req.db;
  const token = links.create(db, person.id, kind, { replace: true });
  const link = website.siteUrl(req, req.settings) + links.pathOf(kind, token);
  mail.send(db, req.settings, emails.staffLink(req.settings, person, link, req.user, kind, links.LASTS[kind]));
  activity.log(db, req, 'staff.link', `${kind === 'invite' ? 'Invite link' : 'Password link'} made for ${person.name}`);
  const first = person.name.split(' ')[0];
  const message = kind === 'invite'
    ? `Hello ${first}, here is your link to set up your Frontdesk account at ${req.settings.hotel_name}. It works once, for ${links.LASTS[kind]}: ${link}`
    : `Hello ${first}, here is a link to choose a new Frontdesk password. It works once, for ${links.LASTS[kind]}: ${link}`;
  staffPage(req, res, {
    linkMade: { kind, name: person.name, email: person.email, link, lasts: links.LASTS[kind], emailed: mail.configured(), whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}` },
  });
}

router.post('/staff/:id/link', requireAbility('administer'), (req, res, next) => {
  const person = req.db.get(`SELECT id, name, email, ${links.PERSON_COLUMNS} FROM users WHERE id = ?`, toInt(req.params.id));
  if (!person) return next();
  if (!person.active) return staffPage(req, res, { linkError: `${person.name} can’t sign in at the moment: tick “Can sign in” and save first.` }, 422);
  if (person.id === req.user.id) return staffPage(req, res, { linkError: 'Change your own password in My account.' }, 422);
  sendLink(req, res, person, links.kindFor(person));
});

/* ------------------------------------------------------------------ online payments */
function reportDate(value, fallback) {
  const day = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fallback;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ? fallback : day;
}

router.get('/payments', requireAbility('administer'), (req, res) => {
  const db = req.db;
  const today = settingsService.businessDate(db);
  const from = reportDate(req.query.from, today);
  const to = reportDate(req.query.to, today);
  const shifts = ['morning', 'evening', 'night', 'Online', 'Unassigned'];
  const staffChoices = db.all("SELECT DISTINCT taken_by_name AS name FROM payments WHERE taken_by_name <> '' ORDER BY taken_by_name").map((r) => r.name);
  const methodChoices = db.all("SELECT DISTINCT method FROM payments ORDER BY method").map((r) => r.method);
  const shift = shifts.includes(String(req.query.shift || '')) ? String(req.query.shift) : '';
  const staff = staffChoices.includes(String(req.query.staff || '')) ? String(req.query.staff) : '';
  const method = methodChoices.includes(String(req.query.method || '')) ? String(req.query.method) : '';
  const clauses = ['substr(p.created_at, 1, 10) >= ?', 'substr(p.created_at, 1, 10) <= ?'];
  const args = [from, to];
  if (shift === 'Unassigned') clauses.push("COALESCE(NULLIF(p.shift, ''), 'Unassigned') = 'Unassigned'");
  else if (shift) { clauses.push('p.shift = ?'); args.push(shift); }
  if (staff) { clauses.push('p.taken_by_name = ?'); args.push(staff); }
  if (method) { clauses.push('p.method = ?'); args.push(method); }
  const where = clauses.join(' AND ');
  const totals = db.get(`SELECT COUNT(*) AS count,
    COALESCE(SUM(CASE WHEN p.amount_cents > 0 THEN p.amount_cents ELSE 0 END), 0) AS collected_cents,
    COALESCE(SUM(CASE WHEN p.amount_cents < 0 THEN -p.amount_cents ELSE 0 END), 0) AS refunded_cents,
    COALESCE(SUM(p.amount_cents), 0) AS net_cents FROM payments p WHERE ${where}`, ...args);
  const byStaffShift = db.all(`SELECT p.taken_by_name AS staff, COALESCE(NULLIF(p.shift, ''), 'Unassigned') AS shift,
    COUNT(*) AS count, COALESCE(SUM(CASE WHEN p.amount_cents > 0 THEN p.amount_cents ELSE 0 END), 0) AS collected_cents,
    COALESCE(SUM(CASE WHEN p.amount_cents < 0 THEN -p.amount_cents ELSE 0 END), 0) AS refunded_cents,
    COALESCE(SUM(p.amount_cents), 0) AS net_cents
    FROM payments p WHERE ${where} GROUP BY p.taken_by_name, COALESCE(NULLIF(p.shift, ''), 'Unassigned')
    ORDER BY shift, staff`, ...args);
  const paymentRows = db.all(`SELECT p.id, p.created_at, p.amount_cents, p.method, p.reference, p.taken_by_name, p.shift,
    r.confirmation, g.first_name || ' ' || g.last_name AS guest
    FROM payments p JOIN reservations r ON r.id = p.reservation_id JOIN guests g ON g.id = r.guest_id
    WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT 500`, ...args);
  const byMethod = db.all(`SELECT p.method, COUNT(*) AS count,
    COALESCE(SUM(CASE WHEN p.amount_cents > 0 THEN p.amount_cents ELSE 0 END), 0) AS collected_cents,
    COALESCE(SUM(CASE WHEN p.amount_cents < 0 THEN -p.amount_cents ELSE 0 END), 0) AS refunded_cents,
    COALESCE(SUM(p.amount_cents), 0) AS net_cents
    FROM payments p WHERE ${where} GROUP BY p.method ORDER BY net_cents DESC, p.method`, ...args);
  const integration = integrationsService.integrationStatus().find((item) => item.key === 'payments');
  render(req, res, 'payments', 'payments', {
    heading: 'Payments & shift report',
    lead: 'Review payment totals by date, method, staff member and shift, alongside guest UPI controls and checkout status.',
    onlinePaymentsEnabled: Boolean(req.settings.online_payments_enabled),
    manualUpiEnabled: Boolean(req.settings.manual_upi_enabled),
    manualUpiId: req.settings.manual_upi_id || '',
    manualUpiQr: req.settings.manual_upi_qr || '',
    providerConfigured: onlinePayments.configured(), integration,
    reportFilters: { from, to, shift, staff, method }, shifts, staffChoices, methodChoices,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)])),
    byStaffShift: byStaffShift.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, ['collected_cents', 'refunded_cents', 'net_cents', 'count'].includes(key) ? Number(value) : value]))),
    paymentRows: paymentRows.map((row) => ({ ...row, amount_cents: Number(row.amount_cents) })),
    byMethod: byMethod.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, ['collected_cents', 'refunded_cents', 'net_cents', 'count'].includes(key) ? Number(value) : value]))),
    paymentError: ({
      'configure-first': 'YOUPI checkout was not enabled: configure an authorized test endpoint, merchant ID, webhook secret, and PAYMENT_MODE=test first.',
      'upi-id': 'Enter a valid merchant UPI ID/VPA (for example, merchant@bank) before enabling guest UPI payments.',
      'upi-qr': 'The QR upload was not accepted. Use a valid PNG, JPG or WebP image up to 5 MB.',
    })[req.query.error] || '',
    attempts: db.all(`SELECT a.id, r.confirmation, a.order_id, a.amount_cents, a.currency, a.status, a.created_at
      FROM payment_attempts a JOIN reservations r ON r.id = a.reservation_id ORDER BY a.id DESC LIMIT 25`),
    events: db.all("SELECT external_event_id, event_type, status, received_at FROM integration_events WHERE provider = 'youpi' AND direction = 'inbound' ORDER BY id DESC LIMIT 25"),
  });
});

router.post('/payments', requireAbility('administer'), (req, res) => {
  const enabled = req.body.enabled === 'on';
  if (enabled && !onlinePayments.configured()) return res.redirect(303, '/admin/payments?error=configure-first');
  settingsService.save(req.db, { online_payments_enabled: enabled });
  activity.log(req.db, req, 'payments.toggle', `YOUPI test checkout ${enabled ? 'enabled' : 'disabled'}`);
  back(res, '/admin/payments', 'payments-saved');
});

router.post('/payments/upi', requireAbility('administer'), paymentQrUpload, (req, res, next) => {
  if (!req.session || !safeEqual(req.body?._csrf, req.session.csrf_token)) {
    const error = Object.assign(new Error('Your session form expired. Reload the page and try again.'), { status: 403 });
    return next(error);
  }
  const enabled = req.body.upi_enabled === 'on';
  const upiId = String(req.body.upi_id || '').trim();
  if (enabled && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,100}@[A-Za-z0-9][A-Za-z0-9.-]{1,50}$/.test(upiId)) {
    return res.redirect(303, '/admin/payments?error=upi-id');
  }
  let qr = settingsService.all(req.db).manual_upi_qr || '';
  if (req.file) {
    try { qr = savePaymentQr(req.file); } catch { return res.redirect(303, '/admin/payments?error=upi-qr'); }
  }
  settingsService.save(req.db, { manual_upi_enabled: enabled, manual_upi_id: upiId, manual_upi_qr: qr });
  activity.log(req.db, req, 'payments.upi', `Guest direct UPI QR ${enabled ? 'enabled' : 'disabled'}`);
  back(res, '/admin/payments', 'payments-saved');
});

/* ------------------------------------------------------------------ integrations */
router.get('/integrations', requireAbility('administer'), (req, res) => {
  render(req, res, 'integrations', 'integrations', {
    heading: 'Integrations',
    lead: 'Optional payment, messaging, channel-manager and property connections. Secrets are read from environment variables and never shown here.',
    integrations: integrationsService.integrationStatus(),
  });
});

/* ------------------------------------------------------------------ guests */
router.get('/guests', (req, res) => {
  const db = req.db;
  const q = String(req.query.q || '').trim().slice(0, 60);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const guests = db.all(
    `SELECT g.*, (SELECT COUNT(*) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_in', 'checked_out')) + g.prior_stays AS stays,
            (SELECT MAX(arrival) FROM reservations r WHERE r.guest_id = g.id AND r.status <> 'cancelled') AS last_arrival
       FROM guests g ${q ? "WHERE lower(g.first_name || ' ' || g.last_name) LIKE lower(?) OR lower(g.email) LIKE lower(?) OR lower(g.phone) LIKE lower(?)" : ''}
      ORDER BY g.vip DESC, last_arrival DESC NULLS LAST, g.id LIMIT 100`, ...(q ? [like, like, like] : []),
  );
  render(req, res, 'guests', 'guests', { heading: 'Guests', lead: 'Search every guest profile. Open one to change contact details, preferences or notes.', guests, q });
});

/* ------------------------------------------------------------------ admin manual: content is generated from live settings; iframe is the current website, never a stored screenshot. */
const TAB_GUIDE = {
  overview: 'Hotel health, key counts, backups and optional sample data. Use the cards to jump to a section.',
  daily: 'Today’s arrivals, departures, occupancy and revenue at a glance.',
  settings: 'Hotel identity, currency, taxes, timezone, check-in/out times and business-date rules.',
  'room-types': 'Room categories, guest capacity, nightly base rates and the descriptions/photos shown to guests.',
  rooms: 'Physical room numbers, floors, housekeeping assignment and out-of-order dates.',
  rates: 'Rate plans, online availability, cancellation rules and sellable extras.',
  calendar: 'Date-specific seasonal pricing. Higher-priority date rules affect quotes automatically.',
  sources: 'Channels used to label and report where reservations came from.',
  staff: 'Create staff logins and assign role-based permissions.',
  website: 'Turn the guest booking site on/off and edit its live copy, policies, amenities and imagery.',
  guests: 'Search and maintain guest profiles and stay history.',
  invoices: 'Find and reprint invoices already issued.',
  reports: 'Operational, revenue and guest-feedback summaries.',
  'gst-return': 'Review GST tax totals and export return-support figures.',
  activity: 'Auditable log of important staff actions.',
  emails: 'Review queued booking and account emails; delivery requires SMTP settings.',
  'night-audit': 'Close a business day, preserve its totals and prepare the next day.'
};
router.get('/guide', (req, res) => {
  const tabs = TABS.filter((t) => can(req.user, t.ability) && (!t.gst || req.settings.tax_mode === 'gst_india'));
  const types = req.db.all('SELECT name, description, photo, online, active FROM room_types ORDER BY sort, name');
  render(req, res, 'guide', 'guide', {
    heading: 'Admin manual', lead: 'A live, automatically updated guide to every admin section and the guest website.',
    guideTabs: tabs.map((t) => ({ ...t, help: TAB_GUIDE[t.key] || 'Open this section to review and manage its hotel records.' })),
    s: req.settings, types, scripts: ['pages/print'],
  });
});

/* ------------------------------------------------------------------ guest website */
/* Every photo on the guest site, in one place: the homepage hero, the About section and each room
   type's cover and gallery. The photos shipped with the app live in assets/img/rooms; uploads go to
   assets/img/rooms/uploads and are the only files a removal ever deletes. */
const SITE_PHOTO = /^(?:[a-z0-9][\w-]*\/)*[\w.-]+\.(?:jpe?g|png|webp)$/i;
const photoUploadDir = () => path.join(config.root, 'assets', 'img', 'rooms', 'uploads');

function siteGallery(settings, kind) {
  const list = kind === 'hero'
    ? (settings.site_hero_images || (settings.site_hero_image ? [settings.site_hero_image] : []))
    : (settings.site_about_images || (settings.site_about_image ? [settings.site_about_image] : []));
  return Array.isArray(list) ? list.filter((name) => typeof name === 'string' && SITE_PHOTO.test(name)) : [];
}
function roomGallery(settings, type) {
  const galleries = settings.room_type_galleries || {};
  const list = galleries[type.id] || galleries[type.code] || [];
  return Array.isArray(list) ? list.filter((name) => typeof name === 'string' && SITE_PHOTO.test(name)) : [];
}
/* Only uploaded files are deleted; the photos that come with the app are never touched. */
function removeUploadedPhoto(name) {
  if (typeof name !== 'string' || !name.startsWith('uploads/') || !SITE_PHOTO.test(name)) return;
  fs.rmSync(path.join(photoUploadDir(), path.basename(name)), { force: true });
}
const photosOf = (names) => names.map((name) => ({ name, url: website.imageUrl(name) }));

/* "Everything the website shows" and where it is edited. */
function siteChecklist(req) {
  const s = req.settings;
  const db = req.db;
  const types = db.all('SELECT * FROM room_types WHERE active = 1 ORDER BY sort, name');
  const online = types.filter((t) => t.online).length;
  const withPhoto = types.filter((t) => t.online && t.photo).length;
  const row = (label, where, href, value, ok) => ({ label, where, href, value, ok });
  return [
    row('Hotel name', 'Hotel settings', '/admin/settings', s.hotel_name || 'Not set', Boolean(s.hotel_name)),
    row('City and address', 'Hotel settings', '/admin/settings', [s.hotel_city, s.hotel_address].filter(Boolean).join(', ') || 'Not set', Boolean(s.hotel_city || s.hotel_address)),
    row('Phone and email', 'Hotel settings', '/admin/settings', [s.hotel_phone, s.hotel_email].filter(Boolean).join(' · ') || 'Not set', Boolean(s.hotel_phone || s.hotel_email)),
    row('Check-in / check-out times', 'Hotel settings', '/admin/settings', `${s.check_in_time} / ${s.check_out_time}`, Boolean(s.check_in_time && s.check_out_time)),
    row('Rooms on the website', 'Room types', '/admin/room-types', `${online} of ${types.length} room type(s) bookable online`, online > 0),
    row('Room photos', 'Room types and this page', '#rooms', `${withPhoto} of ${online} online room type(s) have a photo`, online > 0 && withPhoto === online),
    row('Prices and rate plans', 'Rates & extras', '/admin/rates', `${db.get('SELECT COUNT(*) AS n FROM rate_plans WHERE active = 1').n} active plan(s)`, db.get('SELECT COUNT(*) AS n FROM rate_plans WHERE active = 1 AND bookable = 1').n > 0),
    row('Tagline', 'This page', '#site-text', s.site_tagline || 'Not set', Boolean(s.site_tagline)),
    row('Introduction (About)', 'This page', '#site-text', s.site_intro ? `${s.site_intro.slice(0, 70)}${s.site_intro.length > 70 ? '…' : ''}` : 'Not set', Boolean(s.site_intro)),
    row('Amenities', 'This page', '#site-text', s.site_amenities && s.site_amenities.length ? `${s.site_amenities.length} item(s)` : 'Not set', Boolean(s.site_amenities && s.site_amenities.length)),
    row('Policies', 'This page', '#site-text', s.site_policies ? 'Added' : 'Not set', Boolean(s.site_policies)),
    row('Hero photos', 'This page', '#photos', `${siteGallery(s, 'hero').length} photo(s)`, siteGallery(s, 'hero').length > 0),
    row('About photos', 'This page', '#photos', `${siteGallery(s, 'about').length} photo(s)`, siteGallery(s, 'about').length > 0),
    row('Payment on the booking page', 'Payments', '/admin/payments',
      s.online_payments_enabled ? 'Online payment on' : (s.manual_upi_enabled && s.manual_upi_id ? 'UPI QR added' : 'Pay at the hotel'), true),
  ];
}

function websitePage(req, res, extra = {}, status = 200) {
  const s = req.settings;
  const galleries = s.room_type_galleries || {};
  const types = req.db.all('SELECT * FROM room_types ORDER BY sort, name').map((t) => ({
    ...t, cover: t.photo ? website.imageUrl(t.photo) : '',
    gallery: photosOf(roomGallery(s, t)), shown: Boolean(t.active && t.online),
  }));
  render(req, res, 'website', 'website', {
    heading: 'Website', lead: 'The guest website at /hotel: what guests see, what they can book, and every photo and text on it.',
    s, types, heroPhotos: photosOf(siteGallery(s, 'hero')), aboutPhotos: photosOf(siteGallery(s, 'about')), checklist: siteChecklist(req),
    defaultHero: website.imageUrl('lobby.jpg'), photoError: '', ...extra,
  }, status);
}
router.get('/website', (req, res) => websitePage(req, res));
router.post('/website', websiteImages, (req, res) => {
  const form = new Form(req.body);
  const v = {
    site_enabled: form.bool('site_enabled'),
    site_tagline: form.text('site_tagline', { label: 'Tagline', max: 140 }),
    site_intro: form.longText('site_intro', { label: 'Introduction', max: 600 }),
    site_amenities: form.list('site_amenities', { max: 12, maxLength: 60 }),
    site_policies: form.longText('site_policies', { label: 'Policies', max: 800 }),
    review_url: form.text('review_url', { label: 'Google review link', max: 300 }),
  };
  if (v.review_url && !/^https:\/\/\S+$/.test(v.review_url)) form.fail('review_url', 'Paste the full link, starting with https://');
  if (!form.ok) return websitePage(req, res, { errors: form.errors, values: form.values }, 422);
  try {
    const images = req.files || {};
    const addedHero = saveSiteImages(images.hero_upload);
    const addedAbout = saveSiteImages(images.about_upload);
    if (addedHero.length) v.site_hero_images = [...siteGallery(req.settings, 'hero'), ...addedHero];
    if (addedAbout.length) v.site_about_images = [...siteGallery(req.settings, 'about'), ...addedAbout];
  } catch (error) { return websitePage(req, res, { errors: { site_tagline: error.message }, values: form.values }, 422); }
  settingsService.save(req.db, v);
  activity.log(req.db, req, 'website.update', `Website ${v.site_enabled ? 'on' : 'off'}; texts updated`);
  back(res, '/admin/website', 'saved');
});

/* Upload photos into the homepage hero or the About section without re-saving the texts. */
router.post('/website/photos/:kind', websitePhotoUpload, (req, res, next) => {
  const kind = req.params.kind;
  if (!['hero', 'about'].includes(kind)) return next();
  const files = (req.files && (req.files.photo_upload || [])) || [];
  let added = [];
  try {
    added = saveSiteImages(files);
  } catch (error) {
    return websitePage(req, res, { photoError: error.message }, 422);
  }
  if (!added.length) return res.redirect(303, '/admin/website?ok=photo-none#photos');
  const key = kind === 'hero' ? 'site_hero_images' : 'site_about_images';
  const legacy = kind === 'hero' ? 'site_hero_image' : 'site_about_image';
  settingsService.save(req.db, { [key]: [...siteGallery(req.settings, kind), ...added], [legacy]: null });
  activity.log(req.db, req, 'website.photos', `${added.length} ${kind} photo(s) uploaded to the website`);
  res.redirect(303, '/admin/website?ok=photo-added#photos');
});
/* Remove one photo, or move it to the front (the first hero photo is the big one on the homepage). */
router.post(['/website/photos/:kind/remove', '/website/photos/:kind/first'], (req, res, next) => {
  const kind = req.params.kind;
  const action = req.path.endsWith('/remove') ? 'remove' : 'first';
  if (!['hero', 'about'].includes(kind)) return next();
  const name = String(req.body.name || '');
  const list = siteGallery(req.settings, kind);
  const at = list.indexOf(name);
  if (at < 0) return res.redirect(303, '/admin/website#photos');
  const ordered = list.slice();
  ordered.splice(at, 1);
  if (action === 'first') ordered.unshift(name);
  const key = kind === 'hero' ? 'site_hero_images' : 'site_about_images';
  const legacy = kind === 'hero' ? 'site_hero_image' : 'site_about_image';
  settingsService.save(req.db, { [key]: ordered.length ? ordered : null, [legacy]: null });
  if (action === 'remove') removeUploadedPhoto(name);
  activity.log(req.db, req, 'website.photos', `${action === 'remove' ? 'Removed' : 'Moved to the front'} ${kind} photo ${name.split('/').pop()}`);
  res.redirect(303, `/admin/website?ok=${action === 'remove' ? 'photo-removed' : 'photo-first'}#photos`);
});
/* A room type's cover photo and gallery, uploaded from the website page. */
router.post('/website/room/:id/photo', websiteRoomImages, (req, res, next) => {
  const type = req.db.get('SELECT * FROM room_types WHERE id = ?', toInt(req.params.id));
  if (!type) return next();
  const files = req.files || {};
  let cover;
  let added = [];
  try {
    cover = saveSiteImages(files.photo_upload)[0];
    added = saveSiteImages(files.gallery_upload);
  } catch (error) {
    return websitePage(req, res, { photoError: error.message }, 422);
  }
  if (!cover && !added.length) return res.redirect(303, '/admin/website?ok=photo-none#rooms');
  if (cover) req.db.run('UPDATE room_types SET photo = ? WHERE id = ?', cover, type.id);
  if (added.length) {
    const galleries = { ...(req.settings.room_type_galleries || {}) };
    galleries[type.id] = [...roomGallery(req.settings, type), ...added];
    delete galleries[type.code];
    settingsService.save(req.db, { room_type_galleries: galleries });
  }
  activity.log(req.db, req, 'website.photos', `${type.name}: ${cover ? 'new cover photo, ' : ''}${added.length} gallery photo(s) added on the website page`);
  res.redirect(303, '/admin/website?ok=photo-added#rooms');
});
router.post('/website/room/:id/photo/remove', (req, res, next) => {
  const type = req.db.get('SELECT * FROM room_types WHERE id = ?', toInt(req.params.id));
  if (!type) return next();
  const name = String(req.body.name || '');
  if (req.body.where === 'cover') {
    if (type.photo !== name) return res.redirect(303, '/admin/website#rooms');
    req.db.run("UPDATE room_types SET photo = '' WHERE id = ?", type.id);
    removeUploadedPhoto(name);
    activity.log(req.db, req, 'website.photos', `${type.name}: cover photo cleared`);
    return res.redirect(303, '/admin/website?ok=photo-cleared#rooms');
  }
  const list = roomGallery(req.settings, type);
  if (!list.includes(name)) return res.redirect(303, '/admin/website#rooms');
  const galleries = { ...(req.settings.room_type_galleries || {}) };
  galleries[type.id] = list.filter((x) => x !== name);
  delete galleries[type.code];
  settingsService.save(req.db, { room_type_galleries: galleries });
  removeUploadedPhoto(name);
  activity.log(req.db, req, 'website.photos', `${type.name}: photo removed from the website gallery`);
  res.redirect(303, '/admin/website?ok=photo-removed#rooms');
});

/* ------------------------------------------------------------------ invoices */
function invoiceRows(db, q) {
  const like = `%${String(q || '').replace(/[%_]/g, '')}%`;
  return db.all(
    `SELECT i.id, i.number, i.status, i.issued_at, i.total_cents, r.confirmation, g.first_name || ' ' || g.last_name AS guest
       FROM invoices i JOIN reservations r ON r.id = i.reservation_id JOIN guests g ON g.id = r.guest_id
      ${q ? "WHERE lower(i.number) LIKE lower(?) OR lower(r.confirmation) LIKE lower(?) OR lower(g.first_name || ' ' || g.last_name) LIKE lower(?)" : ''}
      ORDER BY i.id DESC LIMIT 500`, ...(q ? [like, like, like] : []),
  );
}
router.get('/invoices', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  render(req, res, 'invoices', 'invoices', { heading: 'Invoices', lead: 'Every invoice issued, newest first. Open one to print it again.', rows: invoiceRows(req.db, q), q });
});
const csvCell = (value) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; // never let a spreadsheet run it as a formula
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const sendCsv = (res, name, header, rows) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send('\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
};
router.get('/invoices.csv', (req, res) => {
  sendCsv(res, 'invoices.csv', ['Number', 'Issued', 'Status', 'Booking', 'Guest', 'Total'],
    invoiceRows(req.db, '').map((r) => [r.number, r.issued_at, r.status, r.confirmation, r.guest, (r.total_cents / 100).toFixed(2)]));
});

/* ------------------------------------------------------------------ reports */
function reportData(db, query) {
  const bd = settingsService.businessDate(db);
  const to = f.isDate(query.to) ? query.to : bd;
  let from = f.isDate(query.from) ? query.from : f.addDays(to, -29);
  if (from > to) from = to;
  if (f.daysBetween(from, to) > 366) from = f.addDays(to, -366);
  const days = [];
  const closedDays = stats.days(db, from, to);
  const liveNights = stats.nights(db, from, to);
  for (let d = from; d <= to; d = f.addDays(d, 1)) {
    const closed = closedDays.get(d) || null;
    const n = closed || liveNights.get(d);
    days.push({ date: d, closed: Boolean(closed), sold: n.sold, rooms: n.rooms, revenue: n.revenue, adr: Math.round(n.adr), revpar: Math.round(n.revpar), occupancy: f.pct1(n.sold, n.rooms) });
  }
  const sum = (k) => days.reduce((a, x) => a + x[k], 0);
  const totals = { sold: sum('sold'), rooms: sum('rooms'), revenue: sum('revenue') };
  totals.adr = totals.sold ? Math.round(totals.revenue / totals.sold) : 0;
  totals.revpar = totals.rooms ? Math.round(totals.revenue / totals.rooms) : 0;
  totals.occupancy = f.pct1(totals.sold, totals.rooms);
  const outlets = db.all("SELECT outlet, SUM(amount_cents) AS total FROM revenue WHERE date >= ? AND date <= ? GROUP BY outlet", from, to);
  const sources = db.all(
    `SELECT COALESCE(s.name, 'Unknown') AS source, COUNT(*) AS bookings, SUM(days_between(r.arrival, r.departure)) AS nights, SUM(r.total_cents) AS revenue
       FROM reservations r LEFT JOIN sources s ON s.id = r.source_id
      WHERE r.arrival >= ? AND r.arrival <= ? AND r.status NOT IN ('cancelled', 'no_show') GROUP BY 1 ORDER BY revenue DESC, 1`, from, to,
  );
  const cancellations = db.get("SELECT COUNT(*) AS n FROM reservations WHERE arrival >= ? AND arrival <= ? AND status IN ('cancelled', 'no_show')", from, to).n;
  return { from, to, days, totals, outlets, sources, cancellations, feedback: feedback.summary(db, from, to) };
}
router.get('/reports', (req, res) => {
  render(req, res, 'reports', 'reports', { heading: 'Reports', lead: 'Occupancy, ADR, RevPAR and revenue for any period (closed days use night-audit figures).', r: reportData(req.db, req.query), stars: feedback.stars });
});
router.get('/reports.csv', (req, res) => {
  const r = reportData(req.db, req.query);
  if (req.query.kind === 'sources') {
    return sendCsv(res, `sources-${r.from}-to-${r.to}.csv`, ['Source', 'Bookings', 'Room nights', 'Revenue'],
      r.sources.map((x) => [x.source, x.bookings, x.nights, (x.revenue / 100).toFixed(2)]));
  }
  sendCsv(res, `daily-${r.from}-to-${r.to}.csv`, ['Date', 'Rooms sold', 'Rooms', 'Occupancy %', 'Room revenue', 'ADR', 'RevPAR', 'Closed'],
    r.days.map((d) => [d.date, d.sold, d.rooms, d.occupancy, (d.revenue / 100).toFixed(2), (d.adr / 100).toFixed(2), (d.revpar / 100).toFixed(2), d.closed ? 'yes' : 'no']));
});

/* ------------------------------------------------------------------ GST returns (GSTR-1) */
const gstMonth = (req) => (gstReturn.isMonth(req.query.month) ? req.query.month : gstReturn.defaultMonth(req.db));
router.get('/gst-return', (req, res, next) => {
  if (req.settings.tax_mode !== 'gst_india') return next();
  const r = gstReturn.build(req.db, gstMonth(req));
  const csvRows = Object.fromEntries(gstReturn.PARTS.map((part) => [part, gstReturn.csv(r, part)[2].length]));
  render(req, res, 'gst-return', 'gst-return', {
    heading: 'GST returns', lead: 'GSTR-1 for a month, from the invoices you issued: B2B, B2C, SAC summary and documents issued, ready for the GST offline tool or your accountant.',
    r, csvRows, parts: gstReturn.PARTS,
  });
});
router.get('/gst-return.csv', (req, res, next) => {
  if (req.settings.tax_mode !== 'gst_india') return next();
  const r = gstReturn.build(req.db, gstMonth(req));
  const file = gstReturn.csv(r, String(req.query.part || ''));
  if (!file) return next();
  const [name, header, rows] = file;
  sendCsv(res, `gstr1-${r.month}-${name}.csv`, header, rows);
});

/* ------------------------------------------------------------------ emails (outbox) */
router.get('/emails', requireAbility('administer'), (req, res) => {
  render(req, res, 'emails', 'emails', {
    heading: 'Emails', lead: 'Every email the system has written: booking confirmations, cancellations and password resets.',
    rows: req.db.all('SELECT * FROM outbox ORDER BY id DESC LIMIT 200'), configured: mail.configured(),
  });
});

/* ------------------------------------------------------------------ activity log */
router.get('/activity', (req, res) => {
  const db = req.db;
  const who = toInt(req.query.user);
  const rows = db.all(`SELECT * FROM activity_log ${who ? 'WHERE user_id = ?' : ''} ORDER BY id DESC LIMIT 300`, ...(who ? [who] : []));
  render(req, res, 'activity', 'activity', {
    heading: 'Activity log', lead: 'Every change, who made it and when (latest 300).', rows, who,
    users: db.all('SELECT id, name FROM users ORDER BY name'),
  });
});

/* ------------------------------------------------------------------ night audit */
router.get('/night-audit', (req, res) => {
  render(req, res, 'night-audit', 'night-audit', { heading: 'Night audit', lead: 'Close the business day: check what is still open, record outlet revenue and move the date on.', a: audit.summary(req.db), form3: registration.pendingForm3(req.db) });
});

router.post('/night-audit/revenue', (req, res) => {
  const db = req.db;
  const form = new Form(req.body);
  const fnb = form.money('fnb', { label: 'Food & beverage', min: 0, max: 10000000, required: false }) ?? 0;
  const spa = form.money('spa', { label: 'Spa & other', min: 0, max: 10000000, required: false }) ?? 0;
  if (!form.ok) return render(req, res, 'night-audit', 'night-audit', { heading: 'Night audit', lead: '', a: audit.summary(db), form3: registration.pendingForm3(db), errors: form.errors, values: form.values }, 422);
  const bd = settingsService.businessDate(db);
  for (const [outlet, amount] of [['fnb', fnb], ['spa', spa]]) {
    db.run('INSERT INTO revenue (date, outlet, amount_cents) VALUES (?, ?, ?) ON CONFLICT(date, outlet) DO UPDATE SET amount_cents = excluded.amount_cents', bd, outlet, amount);
  }
  activity.log(db, req, 'revenue.save', `Outlet revenue for ${bd}: F&B ${f.money(fnb)}, spa & other ${f.money(spa)}`);
  back(res, '/admin/night-audit', 'revenue');
});

router.post('/night-audit', (req, res) => {
  const db = req.db;
  try {
    audit.close(db, req, { noShows: req.body.no_shows === 'on' });
  } catch (error) {
    if (error.status !== 422) throw error;
    return render(req, res, 'night-audit', 'night-audit', { heading: 'Night audit', lead: 'Close the business day: check what is still open, record outlet revenue and move the date on.', a: audit.summary(db), form3: registration.pendingForm3(db), closeError: error.message }, 422);
  }
  back(res, '/admin/night-audit', settingsService.all(db).business_date_mode === 'fixed' ? 'closed' : 'closed-auto');
});

module.exports = router;
module.exports.stats = stats;
