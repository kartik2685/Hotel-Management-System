'use strict';
/* The public guest website: room list, availability search, online booking and self-service cancellation. */
const crypto = require('node:crypto');
const f = require('../lib/format');
const clock = require('../lib/clock');
const pricing = require('../lib/pricing');
const activity = require('../lib/activity');
const mail = require('../lib/mail');
const { Form } = require('../lib/forms');
const settingsService = require('./settings');
const taxKinds = require('./tax-kinds');
const seasons = require('./seasons');
const reservations = require('./reservations');
const registration = require('./registration');
const emails = require('./emails');

const MAX_AHEAD_DAYS = 365;
const MAX_NIGHTS = 30;

const onlineTypes = (db) => db.all('SELECT * FROM room_types WHERE active = 1 AND online = 1 ORDER BY sort, name');
const onlinePlans = (db) => db.all('SELECT * FROM rate_plans WHERE active = 1 AND online = 1 ORDER BY sort, name');
const imageUrl = (name, fallback = 'lobby.jpg') => {
  const value = String(name || fallback);
  const base = value === 'lobby.jpg' ? '/assets/img/' : value.startsWith('rooms/') ? '/assets/img/' : '/assets/img/rooms/';
  return `${base}${value.split('/').map(encodeURIComponent).join('/')}`;
};
const photoUrl = (type) => type.photo ? imageUrl(type.photo, 'lobby.jpg') : '/assets/img/lobby.jpg';
function typeGallery(db, type) {
  const saved = settingsService.all(db).room_type_galleries || {};
  const photos = [...new Set([...(type.photo ? [type.photo] : []), ...(saved[type.id] || saved[type.code] || [])])];
  const galleryUrls = photos.length ? photos.map((photo) => imageUrl(photo)) : ['/assets/img/lobby.jpg'];
  return { ...type, galleryUrls, photoUrl: galleryUrls[0] };
}

/* Lowest nightly price over the online rate plans (before tax). */
function fromPrice(type, plans) {
  const prices = (plans.length ? plans : [null]).map((p) => pricing.planRate(type.base_rate_cents, p));
  return Math.min(...prices);
}

function home(db) {
  const plans = onlinePlans(db);
  const extras = db.all('SELECT * FROM extras WHERE active = 1 ORDER BY sort, name');
  const settings = settingsService.all(db);
  const types = onlineTypes(db).map((t) => ({ ...typeGallery(db, t), from: fromPrice(t, plans) }));
  const heroPhotos = settings.site_hero_images || (settings.site_hero_image ? [settings.site_hero_image] : ['lobby.jpg']);
  const aboutPhotos = settings.site_about_images || (settings.site_about_image ? [settings.site_about_image] : ['rooms/linden.jpg']);
  return { types, plans, extras, heroImages: heroPhotos.map((x) => imageUrl(x)), aboutImages: aboutPhotos.map((x) => imageUrl(x)) };
}

/* Fewest rooms of a type still free on any night of the stay. */
function roomsLeft(db, typeId, arrival, departure) {
  let least = Infinity;
  for (let d = arrival; d < departure; d = f.addDays(d, 1)) {
    const rooms = db.get(
      `SELECT COUNT(*) AS n FROM rooms rm WHERE rm.active = 1 AND rm.room_type_id = ?
         AND NOT EXISTS (SELECT 1 FROM room_blocks b WHERE b.room_id = rm.id AND b.start_date <= ? AND b.end_date > ?)`, typeId, d, d,
    ).n;
    const taken = db.get(
      `SELECT COUNT(*) AS n FROM reservations WHERE room_type_id = ? AND status IN ${reservations.HOLDS_ROOM} AND arrival <= ? AND departure > ?`, typeId, d, d,
    ).n;
    least = Math.min(least, rooms - taken);
  }
  return Math.max(0, least === Infinity ? 0 : least);
}

/* Reads and checks the dates and party size from a query string. */
function readStay(query, bd) {
  const form = new Form(query);
  let arrival = form.date('arrival', { label: 'Arrival', required: false }) || bd;
  let departure = form.date('departure', { label: 'Departure', required: false });
  const adults = form.int('adults', { label: 'Adults', min: 1, max: 8, required: false }) ?? 2;
  const children = form.int('children', { label: 'Children', min: 0, max: 6, required: false }) ?? 0;
  if (arrival < bd) {
    form.fail('arrival', 'Arrival can’t be in the past.');
    arrival = bd;
  }
  if (arrival > f.addDays(bd, MAX_AHEAD_DAYS)) form.fail('arrival', 'We take bookings up to a year ahead.');
  if (!departure || departure <= arrival) departure = f.addDays(arrival, 1); // at least one night
  if (f.daysBetween(arrival, departure) > MAX_NIGHTS) form.fail('departure', `For stays over ${MAX_NIGHTS} nights, please call us.`);
  return { arrival, departure, nights: f.daysBetween(arrival, departure), adults, children, errors: form.errors };
}

