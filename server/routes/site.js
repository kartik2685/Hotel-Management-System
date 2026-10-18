'use strict';
/* Public guest website at /hotel: rooms, availability, booking, and "manage my booking". */
const express = require('express');
const auth = require('../lib/auth');
const f = require('../lib/format');
const limits = require('../lib/limits');
const website = require('../services/website');
const registration = require('../services/registration');
const reservations = require('../services/reservations');

const router = express.Router();
const SITE_COOKIE = 'hms_site';

/* The website can be switched off in Admin → Website (staff can still preview it). */
router.use((req, res, next) => {
  if (req.settings.site_enabled || req.user) return next();
  res.status(404).render('site/off', { s: req.settings });
});

/* A per-visitor token for the public forms (double-submit cookie). */
router.use((req, res, next) => {
  let token = req.cookies[SITE_COOKIE];
  if (!token || token.length < 30) {
    token = auth.randomToken();
    res.cookie(SITE_COOKIE, token, auth.cookieOptions(24 * 60 * 60 * 1000));
  }
  res.locals.siteToken = token;
  res.locals.s = req.settings;
  res.locals.preview = !req.settings.site_enabled;
  res.set('Cache-Control', 'no-store');
  next();
});
const formOk = (req) => auth.safeEqual(req.body && req.body._csrf, req.cookies[SITE_COOKIE]);
const refused = (res) => res.status(403).render('site/message', { title: 'Please try again', text: 'That form expired. Go back, reload the page and send it again.' });

const page = (res, view, data) => res.render(`site/${view}`, { fmt: f, ...data });

router.get('/', (req, res) => {
  const h = website.home(req.db);
  const stay = website.readStay({}, require('../services/settings').businessDate(req.db));
  page(res, 'home', { title: req.settings.hotel_name, h, stay });
});

router.get('/book', (req, res) => {
  page(res, 'book', { title: 'Choose your room', r: website.search(req.db, req.query) });
});

router.get('/book/details', (req, res) => {
  const o = website.offer(req.db, req.query);
  if (!o) return res.redirect(303, `/hotel/book?${new URLSearchParams({ arrival: req.query.arrival || '', departure: req.query.departure || '', adults: req.query.adults || '2', children: req.query.children || '0' })}`);
  page(res, 'details', { title: 'Your details', o, errors: {}, values: {}, countries: registration.COUNTRIES });
});

router.post('/book', (req, res, next) => {
  if (!formOk(req)) return refused(res);
  if (req.body.website) return res.redirect(303, '/hotel'); // hidden field: only bots fill it in
  if (!limits.hit(`book:${req.ip}`, 10, 60 * 60 * 1000)) {
    return res.status(429).render('site/message', { title: 'Too many bookings', text: 'Please call or email the hotel to make more bookings today.' });
  }
  try {
    const b = website.create(req.db, req, req.body);
    res.redirect(303, `/hotel/booking/${encodeURIComponent(b.confirmation)}?t=${website.token(req.db, b.confirmation, b.email)}&new=1`);
  } catch (error) {
    if (error instanceof reservations.FormError || error.status === 422) {
      const o = website.offer(req.db, req.body);
      if (!o) return res.redirect(303, '/hotel/book');
      return res.status(422).render('site/details', {
        fmt: f, title: 'Your details', o, countries: registration.COUNTRIES,
        errors: error.errors || { stay: error.message }, values: error.values || req.body,
      });
    }
    next(error);
  }
});

function booking(req, res) {
  const b = reservations.byConfirmation(req.db, String(req.params.confirmation || '').toUpperCase());
  if (!b || !website.tokenOk(req.db, b, req.query.t || req.body?.t)) {
    res.status(404).render('site/message', { title: 'Booking not found', text: 'Check the link in your confirmation email, or find your booking with its number and your email.', link: { href: '/hotel/manage', label: 'Find my booking' } });
    return null;
  }
  return b;
}

router.get('/booking/:confirmation', (req, res) => {
  const b = booking(req, res);
  if (!b) return;
  page(res, 'booking', { title: `Booking ${b.confirmation}`, v: website.bookingView(req.db, b), t: req.query.t, fresh: req.query.new === '1', cancelled: req.query.cancelled === '1', error: '' });
});

router.post('/booking/:confirmation/cancel', (req, res, next) => {
  if (!formOk(req)) return refused(res);
  const b = booking(req, res);
  if (!b) return;
  try {
    website.cancel(req.db, req, b);
    res.redirect(303, `/hotel/booking/${encodeURIComponent(b.confirmation)}?t=${encodeURIComponent(req.body.t)}&cancelled=1`);
  } catch (error) {
    if (error.status !== 422) return next(error);
    page(res.status(422), 'booking', { title: `Booking ${b.confirmation}`, v: website.bookingView(req.db, b), t: req.body.t, fresh: false, cancelled: false, error: error.message });
  }
});

router.get('/manage', (req, res) => page(res, 'manage', { title: 'Find your booking', error: '', values: {} }));
router.post('/manage', (req, res) => {
  if (!formOk(req)) return refused(res);
  const values = { confirmation: String(req.body.confirmation || '').trim().slice(0, 20), email: String(req.body.email || '').trim().slice(0, 120) };
  if (!limits.hit(`manage:${req.ip}`, 20, 15 * 60 * 1000)) {
    return page(res.status(429), 'manage', { title: 'Find your booking', error: 'Too many tries. Wait a few minutes and try again.', values });
  }
  const b = website.lookup(req.db, values.confirmation, values.email);
  if (!b) return page(res.status(404), 'manage', { title: 'Find your booking', error: 'We couldn’t find a booking with that number and email.', values });
  res.redirect(303, `/hotel/booking/${encodeURIComponent(b.confirmation)}?t=${website.token(req.db, b.confirmation, b.email)}`);
});

module.exports = router;
