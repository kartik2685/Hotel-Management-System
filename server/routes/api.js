'use strict';
/* JSON endpoints used by the page scripts. Every request needs a session and the CSRF header. */
const express = require('express');
const { requireUser, requireAbility, can } = require('../lib/security');
const activity = require('../lib/activity');
const clock = require('../lib/clock');
const reservations = require('../services/reservations');
const settingsService = require('../services/settings');

const router = express.Router();
router.use(requireUser);

const fail = (status, message) => Object.assign(new Error(message), { status });

/* Booking status changes. */
const bookingAction = (fn) => (req, res, next) => {
  try {
    const booking = fn(req.db, req, req.params.confirmation, req.body || {});
    res.json({ booking: reservations.toJson(booking), time: reservations.toJson(booking).time });
  } catch (error) {
    next(error);
  }
};
router.post('/reservations/:confirmation/check-in', requireAbility('bookings'), bookingAction((db, req, c) => reservations.checkIn(db, req, c)));
router.post('/reservations/:confirmation/confirm', requireAbility('bookings'), bookingAction((db, req, c) => reservations.confirm(db, req, c)));
router.post('/reservations/:confirmation/check-out', requireAbility('bookings'),
  bookingAction((db, req, c, body) => reservations.checkOut(db, req, c, { settle: body.settle === true || body.settle === 'true', method: body.method })));
router.post('/reservations/:confirmation/cancel', requireAbility('bookings'), bookingAction((db, req, c) => reservations.cancel(db, req, c)));

/* Room board: clean / dirty. */
router.post('/rooms/:number/status', requireAbility('rooms'), (req, res, next) => {
  try {
    const db = req.db;
    const status = req.body && req.body.status;
    if (!['clean', 'dirty'].includes(status)) throw fail(422, 'Choose clean or dirty.');
    const room = db.get('SELECT * FROM rooms WHERE number = ? AND active = 1', String(req.params.number));
    if (!room) throw fail(404, 'That room does not exist.');
    const bd = settingsService.businessDate(db);
    if (db.get('SELECT 1 FROM room_blocks WHERE room_id = ? AND start_date <= ? AND end_date > ?', room.id, bd, bd)) {
      throw fail(422, `Room ${room.number} is out of order. Put it back in service first.`);
    }
    db.run('UPDATE rooms SET hk_status = ?, hk_updated_at = ? WHERE id = ?', status, clock.stamp(req.settings.timezone), room.id);
    activity.log(db, req, 'room.status', `Room ${room.number} marked ${status}`);
    res.json({ room: room.number, status });
  } catch (error) {
    next(error);
  }
});

/* Room board: housekeeper for a room. */
router.post('/rooms/:number/attendant', requireAbility('rooms'), (req, res, next) => {
  try {
    const db = req.db;
    if (!can(req.user, 'bookings') && !can(req.user, 'manage')) throw fail(403, 'Only the front office or a manager can reassign rooms.');
    const room = db.get('SELECT * FROM rooms WHERE number = ? AND active = 1', String(req.params.number));
    if (!room) throw fail(404, 'That room does not exist.');
    const code = String((req.body && req.body.attendant) || '');
    let attendant = null;
    if (code) {
      attendant = db.get("SELECT id, name FROM users WHERE code = ? AND role = 'housekeeping' AND active = 1", code);
      if (!attendant) throw fail(422, 'Pick an attendant from the list.');
    }
    db.run('UPDATE rooms SET attendant_id = ? WHERE id = ?', attendant ? attendant.id : null, room.id);
    activity.log(db, req, 'room.attendant', `Room ${room.number} ${attendant ? `assigned to ${attendant.name}` : 'unassigned'}`);
    res.json({ room: room.number, attendant: code });
  } catch (error) {
    next(error);
  }
});

/* Housekeeping: tick a task. Finishing a clean makes the room clean (and un-ticking makes it dirty again). */
router.post('/tasks/:id', requireAbility('housekeeping'), (req, res, next) => {
  try {
    const db = req.db;
    const task = db.get('SELECT t.*, rm.number FROM housekeeping_tasks t JOIN rooms rm ON rm.id = t.room_id WHERE t.id = ?', Number.parseInt(req.params.id, 10) || 0);
    if (!task) throw fail(404, 'That task no longer exists.');
    const done = req.body && (req.body.done === true || req.body.done === 'true');
    const stamp = clock.stamp(req.settings.timezone);
    db.tx(() => {
      db.run('UPDATE housekeeping_tasks SET done_at = ?, done_by = ? WHERE id = ?', done ? stamp : null, done ? req.user.id : null, task.id);
      if (task.kind !== 'maintenance') db.run('UPDATE rooms SET hk_status = ?, hk_updated_at = ? WHERE id = ?', done ? 'clean' : 'dirty', stamp, task.room_id);
    });
    activity.log(db, req, 'task.update', `${task.title} for room ${task.number} ${done ? 'done' : 'reopened'}`);
    res.json({ id: task.id, done });
  } catch (error) {
    next(error);
  }
});

/* Notifications: mark all read for the signed-in user. */
router.post('/notifications/read', (req, res) => {
  req.db.run('INSERT OR IGNORE INTO notification_reads (notification_id, user_id) SELECT id, ? FROM notifications', req.user.id);
  res.json({ ok: true });
});

module.exports = router;
