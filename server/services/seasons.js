'use strict';
/* Seasons and weekends: a different room rate on some nights. A rule has a date range (a festival such as Durga
   Puja), days of the week (a weekend) or both, for every room type or one, and changes the room type's rate by a
   percentage or an amount per night. One rule counts for a night: one with dates before a weekday-only one, and
   among those the one that starts last (then the newest). The rate plan then applies as usual. */
const f = require('../lib/format');
const pricing = require('../lib/pricing');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/* Active rules, in the order they win. */
const active = (db) => db.all('SELECT * FROM rate_seasons WHERE active = 1 ORDER BY (start_date IS NULL), start_date DESC, id DESC');

/* The rule for one night of a room type, or null. */
function ruleFor(rules, typeId, date) {
  const day = String(weekday(date));
  return rules.find((r) => (!r.room_type_id || r.room_type_id === typeId)
    && (!r.start_date || (date >= r.start_date && date <= r.end_date))
    && (!r.weekdays || r.weekdays.includes(day))) || null;
}

const adjust = (base, rule) => {
  if (!rule) return base;
  return Math.max(0, rule.adjust_type === 'percent' ? Math.round(base * (1 + rule.adjust_value / 100)) : base + rule.adjust_value);
};

/* Each night's rate for a stay: the room type's rate after its season, then the rate plan. */
function nightRates(rules, type, plan, arrival, nights) {
  return Array.from({ length: nights }, (_, i) => Math.max(0, pricing.planRate(adjust(type.base_rate_cents, ruleFor(rules, type.id, f.addDays(arrival, i))), plan)));
}

/* Nights grouped by rate, in stay order: [{ rate, nights }] (a booking's night_rates, or its one rate). */
function groups(b) {
  const rates = b.night_rates ? JSON.parse(b.night_rates) : Array.from({ length: b.nights ?? f.daysBetween(b.arrival, b.departure) }, () => b.nightly_rate_cents);
  const out = [];
  for (const rate of rates) {
    const last = out.find((g) => g.rate === rate);
    if (last) last.nights += 1;
    else out.push({ rate, nights: 1 });
  }
  return out;
}

/* night_rates to store: null when every night costs the same. */
const stored = (rates) => (rates.length && rates.some((r) => r !== rates[0]) ? JSON.stringify(rates) : null);

/* "Fri, Sat · every room · +10%" for the admin list. */
function describe(rule, typeName) {
  const when = [
    rule.start_date ? `${f.formatDay(rule.start_date)} → ${f.formatDay(rule.end_date)}` : '',
    rule.weekdays ? rule.weekdays.split('').map((d) => DAYS[Number(d)]).join(', ') : '',
  ].filter(Boolean).join(' · ');
  const change = rule.adjust_type === 'percent' ? `${rule.adjust_value > 0 ? '+' : ''}${rule.adjust_value}%` : `${rule.adjust_value >= 0 ? '+' : '−'}${f.money(Math.abs(rule.adjust_value))} a night`;
  return { when: when || 'Every night', who: typeName || 'Every room type', change };
}

/* The rules for the booking form's own quote (amounts in rupees, like its rates). */
const forBrowser = (rules, types) => rules.map((r) => ({
  from: r.start_date || '', to: r.end_date || '', days: r.weekdays || '', type: r.room_type_id ? (types.find((t) => t.id === r.room_type_id) || {}).code || '-' : '',
  kind: r.adjust_type, value: r.adjust_type === 'percent' ? r.adjust_value : r.adjust_value / 100,
}));

module.exports = { DAYS, active, ruleFor, nightRates, groups, stored, describe, forBrowser };
