'use strict';
/* Sign in, sign out and password changes. */
const express = require('express');
const config = require('../config');
const auth = require('../lib/auth');
const activity = require('../lib/activity');
const f = require('../lib/format');
const clock = require('../lib/clock');
const settingsService = require('../services/settings');
const stats = require('../services/stats');
const shellService = require('../services/shell');
const { requireUser, can } = require('../lib/security');
const crypto = require('node:crypto');
const mail = require('../lib/mail');
const emails = require('../services/emails');
const limits = require('../lib/limits');
const formtoken = require('../lib/formtoken');

const router = express.Router();
const SHIFTS = [
  { value: 'morning', label: 'Morning' }, { value: 'evening', label: 'Evening' }, { value: 'night', label: 'Night audit' },
];

const homeFor = (user) => (can(user, 'frontOffice') ? '/dashboard' : '/housekeeping');
/* Only same-site paths are allowed as a redirect target after signing in. */
const safeNext = (value) => (typeof value === 'string' && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(value) && !value.startsWith('/login') ? value : '');

const NOTICES = { done: { title: 'Password changed', text: 'Sign in with your new password.' } };

/* The sign-in and password-reset forms carry their own token (see lib/formtoken.js). */
const loginForm = (req) => ({
  secret: settingsService.siteSecret(req.db), purpose: 'login', cookie: auth.LOGIN_COOKIE, maxAge: 12 * 60 * 60 * 1000, cookieOptions: auth.cookieOptions,
});

/* "ok", "blocked" (the browser sent no cookie at all, so a session could not stick either) or "expired". */
function checkLoginForm(req) {
  const result = formtoken.check(req, loginForm(req));
  if (!result.cookieSent && result.fresh) return 'blocked';
  return result.ok ? 'ok' : 'expired';
}

/* One line in the server log, to tell blocked cookies from old pages when someone cannot sign in. */
function logFormProblem(req, problem) {
  const why = problem === 'blocked' ? 'the browser sent no cookie (it blocks cookies here)' : 'the form token was old or not ours';
  console.warn(`[sign-in] refused: ${why} · sec-fetch-site=${req.get('sec-fetch-site') || '-'} dest=${req.get('sec-fetch-dest') || '-'} · ${String(req.get('user-agent') || '-').slice(0, 160)}`);
}

function renderLogin(req, res, { status = 200, email = '', errors = {}, shift = 'morning', remember = false, resetSent = false, cookieBlocked = false } = {}) {
  const db = req.db;
  const settings = req.settings;
  const bd = settingsService.businessDate(db);
  const tonight = stats.night(db, bd);
  const token = formtoken.forForm(req, res, loginForm(req));
  const next = safeNext(req.query.next || req.body?.next);
  const loginPath = `/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  const hours = settings.shifts || {};
  const demoUser = settings.demo_mode ? db.get("SELECT email FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") : null;
  res.status(status).render('pages/login', {
    hotel: {
      name: settings.hotel_name, short: settings.hotel_name.replace(/ Hotel$/, ''), rooms: tonight.rooms,
      occupancy: f.pct1(tonight.sold, tonight.rooms), arrivals: db.get("SELECT COUNT(*) AS n FROM reservations WHERE arrival = ? AND status IN ('confirmed', 'checked_in')", bd).n,
    },
    idleMinutes: config.sessionIdleMinutes,
    loginToken: token,
    next,
    email, errors, remember,
    shift,
    shifts: SHIFTS.map((s) => ({ ...s, label: `${s.label} · ${(hours[s.value] || []).join('–')}` })),
    demoHint: demoUser ? `Demo: sign in as ${demoUser.email} with the password ${config.demoPassword}.` : '',
    resetSent, mailReady: mail.configured(), notice: NOTICES[req.query.reset] || null,
    // When this browser blocks our cookies: inside a frame (preview panel) or in a normal tab.
    cookieBlocked: cookieBlocked && (req.get('sec-fetch-dest') === 'iframe' ? 'frame' : 'page'),
    loginPath, loginAddress: siteUrl(req) + loginPath, loginHost: req.get('host'), // the page script fills in the address the browser sees
  });
}

/* Address used in links inside emails. Set "Website address" in Admin → Hotel settings for production. */
function siteUrl(req) {
  if (req.settings.site_url) return req.settings.site_url.replace(/\/+$/, '');
  const protocol = config.embed || config.cookieSecure ? 'https' : req.protocol;
  return `${protocol}://${req.get('host')}`;
}

