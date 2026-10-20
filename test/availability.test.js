'use strict';
/* Availability for a whole stay, not one night at a time. Two rooms, a blocked one on the first night and a
   booking on the second: every night has a room free, but no single room covers the stay. The hotel must not take
   a booking it can never check in (that guest could only ever be "No room yet"). */
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const { freshDatabase } = require('./helpers');
const seed = require('../server/db/seed');
const settingsService = require('../server/services/settings');
const reservations = require('../server/services/reservations');
const website = require('../server/services/website');

describe('availability for the whole stay', () => {
  let scratch;

  after(() => {
    if (scratch) {
      scratch.drop();
      settingsService.reset();
    }
  });

  test('a stay that only fits by swapping rooms from night to night is refused', async () => {
    scratch = freshDatabase();
    settingsService.reset();
    const db = scratch.db;
    await seed.createEmptyHotel(db, { email: 'owner@availability.test', name: 'Hotel Owner', hotelName: 'Availability Hotel', password: 'Owner-pass-2026' });
    const user = db.get('SELECT * FROM users ORDER BY id LIMIT 1');
    const typeId = db.get(
      "INSERT INTO room_types (code, name, base_rate_cents, max_guests, clean_minutes, service_minutes, sort, active, online) VALUES ('STD', 'Standard', 10000, 2, 30, 20, 1, 1, 1) RETURNING id",
    ).id;
    const room = (number) => db.get("INSERT INTO rooms (number, floor, room_type_id, hk_status, active) VALUES (?, 1, ?, 'clean', 1) RETURNING id", number, typeId).id;
    const one = room('101');
    const two = room('102');
    const guest = (first) => db.get("INSERT INTO guests (first_name, last_name, email, created_at) VALUES (?, 'Test', ?, '2026-09-20 09:00') RETURNING id", first, `${first.toLowerCase()}@availability.test`).id;
    const stay = (confirmation, roomId, arrival, departure, first) => db.run(
      `INSERT INTO reservations (confirmation, guest_id, room_type_id, room_id, arrival, departure, adults, children, rate_plan_id, nightly_rate_cents,
         status, tags, requests, room_total_cents, tax_cents, extras_cents, total_cents, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1, 10000, 'confirmed', '[]', '', ? , 0, 0, ?, 1, '2026-09-20 09:00')`,
      confirmation, guest(first), typeId, roomId, arrival, departure, 10000 * days(arrival, departure), 10000 * days(arrival, departure),
    );
    const days = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
    // 101 is out of order on the first night only; 102 is booked for the second night only
    db.run("INSERT INTO room_blocks (room_id, start_date, end_date, reason, created_at) VALUES (?, '2026-11-10', '2026-11-11', 'Bathroom', '2026-11-01 09:00')", one);
    stay('AV-102', two, '2026-11-11', '2026-11-12', 'Second');

    // nightly counts: night 1 has 101 blocked and 102 free; night 2 has both rooms, one taken
    assert.equal(db.get("SELECT COUNT(*) AS n FROM rooms WHERE room_type_id = ? AND active = 1", typeId).n, 2);
    // ...but no single room is free for both nights
    assert.deepEqual(reservations.freeRooms(db, typeId, '2026-11-10', '2026-11-12').map((r) => r.number), []);
    assert.equal(reservations.typeAvailable(db, typeId, '2026-11-10', '2026-11-12'), false);
    // the public site must not offer the room either
    assert.equal(website.roomsLeft(db, typeId, '2026-11-10', '2026-11-12'), 0);
    const offer = website.search(db, { arrival: '2026-11-10', departure: '2026-11-12', adults: '2', children: '0' });
    assert.equal(offer.results.find((r) => r.type.id === typeId).left, 0);

    const req = { db, user, settings: settingsService.all(db) };
    const type = db.get('SELECT * FROM room_types WHERE id = ?', typeId);
    const plan = db.get('SELECT * FROM rate_plans ORDER BY id LIMIT 1');
    const input = { arrival: '2026-11-10', departure: '2026-11-12', type, plan, adults: 1, children: 0, first: 'Never', last: 'Fits', email: 'never.fits@availability.test', phone: '', extras: [], requests: '', nights: 2 };
    assert.throws(() => reservations.insertBooking(db, req, input), /No Standard is free/);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM reservations WHERE confirmation NOT IN ('AV-102')").n, 0);

    // a real two-room night with one room free for the whole stay is still bookable, and check-in works
    assert.equal(reservations.typeAvailable(db, typeId, '2026-11-13', '2026-11-15'), true);
    const made = reservations.insertBooking(db, req, { ...input, arrival: '2026-11-13', departure: '2026-11-15', email: 'fits@availability.test' });
    assert.ok(made.room_number, 'the booking got a room');
    assert.equal(made.status, 'confirmed');
  });
});
