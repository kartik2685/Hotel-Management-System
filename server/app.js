'use strict';
/* Express application: security middleware, sessions, page routes, JSON API and admin panel. */
const path = require('node:path');
const express = require('express');
const config = require('./config');
const f = require('./lib/format');
const security = require('./lib/security');
const auth = require('./lib/auth');
const settingsService = require('./services/settings');

const ICON = (name) => `<svg class="icon" aria-hidden="true"><use href="#icon-${String(name).replace(/[^a-z0-9-]/gi, '')}"></use></svg>`;

/* The web app manifest: staff can install Frontdesk on a phone or computer (home screen icon, own window).
   It opens on the sign-in page, which sends a signed-in person straight to their start page. */
const appManifest = (settings) => ({
  name: `Frontdesk · ${settings.hotel_name}`,
  short_name: 'Frontdesk',
  description: `${settings.hotel_name}: bookings, rooms and housekeeping.`,
  start_url: '/login',
  scope: '/',
  display: 'standalone',
  background_color: '#1c1b19',
  theme_color: '#1c1b19',
  icons: [
    { src: '/assets/img/app-icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/assets/img/app-icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/assets/img/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

const LEGACY = {
  '/index.html': '/dashboard', '/reservations.html': '/reservations', '/calendar.html': '/tape-chart', '/rooms.html': '/rooms',
  '/guests.html': '/guests', '/housekeeping.html': '/housekeeping', '/login.html': '/login',
};

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', config.trustProxy);
  app.locals.icon = ICON;
  app.locals.fmt = f;

  app.use(security.headers);
  app.use('/assets', express.static(path.join(config.root, 'assets'), {
    index: false,
    maxAge: config.production ? '7d' : 0,
    // Styles and scripts change with updates: browsers check them on every visit (a quick 304 when unchanged),
    // so a deploy shows at once instead of after a week. Images and fonts keep the week-long cache.
    setHeaders: (res, file) => {
      if (/\.(css|js)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/assets/img/favicon.svg'));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(security.cookies);

  // Settings, currency and the signed-in user for every request.
  app.use((req, res, next) => {
    req.db = db;
    req.settings = settingsService.all(db);
    f.setCurrency(req.settings.currency_symbol, req.settings.currency_locale);
    const session = auth.readSession(db, req.cookies[auth.COOKIE]);
    if (session) {
      req.session = session;
      req.user = { id: session.user_id, name: session.name, email: session.email, role: session.role, title: session.title, department: session.department,
        code: session.code, avatar_tone: session.avatar_tone, user_shift: session.user_shift, must_change_password: session.must_change_password };
      res.locals.csrf = session.csrf_token;
    }
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(security.csrf);

  // Installable app: its manifest, the service worker (at the top level, so it covers every page) and the page
  // it shows offline. Before the password-change redirect: a browser fetching these must never be redirected.
  app.get('/manifest.webmanifest', (req, res) => {
    res.set('Cache-Control', 'no-cache').type('application/manifest+json').send(JSON.stringify(appManifest(req.settings)));
  });
  app.get('/sw.js', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(config.root, 'assets', 'js', 'sw.js')));
  app.get('/offline.html', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(config.root, 'assets', 'offline.html')));

  app.use((req, res, next) => {
    const target = LEGACY[req.path];
    if (target) return res.redirect(301, target);
    next();
  });

  // A new account must replace its first password before doing anything else.
  app.use((req, res, next) => {
    if (req.user && req.user.must_change_password && !['/account', '/logout'].includes(req.path) && !req.path.startsWith('/assets/')) {
      return req.path.startsWith('/api/') ? res.status(403).json({ error: 'Change your password first.' }) : res.redirect('/account');
    }
    next();
  });

  app.use(require('./routes/auth'));
  app.use('/api', require('./routes/api'));
  app.use('/admin', require('./routes/admin'));
  app.use('/hotel', require('./routes/site'));
  app.use(require('./routes/bookings'));
  app.use(require('./routes/pages'));

  /* Where an error page's button goes: the guest website, the person's start page, or sign-in. */
  const startFor = (req) => {
    if (req.path.startsWith('/hotel')) return { href: '/hotel', label: 'Back to the hotel website' };
    if (req.user) return { href: security.can(req.user, 'frontOffice') ? '/dashboard' : '/housekeeping', label: 'Back to Frontdesk' };
    return { href: '/login', label: 'Go to sign in' };
  };

  app.use((req, res) => {
    res.status(404);
    if (req.path.startsWith('/api/')) return res.json({ error: 'Not found.' });
    res.render('pages/error', { title: 'Page not found', message: 'That page doesn’t exist. Check the address or use the button below.', status: 404, start: startFor(req) });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.status || error.statusCode || 500;
    if (status >= 500) console.error(error);
    const message = status >= 500 ? 'Something went wrong on our side. The error was logged; please try again.' : error.message;
    res.status(status);
    if (req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json')) return res.json({ error: message, field: error.field });
    res.render('pages/error', { title: status === 403 ? 'No access' : 'Something went wrong', message, status, start: startFor(req) });
  });

  return app;
}

module.exports = { createApp };
