'use strict';
/* HTTP security headers, cookie parsing, CSRF checks and role checks. */
const config = require('../config');
const { safeEqual } = require('./auth');

function headers(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
    "connect-src 'self'", "form-action 'self'", "base-uri 'self'", "object-src 'none'",
  ];
  if (!config.embed) {
    csp.push("frame-ancestors 'self'");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  res.setHeader('Content-Security-Policy', csp.join('; '));
  if (config.production && config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

function cookies(req, res, next) {
  req.cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    try {
      req.cookies[name] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  next();
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/* Every state-changing request from a signed-in user must carry the session's CSRF token. */
/* Forms that work without a session carry their own token (checked in their routes). */
const OWN_TOKEN = /^\/(hotel(\/|$)|login$|password\/|feedback\/)/; // public forms with their own tokens

function csrf(req, res, next) {
  // These two routes verify their own signatures/tokens after parsing the raw webhook or multipart form.
  if (!UNSAFE.has(req.method) || !req.session || OWN_TOKEN.test(req.path) || (req.method === 'POST' && (req.path === '/integrations/youpi/webhook' || req.path === '/admin/payments/upi'))) return next();
  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf);
  if (safeEqual(sent, req.session.csrf_token)) return next();
  const error = new Error('Your session form expired. Reload the page and try again.');
  error.status = 403;
  next(error);
}

const ROLE_RANK = { housekeeping: 1, frontdesk: 2, manager: 3, admin: 4 };

/* What each role may do. */
const ABILITIES = {
  frontOffice: ['frontdesk', 'manager', 'admin'], // dashboard, reservations, tape chart, guests
  rooms: ['housekeeping', 'frontdesk', 'manager', 'admin'],
  housekeeping: ['housekeeping', 'frontdesk', 'manager', 'admin'],
  bookings: ['frontdesk', 'manager', 'admin'], // create and change reservations
  manage: ['manager', 'admin'], // admin panel: rooms, rates, guests, activity
  administer: ['admin'], // hotel settings and staff accounts
};
const can = (user, ability) => Boolean(user && ABILITIES[ability].includes(user.role));

function requireUser(req, res, next) {
  if (req.user) return next();
  if (req.accepts(['html', 'json']) === 'json' || req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sign in again to continue.' });
  const nextUrl = req.originalUrl && req.originalUrl !== '/' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  res.redirect(`/login${nextUrl}`);
}

const requireAbility = (ability) => (req, res, next) => {
  if (!req.user) return requireUser(req, res, next);
  if (can(req.user, ability)) return next();
  const error = new Error('Your account does not have access to this page.');
  error.status = 403;
  next(error);
};

module.exports = { headers, cookies, csrf, can, requireUser, requireAbility, ROLE_RANK };