/* ------------------------------------------------------------------ forgotten passwords */
router.post('/password/forgot', (req, res) => {
  const db = req.db;
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  if (!formtoken.check(req, loginForm(req)).ok) {
    logFormProblem(req, 'expired');
    return renderLogin(req, res, { status: 403, errors: { password: 'The form expired. Please try again.' } });
  }
  // Same answer whether or not the account exists; quietly limited per email and per network address.
  const allowed = limits.hit(`reset:${email}`, 3, 60 * 60 * 1000) && limits.hit(`reset-ip:${req.ip}`, 10, 60 * 60 * 1000);
  const user = allowed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? db.get('SELECT * FROM users WHERE email = ? AND active = 1', email) : null;
  if (user) {
    const token = auth.randomToken();
    const now = Date.now();
    db.run('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
      user.id, crypto.createHash('sha256').update(token).digest('hex'), now + 60 * 60 * 1000, now);
    mail.send(db, req.settings, emails.passwordReset(req.settings, user, `${siteUrl(req)}/password/reset?token=${token}`));
    activity.log(db, { user, ip: req.ip, settings: req.settings }, 'auth.reset-request', `Password reset link sent to ${user.email}`);
  }
  renderLogin(req, res, { email, resetSent: true });
});

function findReset(db, token) {
  if (!token || String(token).length < 30) return null;
  const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const row = db.get('SELECT pr.*, u.name, u.email, u.active FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token_hash = ?', hash);
  return row && !row.used_at && row.expires_at > Date.now() && row.active ? row : null;
}

function renderReset(req, res, { status = 200, errors = {}, token = '' } = {}) {
  const reset = findReset(req.db, token);
  res.status(reset ? status : 410).render('pages/password-reset', { hotel: { name: req.settings.hotel_name }, reset, token, errors });
}

router.get('/password/reset', (req, res) => renderReset(req, res, { token: req.query.token }));

router.post('/password/reset', async (req, res, next) => {
  try {
    const db = req.db;
    const token = String(req.body.token || '');
    const reset = findReset(db, token);
    if (!reset) return renderReset(req, res, { token });
    const password = String(req.body.password || '');
    if (password.length < 8 || password.length > 200) return renderReset(req, res, { status: 422, token, errors: { password: 'Use 8 to 200 characters.' } });
    if (password !== String(req.body.confirm || '')) return renderReset(req, res, { status: 422, token, errors: { confirm: 'The two passwords don’t match.' } });
    const hash = await auth.hashPassword(password);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hash, reset.user_id);
      db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', Date.now(), reset.user_id);
      db.run('DELETE FROM sessions WHERE user_id = ?', reset.user_id); // signed out everywhere
      db.run('DELETE FROM login_attempts WHERE email = ?', reset.email);
    });
    activity.log(db, { user: { id: reset.user_id, name: reset.name }, ip: req.ip, settings: req.settings }, 'auth.reset', `${reset.name} set a new password with a reset link`);
    res.redirect(303, '/login?reset=done');
  } catch (error) {
    next(error);
  }
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(homeFor(req.user));
  renderLogin(req, res, { shift: shiftNow(req) });
});

/* Lets the sign-in page find out whether this browser keeps our cookies (some block them inside preview panels). */
router.get('/login/cookie-check', (req, res) => {
  res.json({ cookies: Boolean(req.cookies[auth.LOGIN_COOKIE]) });
});

/* Shift that matches the hotel clock, used to preselect the login form. */
function shiftNow(req) {
  const time = clock.hotelNow(req.settings.timezone).time;
  const s = req.settings.shifts || {};
  for (const name of ['morning', 'evening']) if (s[name] && time >= s[name][0] && time < s[name][1]) return name;
  return 'night';
}

