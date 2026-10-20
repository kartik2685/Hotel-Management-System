'use strict';
/* Charges during the stay (services/folio.js): posted by the front desk with their own tax rate, part of the
   bill and the balance, listed on the GST invoice with SAC codes and tax per rate, taken off by managers only. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const sample = require('../server/db/sample');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];
const STAFF = 'Staff-Test-2026';

describe('charges during the stay', () => {
  let hotel;
  let desk;
  let manager;
  let stay; // a guest in house
  const one = (sql, ...args) => hotel.db.get(sql, ...args);
  const booking = () => one('SELECT * FROM reservations WHERE confirmation = ?', stay);

  before(async () => {
    hotel = await startHotel({
      load: async (db) => {
        await seed.createEmptyHotel(db, { email: OWNER[0], name: 'Hotel Owner', password: OWNER[1] });
        await sample.add(db, { password: STAFF });
      },
    });
    desk = hotel.client();
    await desk.login('priya.das@hooghlyresidency.example.com', STAFF);
    manager = hotel.client();
    await manager.login('sneha.banerjee@hooghlyresidency.example.com', STAFF);
    // a guest in house with no sample charges yet, in a room up to ₹7,500 (so the room's 5% GST is a line of its own)
    stay = one(`SELECT confirmation FROM reservations r WHERE status = 'checked_in' AND departure > '2026-09-25' AND nightly_rate_cents <= 750000
                  AND NOT EXISTS (SELECT 1 FROM folio_charges f WHERE f.reservation_id = r.id) ORDER BY id LIMIT 1`).confirmation;
  });
  after(() => hotel.stop());

  test('the front desk adds laundry to the bill: total, balance and the booking page include it', async () => {
    const before = booking();
    await desk.get(`/reservations/${stay}`);
    const r = await desk.post(`/reservations/${stay}/charges`, { charge_kind: 'laundry', charge_amount: '450', charge_text: 'Laundry: 3 shirts, 1 trouser' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `/reservations/${stay}?ok=charge#charges`);
    const c = one('SELECT * FROM folio_charges WHERE reservation_id = ? ORDER BY id DESC', before.id);
    assert.deepEqual([c.amount_cents, c.tax_bp, c.tax_cents, c.sac, c.posted_by_name], [45000, 1800, 8100, '999719', 'Priya Das']);
    const after = booking();
    assert.equal(after.charges_cents, before.charges_cents + 53100);
    assert.equal(after.total_cents, before.total_cents + 53100);
    const page = (await desk.get(r.headers.get('location'))).text;
    assert.match(page, /Charge added to the bill\./);
    assert.match(page, /<dt>Charges during the stay<\/dt><dd>₹531\.00<\/dd>/);
    assert.match(page, /<strong>₹531\.00<\/strong> · Laundry: 3 shirts, 1 trouser/);
    assert.match(page, /Laundry · ₹450\.00 \+ GST 18% · /);
  });

  test('food is 18% at a hotel with rooms above ₹7,500 (5% otherwise); staff can pick another listed rate', async () => {
    await desk.get(`/reservations/${stay}`);
    await desk.post(`/reservations/${stay}/charges`, { charge_kind: 'fnb', charge_amount: '1200', charge_text: 'Dinner from room service' });
    assert.equal(one('SELECT tax_bp FROM folio_charges ORDER BY id DESC').tax_bp, 1800);
    await desk.post(`/reservations/${stay}/charges`, { charge_kind: 'transport', charge_amount: '900', charge_text: 'Taxi to the airport', charge_rate: '5' });
    assert.equal(one('SELECT tax_cents FROM folio_charges ORDER BY id DESC').tax_cents, 4500);
    const bad = await desk.post(`/reservations/${stay}/charges`, { charge_kind: 'other', charge_amount: '100', charge_rate: '7' });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /Choose one of the tax rates in the list/);
    // without the expensive suites the same dinner is 5%
    hotel.db.run('UPDATE room_types SET active = 0 WHERE base_rate_cents > 750000');
    await desk.post(`/reservations/${stay}/charges`, { charge_kind: 'minibar', charge_amount: '200' });
    hotel.db.run('UPDATE room_types SET active = 1');
    const minibar = one('SELECT * FROM folio_charges ORDER BY id DESC');
    assert.deepEqual([minibar.tax_bp, minibar.description], [500, 'Minibar']);
  });

  test('the GST invoice lists every charge with its SAC and the tax for each rate', async () => {
    const b = booking();
    await desk.get(`/reservations/${stay}`);
    const r = await desk.post(`/reservations/${stay}/invoice`, { bill_to: '', gstin: '' });
    assert.equal(r.status, 303);
    const inv = JSON.parse(one('SELECT data FROM invoices WHERE reservation_id = ? ORDER BY id DESC', b.id).data);
    const charges = hotel.db.all('SELECT * FROM folio_charges WHERE reservation_id = ? AND voided_at IS NULL', b.id);
    assert.ok(inv.lines.some((l) => l.sac === '999719' && l.amount === 45000 && /Laundry: 3 shirts.* · 18%$/.test(l.text)));
    assert.ok(inv.lines.some((l) => l.sac === '996331' && l.amount === 120000));
    assert.equal(inv.taxable, b.room_total_cents + charges.reduce((n, c) => n + c.amount_cents, 0));
    assert.equal(inv.tax, b.tax_cents + charges.reduce((n, c) => n + c.tax_cents, 0));
    assert.equal(inv.cgst + inv.sgst, inv.tax);
    assert.equal(inv.total, b.total_cents);
    assert.ok(inv.taxes.some((t) => t.rate === 18 && t.tax === 8100 + 21600));
    const page = (await desk.get(r.headers.get('location'))).text;
    // the laundry (₹450) and the dinner (₹1,200) share the 18% line: ₹148.50 CGST and ₹148.50 SGST
    assert.match(page, /CGST 9% on ₹1,650\.00<\/td><td class="num">₹148\.50/);
    assert.match(page, /SGST 9% on ₹1,650\.00<\/td><td class="num">₹148\.50/);
    assert.match(page, /<td>Laundry: 3 shirts, 1 trouser · \w{3} \d{1,2} \w{3} · 18%<\/td><td>999719<\/td>/);
  });

  test('a manager takes a wrong charge off the bill; the front desk cannot', async () => {
    const c = one('SELECT f.* FROM folio_charges f JOIN reservations r ON r.id = f.reservation_id WHERE r.confirmation = ? AND f.kind = ? ORDER BY f.id DESC', stay, 'transport');
    const before = booking();
    await desk.get(`/reservations/${stay}`);
    assert.equal((await desk.post(`/reservations/${stay}/charges/${c.id}/void`)).status, 403);
    const page = await manager.get(`/reservations/${stay}`);
    assert.match(page.text, new RegExp(`action="/reservations/${stay}/charges/${c.id}/void"`));
    const r = await manager.post(`/reservations/${stay}/charges/${c.id}/void`);
    assert.equal(r.headers.get('location'), `/reservations/${stay}?ok=charge-void#charges`);
    assert.equal(booking().charges_cents, before.charges_cents - 94500);
    assert.equal(booking().total_cents, before.total_cents - 94500);
    assert.match((await manager.get(r.headers.get('location'))).text, /Taxi to the airport · taken off the bill/);
    const again = await manager.post(`/reservations/${stay}/charges/${c.id}/void`);
    assert.equal(again.status, 422);
    assert.match(again.text, /already taken off the bill/);
  });

  test('only guests in house take charges; editing the stay keeps them; check-out wants them paid', async () => {
    const future = one("SELECT confirmation FROM reservations WHERE status = 'confirmed' ORDER BY id LIMIT 1").confirmation;
    await desk.get(`/reservations/${future}`);
    const r = await desk.post(`/reservations/${future}/charges`, { charge_kind: 'fnb', charge_amount: '300' });
    assert.equal(r.status, 422);
    assert.match(r.text, /Charges go on the bill of a guest who is in house/);

    const b = one('SELECT r.*, g.first_name, g.last_name, g.email, g.phone, rm.number AS room FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN rooms rm ON rm.id = r.room_id WHERE r.confirmation = ?', stay);
    await desk.get(`/reservations/${stay}`);
    const later = new Date(Date.parse(b.departure) + 864e5).toISOString().slice(0, 10);
    const edit = await desk.post(`/reservations/${stay}`, {
      arrival: b.arrival, departure: later, room_type_id: String(b.room_type_id), room: b.room, adults: String(b.adults), children: String(b.children),
      rate_plan_id: b.rate_plan_id ? String(b.rate_plan_id) : '', nightly_rate: String(b.nightly_rate_cents / 100), source_id: b.source_id ? String(b.source_id) : '',
      eta: b.eta || '', first: b.first_name, last: b.last_name, email: b.email || '', phone: b.phone || '', notes: b.notes || '', requests: b.requests || '',
    });
    assert.equal(edit.status, 303, edit.text.match(/field-error">([^<]+)/)?.[1]);
    const after = booking();
    assert.equal(after.total_cents, after.room_total_cents + after.tax_cents + after.extras_cents + after.charges_cents);
    assert.ok(after.charges_cents > 0);

    if (after.total_cents > after.paid_cents) {
      await desk.get('/dashboard');
      const out = await desk.api(`/api/reservations/${stay}/check-out`);
      assert.equal(out.status, 422);
      assert.match(out.body.error, /is still open on the folio/);
    }
  });

  test('an amount typed in the hotel’s own number format is read at its real size', async () => {
    // a hotel that writes €1.234,56 (de-DE) takes "1.234,56" at the desk, not €1,23 or €123.456
    const save = (key, value) => {
      hotel.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
      require('../server/services/settings').reset();
    };
    try {
      save('currency_symbol', '€');
      save('currency_locale', 'de-DE');
      await desk.get(`/reservations/${stay}`);
      const r = await desk.post(`/reservations/${stay}/charges`, { charge_kind: 'laundry', charge_amount: '1.234,56', charge_text: 'Locale charge' });
      assert.equal(r.status, 303, r.text.match(/field-error">([^<]+)/)?.[1]);
      const c = one("SELECT * FROM folio_charges WHERE description = 'Locale charge'");
      assert.equal(c.amount_cents, 123456);
      assert.match((await desk.get(`/reservations/${stay}`)).text, /€1\.234,56/);
      // not a valid amount: three decimals after the decimal mark are refused, not silently guessed
      const bad = await desk.post(`/reservations/${stay}/charges`, { charge_kind: 'laundry', charge_amount: '12,3456', charge_text: 'Bad locale charge' });
      assert.equal(bad.status, 422);
      assert.match(bad.text, /must be a number like/);
    } finally {
      save('currency_symbol', '₹');
      save('currency_locale', 'en-IN');
    }
  });
});
