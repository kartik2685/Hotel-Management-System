'use strict';
/* GST on extras (services/tax-kinds.js): each extra has a kind (part of the stay at the room's rate, transport,
   other services, or no GST); bookings keep the GST they were made with; invoices and quotes show it. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const sample = require('../server/db/sample');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];
const STAFF = 'Staff-Test-2026';
const siteToken = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

describe('GST on extras', () => {
  let hotel;
  let owner;
  let desk;
  let booked; // the booking made in the second test
  const one = (sql, ...args) => hotel.db.get(sql, ...args);
  const extraId = (code) => one('SELECT id FROM extras WHERE code = ?', code).id;

  before(async () => {
    hotel = await startHotel({
      load: async (db) => {
        await seed.createEmptyHotel(db, { email: OWNER[0], name: 'Hotel Owner', password: OWNER[1] });
        await sample.add(db, { password: STAFF });
      },
    });
    owner = hotel.client();
    await owner.login(...OWNER);
    desk = hotel.client();
    await desk.login('priya.das@hooghlyresidency.example.com', STAFF);
  });
  after(() => hotel.stop());

  test('the admin chooses how each extra is taxed, and the list shows it', async () => {
    let page = (await owner.get('/admin/rates')).text;
    assert.match(page, /<strong>Airport pickup<\/strong>[\s\S]*?<td>Transport · 5%<\/td>/);
    assert.match(page, /<strong>Extra bed<\/strong>[\s\S]*?<td>Same as the room<\/td>/);
    page = (await owner.get(`/admin/rates?extra=${extraId('parking')}`)).text;
    assert.match(page, /<option value="other" selected>Other · 18% \(Anything else\)<\/option>/);
    const r = await owner.post(`/admin/extras/${extraId('parking')}`, { code: 'parking', name: 'Car parking', price: '300', per: 'night', sort: '3', active: 'on', gst_kind: 'none' });
    assert.equal(r.status, 303);
    assert.equal(one("SELECT gst_kind FROM extras WHERE code = 'parking'").gst_kind, 'none');
    await owner.post(`/admin/extras/${extraId('parking')}`, { code: 'parking', name: 'Car parking', price: '300', per: 'night', sort: '3', active: 'on', gst_kind: 'other' });
    assert.match((await owner.get('/admin/rates')).text, /<option value="other" selected>Other · 18%/); // a new extra starts as Other
  });

  test('a booking with an airport pickup and an extra bed: GST on both, in the tax and the total', async () => {
    await desk.get('/reservations');
    const r = await desk.api('/reservations', {
      arrival: '2026-11-02', departure: '2026-11-04', type: 'DLX', adults: '2', children: '0', plan: 'BAR',
      first: 'Tanvi', last: 'Bose', email: 'tanvi.bose@example.com', phone: '+91 98300 22334', source: 'Phone', extra: ['airport', 'extra-bed'],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    booked = one('SELECT * FROM reservations WHERE confirmation = ?', r.body.booking.confirmation);
    const rows = hotel.db.all('SELECT x.code, re.amount_cents, re.gst_kind, re.tax_bp, re.tax_cents FROM reservation_extras re JOIN extras x ON x.id = re.extra_id WHERE re.reservation_id = ? ORDER BY x.code', booked.id);
    assert.deepEqual(rows.map((x) => [x.code, x.amount_cents, x.gst_kind, x.tax_bp, x.tax_cents]), [
      ['airport', 150000, 'transport', 500, 7500], // ₹1,500 + 5%
      ['extra-bed', 200000, 'room', 500, 10000], // 2 nights × ₹1,000, at the Deluxe room's 5%
    ]);
    const roomTax = Math.round(booked.room_total_cents * 0.05);
    assert.equal(booked.tax_cents, roomTax + 17500);
    assert.equal(booked.extras_cents, 350000);
    assert.equal(booked.total_cents, booked.room_total_cents + booked.tax_cents + booked.extras_cents);
    const page = (await desk.get(`/reservations/${booked.confirmation}`)).text;
    assert.match(page, /<dt>Airport pickup <small class="cell-note">\+ GST 5%<\/small><\/dt>/);
  });

  test('editing the stay recomputes per-night extras and their GST; extras booked without GST stay so', async () => {
    const b = one('SELECT r.*, g.first_name, g.last_name, g.email, g.phone FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.id = ?', booked.id);
    const form = {
      arrival: b.arrival, departure: '2026-11-05', room_type_id: String(b.room_type_id), room: '', adults: '2', children: '0', rate_plan_id: String(b.rate_plan_id),
      nightly_rate: String(b.nightly_rate_cents / 100), source_id: String(b.source_id || ''), eta: '', first: b.first_name, last: b.last_name, email: b.email, phone: b.phone || '', notes: '', requests: '',
    };
    form.room = one('SELECT number FROM rooms WHERE id = ?', b.room_id)?.number || '';
    await desk.get(`/reservations/${b.confirmation}`);
    let r = await desk.post(`/reservations/${b.confirmation}`, form);
    assert.equal(r.status, 303, r.text.match(/field-error">([^<]+)/)?.[1]);
    const bed = one("SELECT re.* FROM reservation_extras re JOIN extras x ON x.id = re.extra_id WHERE re.reservation_id = ? AND x.code = 'extra-bed'", b.id);
    assert.deepEqual([bed.amount_cents, bed.tax_cents], [300000, 15000]);
    // a booking from before extras had GST: its extras stay untaxed when it is edited
    hotel.db.run("UPDATE reservation_extras SET gst_kind = 'none', tax_bp = 0, tax_cents = 0 WHERE reservation_id = ? AND extra_id = ?", b.id, extraId('airport'));
    r = await desk.post(`/reservations/${b.confirmation}`, { ...form, eta: '18:00' });
    assert.equal(r.status, 303);
    assert.equal(one('SELECT tax_cents FROM reservation_extras WHERE reservation_id = ? AND extra_id = ?', b.id, extraId('airport')).tax_cents, 0);
    const after = one('SELECT * FROM reservations WHERE id = ?', b.id);
    assert.equal(after.tax_cents, Math.round(after.room_total_cents * 0.05) + 15000);
  });

  test('the invoice lists taxed extras with their SAC code and rate', async () => {
    const stay = one(`SELECT r.confirmation, r.id FROM reservations r WHERE r.status = 'checked_in'
                        AND EXISTS (SELECT 1 FROM reservation_extras re WHERE re.reservation_id = r.id AND re.tax_bp > 0) ORDER BY r.id LIMIT 1`);
    await desk.get(`/reservations/${stay.confirmation}`);
    assert.equal((await desk.post(`/reservations/${stay.confirmation}/invoice`, { bill_to: '', gstin: '' })).status, 303);
    const inv = JSON.parse(one('SELECT data FROM invoices WHERE reservation_id = ? ORDER BY id DESC', stay.id).data);
    const extras = hotel.db.all('SELECT x.name, re.* FROM reservation_extras re JOIN extras x ON x.id = re.extra_id WHERE re.reservation_id = ? AND re.tax_bp > 0', stay.id);
    for (const x of extras) {
      const line = inv.lines.find((l) => l.text.startsWith(x.name));
      assert.ok(line && line.taxed && line.tax === x.tax_cents && /^99\d{4}$/.test(line.sac), JSON.stringify(line));
    }
    assert.equal(inv.tax, inv.taxes.reduce((n, t) => n + t.tax, 0));
    assert.equal(inv.total, one('SELECT total_cents FROM reservations WHERE id = ?', stay.id).total_cents);
  });

  test('the website shows extras with GST, and the booking costs what the page said', async () => {
    const guest = hotel.client();
    const query = new URLSearchParams({ arrival: '2026-11-10', departure: '2026-11-12', adults: '2', children: '0', type: 'DLX', plan: 'BAR' });
    const page = await guest.get(`/hotel/book/details?${query}`);
    assert.match(page.text, /value="airport" data-price="150000" data-per="stay" data-tax="5"/);
    assert.match(page.text, /value="extra-bed" data-price="100000" data-per="night" data-tax="5"/);
    assert.match(page.text, /<dt>Extras \(incl\. GST\)<\/dt>/);
    const base = Number(page.text.match(/data-base="(\d+)"/)[1]);
    const r = await guest.request('POST', '/hotel/book', {
      form: [['_csrf', siteToken(page.text)], ...Object.entries({ arrival: '2026-11-10', departure: '2026-11-12', adults: '2', children: '0', type: 'DLX', plan: 'BAR', first: 'Ishaan', last: 'Roy', email: 'ishaan.roy@example.com', phone: '+91 98311 44556', nationality: 'IN', terms: 'on' }), ['extra', 'airport'], ['extra', 'extra-bed']],
    });
    assert.equal(r.status, 303);
    const b = one("SELECT r.* FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE g.email = 'ishaan.roy@example.com'");
    const shown = base + (150000 + 7500) + (200000 + 10000); // what site.js adds up for the ticked extras
    assert.equal(b.total_cents, shown);
  });
});

describe('extras at a hotel without GST', () => {
  let hotel;
  before(async () => { hotel = await startHotel(); }); // the demo hotel charges a flat sales tax on rooms only
  after(() => hotel.stop());

  test('stay untaxed, and the extras form has no GST field', async () => {
    const admin = hotel.client();
    await admin.login();
    assert.doesNotMatch((await admin.get('/admin/rates')).text, /name="gst_kind"/);
    await admin.get('/reservations');
    const code = hotel.db.get('SELECT code FROM extras WHERE active = 1 ORDER BY id LIMIT 1').code;
    const r = await admin.api('/reservations', {
      arrival: '2026-11-02', departure: '2026-11-04', type: hotel.db.get('SELECT code FROM room_types WHERE active = 1 ORDER BY id LIMIT 1').code, adults: '1', children: '0', plan: 'BAR',
      first: 'Nora', last: 'Quinn', email: 'nora.quinn@example.com', phone: '', extra: [code],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const b = hotel.db.get('SELECT * FROM reservations WHERE confirmation = ?', r.body.booking.confirmation);
    assert.equal(b.tax_cents, Math.round(b.room_total_cents * 0.1749));
    assert.equal(hotel.db.get('SELECT SUM(tax_cents) AS n FROM reservation_extras WHERE reservation_id = ?', b.id).n, 0);
  });
});
