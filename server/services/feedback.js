'use strict';
/* Guest feedback after check-out. The guest opens a signed link (sent with the thank-you message on WhatsApp),
   gives 1 to 5 stars and a comment: happy guests are then asked for a Google review (Admin → Website), unhappy
   ones get a manager's call — staff see a notification at once. One answer per booking. */
const crypto = require('node:crypto');
const f = require('../lib/format');
const clock = require('../lib/clock');
const activity = require('../lib/activity');
const settingsService = require('./settings');

const token = (db, confirmation) => crypto.createHmac('sha256', settingsService.siteSecret(db)).update(`feedback:${confirmation}`).digest('base64url').slice(0, 32);
function tokenOk(db, confirmation, given) {
  const expected = Buffer.from(token(db, confirmation));
  const actual = Buffer.from(String(given || ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const pathOf = (db, confirmation) => `/feedback/${encodeURIComponent(confirmation)}?t=${token(db, confirmation)}`;

/* The booking behind a feedback link (stays that have checked out only), with any answer it already has. */
function find(db, confirmation, given) {
  if (!tokenOk(db, String(confirmation || ''), given)) return null;
  const b = db.get(`SELECT r.id, r.confirmation, r.status, r.arrival, r.departure, g.first_name, g.last_name, rm.number AS room
                      FROM reservations r JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id WHERE r.confirmation = ?`, confirmation);
  if (!b || b.status !== 'checked_out') return null;
  return { ...b, answer: db.get('SELECT * FROM feedback WHERE reservation_id = ?', b.id) || null };
}

/* Saves the guest's answer; returns it, or { errors } for a form to fix. */
function save(db, b, body) {
  const rating = Number.parseInt(body.rating, 10);
  const comment = String(body.comment || '').trim().slice(0, 1000);
  if (!(rating >= 1 && rating <= 5)) return { errors: { rating: 'Choose from one to five stars.' }, values: { comment } };
  if (b.answer) return b.answer;
  const settings = settingsService.all(db);
  const stamp = clock.stamp(settings.timezone);
  db.tx(() => {
    db.run('INSERT INTO feedback (reservation_id, rating, comment, created_at) VALUES (?, ?, ?, ?)', b.id, rating, comment || null, stamp);
    const who = `${b.first_name} ${b.last_name}`.trim();
    if (rating <= 3) {
      db.run('INSERT INTO notifications (icon, tone, title, detail, created_at) VALUES (?, ?, ?, ?, ?)', 'star', 'warn',
        `${rating}★ feedback from ${who}`, `${b.confirmation}${b.room ? ` · room ${b.room}` : ''}${comment ? ` · “${comment.slice(0, 80)}”` : ''}`, stamp);
    }
    activity.log(db, { settings }, 'feedback.add', `${who} gave ${rating}★ for ${b.confirmation}`, 'Guest');
  });
  return db.get('SELECT * FROM feedback WHERE reservation_id = ?', b.id);
}

/* Answers in a period (by the day they were given): how many, the average, stars, the latest and the low ones. */
function summary(db, from, to) {
  const rows = db.all(`SELECT fb.*, r.confirmation, g.first_name || ' ' || g.last_name AS name, rm.number AS room
                         FROM feedback fb JOIN reservations r ON r.id = fb.reservation_id JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
                        WHERE substr(fb.created_at, 1, 10) >= ? AND substr(fb.created_at, 1, 10) <= ? ORDER BY fb.created_at DESC, fb.id DESC`, from, to);
  const average = rows.length ? rows.reduce((n, x) => n + x.rating, 0) / rows.length : 0;
  return {
    count: rows.length, average, averageText: rows.length ? average.toFixed(1) : '–',
    stars: [5, 4, 3, 2, 1].map((n) => ({ n, count: rows.filter((x) => x.rating === n).length })),
    latest: rows.slice(0, 8).map((x) => ({ ...x, when: f.formatDay(x.created_at) })),
    low: rows.filter((x) => x.rating <= 3),
  };
}

const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

module.exports = { token, tokenOk, pathOf, find, save, summary, stars };
