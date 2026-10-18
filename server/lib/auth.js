'use strict';
/* Passwords, sessions and sign-in throttling. */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('../config');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const COOKIE = 'hms_session';
const LOGIN_COOKIE = 'hms_login';
const MAX_FAILURES = 5; // per email in the window below
const MAX_IP_FAILURES = 30;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, key] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(expected, actual);
}

// A real hash to compare against when the email is unknown, so timing does not reveal accounts.
let dummyHash = null;
const getDummyHash = async () => (dummyHash = dummyHash || (await hashPassword(randomToken())));

function cookieOptions(maxAgeMs) {
  const options = { httpOnly: true, path: '/', secure: config.cookieSecure, sameSite: 'lax' };
  if (config.embed) Object.assign(options, { sameSite: 'none', secure: true, partitioned: true });
  if (maxAgeMs) options.maxAge = maxAgeMs;
  return options;
}

function createSession(db, user, { remember, shift, ip, userAgent }) {
  const token = randomToken();
  const now = Date.now();
  const lifetime = remember ? config.sessionRememberDays * 864e5 : config.sessionIdleMinutes * 6e4;
  db.run(
    `INSERT INTO sessions (id, user_id, csrf_token, shift, remember, created_at, last_seen, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sha256(token), user.id, randomToken(), shift, remember ? 1 : 0, now, now, now + lifetime, ip || null, (userAgent || '').slice(0, 200),
  );
  return { token, maxAge: remember ? lifetime : null };
}

/* Looks up the session for a cookie value; slides the idle timeout forward. */
function readSession(db, token) {
  if (!token) return null;
  const id = sha256(token);
  const row = db.get(
    `SELECT s.*, u.name, u.email, u.role, u.title, u.department, u.code, u.avatar_tone, u.active, u.must_change_password, u.shift AS user_shift
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, id,
  );
  const now = Date.now();
  if (!row || row.expires_at <= now || !row.active) {
    if (row) db.run('DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  if (now - row.last_seen > 30000) {
    const expires = row.remember ? row.expires_at : now + config.sessionIdleMinutes * 6e4;
    db.run('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?', now, expires, id);
  }
  return { ...row, id };
}

const destroySession = (db, token) => token && db.run('DELETE FROM sessions WHERE id = ?', sha256(token));
const purgeExpired = (db) => db.run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());

function tooManyFailures(db, email, ip) {
  const since = Date.now() - FAILURE_WINDOW_MS;
  const byEmail = db.get('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND ok = 0 AND created_at > ?', email, since).n;
  const byIp = ip ? db.get('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ok = 0 AND created_at > ?', ip, since).n : 0;
  return byEmail >= MAX_FAILURES || byIp >= MAX_IP_FAILURES;
}

function recordAttempt(db, email, ip, ok) {
  db.run('INSERT INTO login_attempts (email, ip, ok, created_at) VALUES (?, ?, ?, ?)', email, ip || null, ok ? 1 : 0, Date.now());
  if (ok) db.run('DELETE FROM login_attempts WHERE email = ? AND ok = 0', email);
  db.run('DELETE FROM login_attempts WHERE created_at < ?', Date.now() - 864e5);
}

/* Signed token for the sign-out link (so a third-party page cannot sign people out). */
const signOutToken = (session) => sha256('sign-out:' + session.csrf_token).slice(0, 32);

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

module.exports = {
  COOKIE, LOGIN_COOKIE, hashPassword, verifyPassword, getDummyHash, cookieOptions, createSession, readSession, destroySession,
  purgeExpired, tooManyFailures, recordAttempt, signOutToken, safeEqual, randomToken,
};
