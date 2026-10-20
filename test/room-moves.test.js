'use strict';
/* Moving an in-house guest to another room (services/reservations.js update). A guest who leaves today keeps the
   room until they have actually checked out: the room is free for tonight, so a booking arriving today may be
   pre-assigned there, but an in-house move must not put two checked-in guests in one room. */
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const { freshDatabase } = require('./helpers');
const seed = require('../server/db/seed');
const settingsService = require('../server/services/settings');
const reservations = require('../server/services/reservations');

describe('moving an in-house guest', () => {
  let scratch;

  after(() => {
    if (scratch) {
      scratch.drop();
      settingsService.reset();
    }
  });

  test('a room whose guest leaves today is not offered, and the move waits for that guest to check out', async () => {
    scratch = freshDatabase();
    settingsService.reset();
    const db = scratch.db;
    await seed.createEmptyHotel(db, { email: 'owner@move.test', name: 'Hotel Owner', hotelName: 'Move Hotel', password: 'Owner-pass-2026' });
    const user = db.get('SELECT * FROM users ORDER BY id LIMIT 1');
    const typeId = db.get(
      "INSERT INTO room_types (code, name, base_rate_cents, max_guests, clean_minutes, service_minutes, sort, active, online) VALUES ('STD', 'Standard', 25900, 3, 30, 20, 1, 1, 1) RETURNING id",
    ).id;
    const room = (number) => db.get("INSERT INTO rooms (number, floor, room_type_id, hk_status, active) VALUES (?, 1, ?, 'clean', 1) RETURNING id", number, typeId).id;
    const leaving = room('101');
    const other = room('102');
    const stay = (confirmation, roomId, arrival, departure, first) => {
      const guestId = db.get("INSERT INTO guests (first_name, last_name, email, created_at) VALUES (?, 'Test', ?, '2026-09-20 09:00') RETURNING id", first, `${first.toLowerCase()}@move.test`).id;
      db.run(
        `INSERT INTO reservations (confirmation, guest_id, room_type_id, room_id, arrival, departure, adults, children, rate_plan_id, nightly_rate_cents,
           status, tags, requests, room_total_cents, tax_cents, extras_cents, total_cents, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 2, 0, 1, 25900, 'checked_in', '[]', '', 25900, 0, 0, 25900, 1, '2026-09-23 09:00')`,
        confirmation, guestId, typeId, roomId, arrival, departure,
      );
    };
    stay('P-DUEOUT', leaving, '2026-09-23', '2026-09-24', 'Dueout'); // in 101, leaves today
    stay('P-MOVER', other, '2026-09-24', '2026-09-26', 'Mover'); // arrived today, in 102
    const today = settingsService.businessDate(db);
    // 101 has had its stayover service already; 102 is still waiting for one
    db.run("INSERT INTO housekeeping_tasks (task_date, room_id, kind, title, minutes, done_at) VALUES (?, ?, 'stayover', 'Stayover service', 20, ?)", today, leaving, `${today} 09:00`);
    db.run("INSERT INTO housekeeping_tasks (task_date, room_id, kind, title, minutes) VALUES (?, ?, 'stayover', 'Stayover service', 20)", today, other);
    const req = { db, user, settings: settingsService.all(db), ip: '127.0.0.1' };
    const body = {
      arrival: '2026-09-24', departure: '2026-09-26', room_type_id: String(typeId), room: '101', adults: '2', children: '0',
      rate_plan_id: '1', nightly_rate: '259', eta: '', notes: '', requests: '', first: 'Mover', last: 'Test', email: 'mover@move.test', phone: '',
    };

    // the booking page does not offer a room somebody is still in
    assert.deepEqual(reservations.detail(db, 'P-MOVER', '2026-09-24').rooms.map((r) => r.number), ['102']);
    let error;
    try {
      reservations.update(db, req, 'P-MOVER', body);
    } catch (e) {
      error = e;
    }
    assert.equal(error && error.status, 422);
    assert.match(error.errors.room, /Room 101 is still occupied/);
    assert.equal(db.get("SELECT room_id FROM reservations WHERE confirmation = 'P-MOVER'").room_id, other, 'the guest stays in 102');

    // once the guest in 101 has checked out and the room is cleaned, the move goes through
    reservations.checkOut(db, req, 'P-DUEOUT', { settle: true });
    // the room was cleaned during the stay, so leaving early books a fresh departure clean for today
    assert.deepEqual(
      db.all('SELECT kind FROM housekeeping_tasks WHERE task_date = ? AND room_id = ? ORDER BY id', today, leaving).map((t) => t.kind),
      ['stayover', 'departure'],
    );
    db.run("UPDATE rooms SET hk_status = 'clean' WHERE id = ?", leaving);
    const moved = reservations.update(db, req, 'P-MOVER', body);
    assert.equal(moved.room_number, '101');
    assert.equal(db.get("SELECT room_id FROM reservations WHERE confirmation = 'P-MOVER'").room_id, leaving);
    assert.deepEqual(
      db.all("SELECT confirmation FROM reservations WHERE room_id = ? AND status = 'checked_in'", leaving).map((r) => r.confirmation),
      ['P-MOVER'],
    );
    // the room the guest left had a stayover service booked: that becomes its departure clean
    assert.deepEqual(
      db.all('SELECT kind, minutes FROM housekeeping_tasks WHERE task_date = ? AND room_id = ?', today, other).map((t) => ({ ...t })),
      [{ kind: 'departure', minutes: 30 }],
    );
  });
});