router.post('/login', async (req, res, next) => {
  try {
    const db = req.db;
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
    const password = String(req.body.password || '');
    const shift = SHIFTS.some((s) => s.value === req.body.shift) ? req.body.shift : 'morning';
    const remember = Boolean(req.body.remember);
    const form = { email, shift, remember };
    const formState = checkLoginForm(req);
    if (formState === 'blocked') {
      logFormProblem(req, formState);
      return renderLogin(req, res, { ...form, status: 403, cookieBlocked: true, errors: { password: 'This browser blocked the sign-in cookie, so you can’t stay signed in here.' } });
    }
    if (formState !== 'ok') {
      logFormProblem(req, formState);
      return renderLogin(req, res, { ...form, status: 403, errors: { password: 'The form expired. Please sign in again.' } });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return renderLogin(req, res, { ...form, status: 422, errors: { email: 'Enter the email you sign in with.' } });
    if (password.length < 8) return renderLogin(req, res, { ...form, status: 422, errors: { password: 'Passwords are at least 8 characters.' } });
    if (auth.tooManyFailures(db, email, req.ip)) {
      return renderLogin(req, res, { ...form, status: 429, errors: { password: 'Too many attempts. Wait 15 minutes and try again, or ask a manager to reset your password.' } });
    }
    const user = db.get('SELECT * FROM users WHERE email = ? AND active = 1', email);
    const ok = await auth.verifyPassword(password, user ? user.password_hash : await auth.getDummyHash());
    auth.recordAttempt(db, email, req.ip, ok && Boolean(user));
    if (!user || !ok) return renderLogin(req, res, { ...form, status: 401, errors: { password: 'That email and password don’t match.' } });

    const session = auth.createSession(db, user, { remember, shift, ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie(auth.COOKIE, session.token, auth.cookieOptions(session.maxAge));
    db.run('UPDATE users SET last_login_at = ? WHERE id = ?', clock.stamp(req.settings.timezone), user.id);
    req.user = user;
    activity.log(db, req, 'auth.sign-in', `${user.name} signed in`);
    res.redirect(303, safeNext(req.body.next) || homeFor(user));
  } catch (error) {
    next(error);
  }
});

function signOut(req, res) {
  if (req.session) {
    activity.log(req.db, req, 'auth.sign-out', `${req.user.name} signed out`);
    auth.destroySession(req.db, req.cookies[auth.COOKIE]);
  }
  res.clearCookie(auth.COOKIE, auth.cookieOptions());
  res.redirect(303, '/login');
}
router.get('/logout', (req, res) => {
  if (req.session && !auth.safeEqual(req.query.t, auth.signOutToken(req.session))) return res.redirect(homeFor(req.user));
  signOut(req, res);
});
router.post('/logout', signOut);

router.get('/account', requireUser, (req, res) => renderAccount(req, res));

function renderAccount(req, res, { status = 200, errors = {}, done = false } = {}) {
  const shell = shellService.build(req.db, req, 'account');
  res.status(status).render('pages/account', {
    title: 'Your account · Frontdesk Hotel Management', description: 'Change your Frontdesk password.', page: 'account',
    css: ['pages/admin'], scripts: [], shell, errors, done, mustChange: Boolean(req.user.must_change_password),
  });
}

router.post('/account', requireUser, async (req, res, next) => {
  try {
    const db = req.db;
    const current = String(req.body.current || '');
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    const user = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!(await auth.verifyPassword(current, user.password_hash))) return renderAccount(req, res, { status: 422, errors: { current: 'That is not your current password.' } });
    if (password.length < 8) return renderAccount(req, res, { status: 422, errors: { password: 'Use at least 8 characters.' } });
    if (password.length > 200) return renderAccount(req, res, { status: 422, errors: { password: 'Use at most 200 characters.' } });
    if (password === current) return renderAccount(req, res, { status: 422, errors: { password: 'Choose a password you have not used here before.' } });
    if (password !== confirm) return renderAccount(req, res, { status: 422, errors: { confirm: 'The two passwords don’t match.' } });
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', await auth.hashPassword(password), user.id);
    // Sign out every other device that still uses the old password.
    db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', user.id, req.session.id);
    activity.log(db, req, 'auth.password', `${user.name} changed their password`);
    if (req.settings.demo_mode && user.role === 'admin') settingsService.save(db, { demo_mode: false });
    req.user.must_change_password = 0;
    renderAccount(req, res, { done: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
