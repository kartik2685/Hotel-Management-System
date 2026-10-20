'use strict';
/* A brand-new hotel has no room types and no rooms yet. Every page must still open, and the booking form must
   say what is missing instead of rendering a room-type select with nothing in it (that empty select crashed the
   page script on `selectedOptions[0].dataset`). */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');

let hotel;

before(async () => {
  hotel = await startHotel({ load: (db) => seed.createEmptyHotel(db, { email: 'owner@example.com', name: 'Owner', hotelName: 'New Hotel', password: 'owner-demo-1' }) });
});
after(async () => { await hotel.stop(); });

describe('an empty hotel', () => {
  test('signs in and opens every main page', async () => {
    const c = hotel.client();
    const login = await c.login('owner@example.com', 'owner-demo-1');
    assert.equal(login.status, 303);
    for (const path of ['/dashboard', '/reservations', '/rooms', '/housekeeping', '/tape-chart', '/admin/calendar', '/admin/rooms', '/admin/room-types']) {
      const page = await c.get(path);
      assert.equal(page.status, 200, `${path} should open, got ${page.status}`);
    }
  });

  test('the booking form explains that a room type is needed instead of rendering an empty select', async () => {
    const c = hotel.client();
    await c.login('owner@example.com', 'owner-demo-1');
    const page = await c.get('/reservations');
    assert.match(page.text, /Add a room type first/);
    assert.match(page.text, /href="\/admin\/room-types"/);
    assert.doesNotMatch(page.text, /data-booking-form/);
    assert.doesNotMatch(page.text, /id="nb-type"/);
    assert.doesNotMatch(page.text, /data-quote="total"/);
  });

  test('adding a room type brings the booking form back, and a booking can be made', async () => {
    const c = hotel.client();
    await c.login('owner@example.com', 'owner-demo-1');
    const form = await c.get('/admin/room-types');
    const token = form.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const created = await c.request('POST', '/admin/room-types', {
      form: { _csrf: token, code: 'CQ', name: 'Classic Queen', base_rate: '4500', max_guests: '2', clean_minutes: '30', service_minutes: '20', sort: '1', active: 'on', online: 'on' },
    });
    assert.equal(created.status, 303);

    const typeId = hotel.db.get("SELECT id FROM room_types WHERE code = 'CQ'").id;
    const rooms = await c.get('/admin/rooms');
    const roomToken = rooms.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const room = await c.request('POST', '/admin/rooms', { form: { _csrf: roomToken, number: '101', floor: '1', room_type_id: String(typeId), active: 'on' } });
    assert.equal(room.status, 303);

    const page = await c.get('/reservations');
    assert.match(page.text, /data-booking-form/);
    assert.match(page.text, /<option value="CQ"/);

    const booking = await c.api('/reservations', {
      arrival: '2026-09-24', departure: '2026-09-26', type: 'CQ', adults: '2', children: '0', plan: 'BAR',
      first: 'Asha', last: 'Roy', email: 'asha.roy@example.com', source: 'Walk-in',
    });
    assert.equal(booking.status, 201, booking.text);
    assert.match(booking.body.booking.confirmation, /^[A-Z]{3}-\d+$/);
  });
});