function cancellable(plan, arrival, bd) {
  return Boolean(plan) && plan.free_cancel_days !== null && plan.free_cancel_days !== undefined && f.daysBetween(bd, arrival) >= plan.free_cancel_days;
}
function policyText(plan, arrival) {
  if (!plan || plan.free_cancel_days === null || plan.free_cancel_days === undefined) return 'Non-refundable: this rate can’t be cancelled.';
  if (plan.free_cancel_days === 0) return `Free cancellation until the day of arrival.`;
  return `Free cancellation until ${f.formatDay(f.addDays(arrival, -plan.free_cancel_days))}.`;
}

function search(db, query) {
  const settings = settingsService.all(db);
  const bd = settingsService.businessDate(db);
  const stay = readStay(query, bd);
  const plans = onlinePlans(db);
  const rules = seasons.active(db);
  const rates = (type, plan) => (stay.nights > 0 && !Object.keys(stay.errors).length ? seasons.nightRates(rules, type, plan, stay.arrival, stay.nights) : null);
  const results = onlineTypes(db).map((type) => {
    const fits = stay.adults + stay.children <= type.max_guests;
    const left = Object.keys(stay.errors).length ? 0 : roomsLeft(db, type.id, stay.arrival, stay.departure);
    return {
      type: typeGallery(db, type), fits, left,
      plans: plans.map((plan) => {
        const q = pricing.quote({ settings, baseCents: type.base_rate_cents, plan, nights: stay.nights, nightRates: rates(type, plan) });
        return { plan, quote: q, policy: policyText(plan, stay.arrival), cancellable: cancellable(plan, stay.arrival, bd) };
      }),
    };
  });
  return { stay, results, bd };
}

/* Everything the guest-details step needs, or null when the choice is no longer possible. */
function offer(db, query) {
  const settings = settingsService.all(db);
  const { stay, bd } = search(db, query);
  const type = db.get('SELECT * FROM room_types WHERE code = ? AND active = 1 AND online = 1', String(query.type || ''));
  const plan = db.get('SELECT * FROM rate_plans WHERE code = ? AND active = 1 AND online = 1', String(query.plan || ''));
  if (!type || !plan || Object.keys(stay.errors).length) return null;
  const quote = pricing.quote({ settings, baseCents: type.base_rate_cents, plan, nights: stay.nights, nightRates: seasons.nightRates(seasons.active(db), type, plan, stay.arrival, stay.nights) });
  const groups = seasons.groups({ night_rates: JSON.stringify(quote.nightRates), nights: stay.nights, nightly_rate_cents: quote.rate });
  const bands = [...new Set(groups.map((g) => pricing.taxPercent(settings, g.rate)))];
  return {
    groups, taxBand: bands.length === 1 ? bands[0] : null, // one GST band for the stay, or several
    stay, type: typeGallery(db, type), plan, quote, policy: policyText(plan, stay.arrival),
    fits: stay.adults + stay.children <= type.max_guests, left: roomsLeft(db, type.id, stay.arrival, stay.departure),
    extras: db.all('SELECT * FROM extras WHERE active = 1 ORDER BY sort, name').map((x) => ({
      ...x, taxPercent: taxKinds.extraTax(settings, x.gst_kind, quote.rate, taxKinds.premium(db)).rate,
    })), bd,
    taxPercent: pricing.taxPercent(settings, quote.rate),
  };
}

