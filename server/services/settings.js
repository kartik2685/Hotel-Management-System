'use strict';
/* Hotel settings (key/value JSON) with an in-memory cache. */
const crypto = require('node:crypto');
const clock = require('../lib/clock');

/* Defaults for a new, empty hotel (set up for India). The demo hotel overrides them in db/seed.js. */
const DEFAULTS = {
  hotel_name: 'My Hotel', hotel_city: '', hotel_address: '', hotel_phone: '', hotel_email: '', tax_id: '', hotel_state: '',
  country: 'IN', currency_code: 'INR', currency_symbol: '₹', currency_locale: 'en-IN', tax_mode: 'gst_india', tax_rate: 0, tax_label: 'GST',
  check_in_time: '14:00', check_out_time: '11:00', timezone: 'Asia/Kolkata', business_date_mode: 'auto', business_date: null,
  shifts: { morning: ['07:00', '15:00'], evening: ['15:00', '23:00'], night: ['23:00', '07:00'] }, demo_mode: false,
  require_grc: true, default_room_type: '', confirmation_prefix: 'HTL', invoice_prefix: 'INV',
  site_enabled: false, site_tagline: '', site_intro: '', site_amenities: [], site_policies: '', site_url: '', review_url: '',
};

let cache = null;

function all(db) {
  if (!cache) {
    cache = { ...DEFAULTS };
    for (const row of db.all('SELECT key, value FROM settings')) cache[row.key] = JSON.parse(row.value);
  }
  return cache;
}

function save(db, changes) {
  db.tx(() => {
    for (const [key, value] of Object.entries(changes)) {
      db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
    }
  });
  cache = null;
}

/* The hotel's business date: fixed (until the night audit moves it on) or today's date. */
function businessDate(db) {
  const s = all(db);
  if (s.business_date_mode === 'fixed' && s.business_date) return s.business_date;
  return clock.hotelNow(s.timezone).date;
}

/* Server-side key for signed links and form tokens (created once per hotel). */
function siteSecret(db) {
  let value = all(db).site_secret;
  if (!value) {
    value = crypto.randomBytes(32).toString('base64url');
    save(db, { site_secret: value });
  }
  return value;
}

const reset = () => { cache = null; };

module.exports = { all, save, businessDate, siteSecret, reset, DEFAULTS };
