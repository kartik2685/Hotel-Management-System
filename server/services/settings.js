'use strict';
/* Hotel settings (key/value JSON) with an in-memory cache. */
const clock = require('../lib/clock');

const DEFAULTS = {
  hotel_name: 'My Hotel', hotel_city: '', hotel_address: '', hotel_phone: '', hotel_email: '', tax_id: '',
  currency_code: 'USD', currency_symbol: '$', currency_locale: 'en-US', tax_mode: 'flat', tax_rate: 0, tax_label: 'Tax',
  check_in_time: '15:00', check_out_time: '12:00', timezone: 'UTC', business_date_mode: 'auto', business_date: null,
  shifts: { morning: ['07:00', '15:00'], evening: ['15:00', '23:00'], night: ['23:00', '07:00'] }, demo_mode: false,
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

const reset = () => { cache = null; };

module.exports = { all, save, businessDate, reset, DEFAULTS };
