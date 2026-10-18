'use strict';
/* Tokens for the forms that work without a staff session: sign-in, password reset and the
 * guest website.
 *
 * A form is accepted when its token matches the visitor's cookie (double-submit cookie).
 * Some browsers never store cookies for a site that is shown inside another site's frame,
 * such as a live preview panel. So a token is also accepted when this server signed it
 * recently and the browser reports that the form was sent from a page on this same origin
 * (Sec-Fetch-Site, or Origin in older browsers). A page on another site can do neither. */
const crypto = require('node:crypto');
const { safeEqual } = require('./auth');

const mac = (secret, purpose, body) => crypto.createHmac('sha256', secret).update(`form:${purpose}:${body}`).digest('base64url').slice(0, 32);

/* "<time issued, base 36>.<random>.<signature>" */
function issue(secret, purpose, now = Date.now()) {
  const body = `${now.toString(36)}.${crypto.randomBytes(12).toString('base64url')}`;
  return `${body}.${mac(secret, purpose, body)}`;
}

/* Age in ms of a token this server signed for `purpose`, or -1 when it is not one. */
function age(secret, purpose, token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !safeEqual(parts[2], mac(secret, purpose, `${parts[0]}.${parts[1]}`))) return -1;
  const issued = parseInt(parts[0], 36);
  return Number.isFinite(issued) && issued <= now + 60 * 1000 ? Math.max(0, now - issued) : -1;
}

/* The browser says the request was sent by a page on this same origin. */
function sameOrigin(req) {
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = req.get('origin');
  try {
    return Boolean(origin) && new URL(origin).host === req.get('host');
  } catch {
    return false; // "null" or malformed
  }
}

/* Checks a posted form. `cookieSent` says whether the browser sent the form cookie at all. */
function check(req, { secret, purpose, cookie, maxAge }) {
  const sent = req.body && req.body._csrf;
  const stored = req.cookies[cookie];
  const tokenAge = age(secret, purpose, sent);
  const fresh = tokenAge >= 0 && tokenAge <= maxAge;
  return {
    ok: Boolean(stored && safeEqual(sent, stored)) || (fresh && sameOrigin(req)),
    cookieSent: Boolean(stored),
    fresh,
  };
}

/* Token for a new form: the visitor's current one while it is young, otherwise a new one (also set as the cookie). */
function forForm(req, res, { secret, purpose, cookie, maxAge, cookieOptions }) {
  const current = req.cookies[cookie];
  const currentAge = age(secret, purpose, current);
  if (currentAge >= 0 && currentAge < maxAge / 2) return current;
  const token = issue(secret, purpose);
  res.cookie(cookie, token, cookieOptions(maxAge));
  return token;
}

module.exports = { issue, age, sameOrigin, check, forForm };