const secret = (db) => settingsService.siteSecret(db);
/* Signed link token: only someone with the confirmation email can open the booking. */
const token = (db, confirmation, email) => crypto.createHmac('sha256', secret(db)).update(`${confirmation}:${String(email || '').toLowerCase()}`).digest('base64url').slice(0, 32);
const tokenOk = (db, booking, given) => {
  const expected = Buffer.from(token(db, booking.confirmation, booking.email));
  const actual = Buffer.from(String(given || ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

function create(db, req, body) {
  const settings = settingsService.all(db);
  const o = offer(db, body);
  const form = new Form(body);
  const v = {
    first: form.text('first', { label: 'First name', max: 60, required: true }),
    last: form.text('last', { label: 'Last name', max: 60, required: true }),
    email: form.email('email'),
    phone: form.text('phone', { label: 'Phone', max: 40, required: true, pattern: /^[+()\d\s.-]{6,}$/, message: 'Enter a phone number we can reach you on.' }),
    nationality: form.oneOf('nationality', registration.COUNTRIES.map((c) => c.code), { label: 'Nationality', required: false }),
    requests: form.longText('requests', { label: 'Requests', max: 500 }),
    terms: form.bool('terms'),
  };
  const codes = [].concat(body.extra || []).map(String);
  const extras = codes.length ? db.all(`SELECT * FROM extras WHERE active = 1 AND code IN (${codes.map(() => '?').join(',')})`, ...codes) : [];
  if (!o) form.fail('stay', 'That room or rate is no longer available. Please search again.');
  else if (!o.fits) form.fail('stay', `A ${o.type.name} sleeps up to ${o.type.max_guests} guests.`);
  else if (o.left < 1) form.fail('stay', `The last ${o.type.name} for those dates has just gone. Please choose another room.`);
  if (!v.terms) form.fail('terms', 'Please accept the hotel policies to book.');
  if (!form.ok) throw new reservations.FormError(form.errors, form.values);
  const source = db.get("SELECT * FROM sources WHERE name = 'Website' AND active = 1") || db.get("SELECT * FROM sources WHERE kind = 'direct' AND active = 1 ORDER BY sort, id LIMIT 1");
  const booking = reservations.insertBooking(db, req, {
    arrival: o.stay.arrival, departure: o.stay.departure, nights: o.stay.nights, type: o.type, plan: o.plan, adults: o.stay.adults, children: o.stay.children,
    first: v.first, last: v.last, email: v.email, phone: v.phone, nationality: v.nationality, requests: v.requests, source, extras,
  }, { createdBy: null, actor: 'Website', online: true });
  const link = `${siteUrl(req, settings)}/hotel/booking/${booking.confirmation}?t=${token(db, booking.confirmation, booking.email)}`;
  mail.send(db, settings, emails.bookingConfirmed(settings, booking, link));
  return booking;
}

function siteUrl(req, settings) {
  if (settings.site_url) return settings.site_url.replace(/\/+$/, '');
  const config = require('../config');
  return `${config.embed || config.cookieSecure ? 'https' : req.protocol}://${req.get('host')}`;
}

function lookup(db, confirmation, email) {
  const b = reservations.byConfirmation(db, String(confirmation || '').trim().toUpperCase());
  if (!b || !b.email || b.email.toLowerCase() !== String(email || '').trim().toLowerCase()) return null;
  return b;
}

function bookingView(db, b) {
  const bd = settingsService.businessDate(db);
  const plan = b.rate_plan_id ? db.get('SELECT * FROM rate_plans WHERE id = ?', b.rate_plan_id) : null;
  const type = db.get('SELECT * FROM room_types WHERE id = ?', b.room_type_id);
  return {
    b, plan, type: typeGallery(db, type), policy: policyText(plan, b.arrival),
    canCancel: ['confirmed', 'tentative'].includes(b.status) && cancellable(plan, b.arrival, bd),
    extras: db.all('SELECT x.name, re.amount_cents FROM reservation_extras re JOIN extras x ON x.id = re.extra_id WHERE re.reservation_id = ?', b.id),
  };
}

function cancel(db, req, b) {
  const settings = settingsService.all(db);
  const view = bookingView(db, b);
  if (!view.canCancel) throw new reservations.BookingError('This booking can no longer be cancelled online. Please call or email the hotel.');
  db.tx(() => {
    const stamp = clock.stamp(settings.timezone);
    db.run("UPDATE reservations SET status = 'cancelled', cancelled_at = ?, room_id = NULL, updated_at = ? WHERE id = ?", stamp, stamp, b.id);
    db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)', 'calendar-check', 'warn',
      `Cancelled online ${b.confirmation}`, `${b.name} · ${f.formatDay(b.arrival)} → ${f.formatDay(b.departure)}`, stamp);
    activity.log(db, req, 'reservation.cancel', `Guest cancelled ${b.confirmation} online`, 'Website');
  });
  mail.send(db, settings, emails.bookingCancelled(settings, b));
}

module.exports = { home, search, offer, create, lookup, bookingView, cancel, token, tokenOk, photoUrl, roomsLeft, policyText, readStay, siteUrl };
