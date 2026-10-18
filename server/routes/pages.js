'use strict';
/* Front-office and operations pages (server-rendered with the original markup). */
const path = require('node:path');
const express = require('express');
const config = require('../config');
const { requireUser, requireAbility, can } = require('../lib/security');
const shellService = require('../services/shell');
const dashboard = require('../services/dashboard');
const reservations = require('../services/reservations');
const tapechart = require('../services/tapechart');
const rooms = require('../services/rooms');
const housekeeping = require('../services/housekeeping');
const guests = require('../services/guests');
const f = require('../lib/format');

const router = express.Router();
const homeFor = (user) => (can(user, 'frontOffice') ? '/dashboard' : '/housekeeping');

router.get('/', (req, res) => {
  if (config.previewBar) {
    // Development preview bar only: it uses an inline script and frames the app from the same origin.
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src 'self'");
    return res.sendFile(path.join(__dirname, '..', 'views', 'dev', 'preview.html'));
  }
  if (req.user) return res.redirect(homeFor(req.user));
  res.redirect(req.settings.site_enabled ? '/hotel' : '/login');
});

router.get('/dashboard', requireAbility('frontOffice'), (req, res) => {
  const shell = shellService.build(req.db, req, 'dashboard');
  res.render('pages/dashboard', {
    title: 'Frontdesk — Free Hotel Management System Template',
    description: `Front office dashboard for ${req.settings.hotel_name}: occupancy, arrivals, departures, ADR, RevPAR, weekly revenue and live room status.`,
    page: 'index', css: 'pages/dashboard', scripts: 'pages/dashboard', shell, d: dashboard.build(req.db, shell, req.user),
  });
});

router.get('/reservations', requireAbility('frontOffice'), (req, res) => {
  const shell = shellService.build(req.db, req, 'reservations');
  res.render('pages/reservations', {
    title: 'Reservations · Frontdesk Hotel Management',
    description: 'Search and filter bookings by status, source and arrival date, and create a new booking with live price calculation.',
    page: 'reservations', css: 'pages/reservations', scripts: 'pages/reservations', shell, r: reservations.page(req.db, shell, can(req.user, 'bookings')),
  });
});

router.get('/tape-chart', requireAbility('frontOffice'), (req, res) => {
  const shell = shellService.build(req.db, req, 'tape-chart');
  const data = tapechart.data(req.db, req.settings, shell.bd);
  res.render('pages/tape-chart', {
    title: 'Tape chart · Frontdesk Hotel Management',
    description: `Tape chart of all ${data.rooms.length} rooms across the next 14 nights, with bookings drawn as bars and a detail dialog for each stay.`,
    page: 'calendar', css: 'pages/tape-chart', scripts: 'pages/tape-chart', shell,
    t: { data, range: `${f.formatDay(shell.bd)} – ${f.formatDay(f.addDays(shell.bd, 13))}`, floors: [...new Set(shell.states.map((r) => r.floor))].sort((a, b) => a - b) },
    afterShell: 'booking-dialog', dataIsland: { id: 'tape-chart-data', json: tapechart.scriptJson(data) },
  });
});

router.get('/rooms', requireAbility('rooms'), (req, res) => {
  const shell = shellService.build(req.db, req, 'rooms');
  res.render('pages/rooms', {
    title: 'Room status · Frontdesk Hotel Management',
    description: `Room status board for all ${shell.roomCounts.total} rooms by floor, with a housekeeping clean or dirty toggle and housekeeper assignment.`,
    page: 'rooms', css: 'pages/rooms', scripts: 'pages/rooms', shell,
    rm: rooms.page(req.db, shell, { canEdit: true, canAssign: can(req.user, 'bookings') || can(req.user, 'manage') }),
  });
});

router.get('/housekeeping', requireAbility('housekeeping'), (req, res) => {
  const shell = shellService.build(req.db, req, 'housekeeping');
  res.render('pages/housekeeping', {
    title: 'Housekeeping · Frontdesk Hotel Management',
    description: 'Housekeeping tasks by floor with live progress, attendant workloads and rush cleans for rooms with arrivals today.',
    page: 'housekeeping', css: 'pages/housekeeping', scripts: 'pages/housekeeping', shell, hk: housekeeping.page(req.db, shell),
  });
});

router.get('/guests', requireAbility('frontOffice'), (req, res) => {
  const shell = shellService.build(req.db, req, 'guests');
  const query = String(req.query.q || '').trim().slice(0, 60);
  const selected = Number.parseInt(req.query.guest, 10) || null;
  res.render('pages/guests', {
    title: 'Guest profiles · Frontdesk Hotel Management',
    description: 'Guest profiles with contact details, preferences, front desk notes and stay history for in-house and returning guests.',
    page: 'guests', css: 'pages/guests', scripts: 'pages/guests', shell, g: guests.page(req.db, shell.bd, { query, selected }),
  });
});

/* One profile, loaded by the guests page when a guest is picked from the list. */
router.get('/guests/:id/profile', requireAbility('frontOffice'), (req, res, next) => {
  const p = guests.profile(req.db, Number.parseInt(req.params.id, 10) || 0, require('../services/settings').businessDate(req.db));
  if (!p) return next();
  res.render('partials/guest-profile', { p });
});

/* New booking. The page script posts JSON; without JavaScript the form posts normally. */
router.post('/reservations', requireAbility('bookings'), (req, res, next) => {
  const wantsJson = (req.get('accept') || '').includes('application/json');
  try {
    const booking = reservations.create(req.db, req, req.body);
    if (!wantsJson) return res.redirect(303, `/reservations/${booking.confirmation}`);
    res.status(201).json({ booking: reservations.toJson(booking) });
  } catch (error) {
    if (wantsJson && error.status === 422) return res.status(422).json({ error: error.message, field: error.field });
    next(error);
  }
});



module.exports = router;
module.exports.homeFor = homeFor;
module.exports.requireUser = requireUser;
