'use strict';
/* One-time links that let a person choose their own password (table password_resets, column kind):
   - reset:    asked for on the sign-in page ("Forgot password?"), works for one hour;
   - invite:   made by an admin for a new account, works for 7 days;
   - password: made by an admin for someone who forgot theirs, works for 24 hours.
   Only a hash of each link is stored. A link stops working once used, when it expires, when the account is
   switched off, or when an admin makes a newer one. */
const crypto = require('node:crypto');
const auth = require('../lib/auth');

const HOUR = 60 * 60 * 1000;
const LIFETIME = { reset: HOUR, invite: 7 * 24 * HOUR, password: 24 * HOUR };
const LASTS = { reset: 'one hour', invite: '7 days', password: '24 hours' };

const hashOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/* Columns to select FROM users for invitedState() and kindFor(). */
const PERSON_COLUMNS = `users.active, users.last_login_at, users.must_change_password,
  (SELECT MAX(pr.expires_at) FROM password_resets pr WHERE pr.user_id = users.id AND pr.kind = 'invite' AND pr.used_at IS NULL) AS invite_until,
  (SELECT COUNT(*) FROM password_resets pr WHERE pr.user_id = users.id AND pr.used_at IS NOT NULL) AS links_used`;

/* Invited and not in yet: no link used, never signed in and no temporary password either. */
const invited = (person) => Boolean(person.invite_until) && !person.links_used && !person.last_login_at && !person.must_change_password;

/* For the staff list: "sent" while the invite is open, "expired" when it ran out before the person joined. */
function inviteState(person, now = Date.now()) {
  if (!person.active || !invited(person)) return null;
  return person.invite_until > now ? 'sent' : 'expired';
}

/* The kind of link an admin makes for this person. */
const kindFor = (person) => (invited(person) ? 'invite' : 'password');

/* Address of a link, without the site: invites open the welcome page. */
const pathOf = (kind, token) => `${kind === 'invite' ? '/welcome' : '/password/reset'}?token=${token}`;

/* Makes a link and returns its token. `replace` ends the person's earlier links that are still open. */
function create(db, userId, kind, { replace = false } = {}) {
  const token = auth.randomToken();
  const now = Date.now();
  if (replace) db.run('UPDATE password_resets SET expires_at = ? WHERE user_id = ? AND used_at IS NULL AND expires_at > ?', now, userId, now);
  db.run('INSERT INTO password_resets (user_id, token_hash, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    userId, hashOf(token), kind, now + LIFETIME[kind], now);
  return token;
}

/* The open link with the person's name and email, or null. */
function find(db, token) {
  if (!token || String(token).length < 30) return null;
  const row = db.get(`SELECT pr.*, u.name, u.email, u.active
                        FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token_hash = ?`, hashOf(token));
  return row && !row.used_at && row.expires_at > Date.now() && row.active ? row : null;
}

module.exports = { LIFETIME, LASTS, PERSON_COLUMNS, hashOf, inviteState, kindFor, pathOf, create, find };
