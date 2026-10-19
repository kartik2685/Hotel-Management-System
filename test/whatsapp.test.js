'use strict';
/* "WhatsApp the guest" (services/whatsapp.js): wa.me links with the guest's number and a message that fits the
   booking, and the guest's own signed copy of an invoice. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const sample = require('../server/db/sample');
const whatsapp = require('../server/services/whatsapp');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];

describe('phone numbers for WhatsApp', () => {
  test('get the country code wa.me needs', () => {
    assert.equal(whatsapp.phoneDigits('+91 98300 55667'), '919830055667');
    assert.equal(whatsapp.phoneDigits('98300 55667'), '919830055667'); // at an Indian hotel: +91
    assert.equal(whatsapp.phoneDigits('098300-55667'), '919830055667');
    assert.equal(whatsapp.phoneDigits('+33 6 45 21 88 30'), '33645218830');
    assert.equal(whatsapp.phoneDigits('0044 20 7946 0958'), '442079460958');
    assert.equal(whatsapp.phoneDigits('(415) 555-0132', 'US'), '14155550132');
    assert.equal(whatsapp.phoneDigits('030 1234 5678', 'DE'), ''); // country unknown: WhatsApp asks whom to send it to
    assert.equal(whatsapp.phoneDigits(''), '');
    assert.equal(whatsapp.phoneDigits('12345'), '');
  });
});

describe('WhatsApp the guest', () => {
  let hotel;
  let staff;
  const waLink = (html) => ((html.match(/href="(https:\/\/wa\.me\/[^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');
  const textOf = (href) => decodeURIComponent(href.split('?text=')[1]);
  const pathOf = (url) => url.replace(/^https?:\/\/[^/]+/, '');
  const one = (sql) => hotel.db.get(sql);
  const setSetting = (key, value) => {
    hotel.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
    require('../server/services/settings').reset();
  };

  before(async () => {
    hotel = await startHotel({
      load: async (db) => {
        await seed.createEmptyHotel(db, { email: OWNER[0], name: 'Hotel Owner', password: OWNER[1] });
        await sample.add(db);
      },
    });
    staff = hotel.client();
    await staff.login(...OWNER);
  });
  after(() => hotel.stop());

  test('a confirmed booking: its details, the total in rupees and the guest’s link to see or cancel it', async () => {
    const b = one(`SELECT r.confirmation, g.first_name, g.phone FROM reservations r JOIN guests g ON g.id = r.guest_id
                    WHERE r.status = 'confirmed' AND g.phone LIKE '+91%' AND g.email IS NOT NULL ORDER BY r.id LIMIT 1`);
    const href = waLink((await staff.get(`/reservations/${b.confirmation}`)).text);
    assert.ok(href.startsWith(`https://wa.me/${b.phone.replace(/\D/g, '')}?text=`), href);
    const text = textOf(href);
    assert.match(text, new RegExp(`^Hello ${b.first_name}, your booking at The Hooghly Residency is confirmed\\.`));
    assert.match(text, new RegExp(`Booking: ${b.confirmation}\\n`));
    assert.match(text, /Total: ₹[\d,]+\.\d\d/);
    assert.match(text, /Check-in from 14:00 · check-out by 11:00/);
    const manage = text.match(/See or cancel your booking: (\S+)/)[1];
    const page = await hotel.client().get(pathOf(manage)); // the guest, not signed in
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(b.confirmation));
  });

  test('a guest in house gets a welcome with their room and check-out time', async () => {
    const b = one("SELECT r.confirmation, g.first_name, rm.number FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN rooms rm ON rm.id = r.room_id WHERE r.status = 'checked_in' ORDER BY r.id LIMIT 1");
    const text = textOf(waLink((await staff.get(`/reservations/${b.confirmation}`)).text));
    assert.match(text, new RegExp(`^Welcome to The Hooghly Residency, ${b.first_name}! Your room is ${b.number} `));
    assert.match(text, /Check-out is by 11:00 on \w{3} \d{1,2} \w{3}\./);
  });

  test('after check-out: thanks, and the invoice opens for the guest without signing in', async () => {
    const b = one(`SELECT r.confirmation, i.id, i.number FROM invoices i JOIN reservations r ON r.id = i.reservation_id
                    WHERE r.status = 'checked_out' AND i.status <> 'cancelled' ORDER BY i.id DESC LIMIT 1`);
    const text = textOf(waLink((await staff.get(`/reservations/${b.confirmation}`)).text));
    assert.match(text, /^Thank you for staying at The Hooghly Residency/);
    const url = text.match(new RegExp(`Your invoice ${b.number.replace(/\//g, '\\/')} \\(₹[\\d,]+\\.\\d\\d\\): (\\S+)`))[1];
    assert.ok(pathOf(url).startsWith(`/invoice/${b.id}?t=`));

    const guest = hotel.client();
    const copy = await guest.get(pathOf(url));
    assert.equal(copy.status, 200);
    assert.match(copy.text, new RegExp(`No\\. <strong>${b.number}</strong>`));
    assert.match(copy.text, /Print or save as PDF/);
    assert.doesNotMatch(copy.text, /Back to the booking|Send on WhatsApp/);
    assert.equal((await guest.get(`/invoice/${b.id}?t=wrong-token-of-the-right-length-x`)).status, 404);
    const other = one(`SELECT id FROM invoices WHERE id <> ${b.id} ORDER BY id LIMIT 1`).id;
    assert.equal((await guest.get(`/invoice/${other}?${pathOf(url).split('?')[1]}`)).status, 404, 'a link opens its own invoice only');
    assert.equal((await guest.get(`/invoices/${b.id}`)).status, 302, 'the staff page still needs signing in');
    setSetting('site_enabled', false);
    assert.equal((await guest.get(pathOf(url))).status, 200, 'it works with the website switched off');
    setSetting('site_enabled', true);
  });

  test('the invoice page sends the same guest copy', async () => {
    const inv = one("SELECT i.id, i.number, g.phone FROM invoices i JOIN reservations r ON r.id = i.reservation_id JOIN guests g ON g.id = r.guest_id WHERE i.status <> 'cancelled' ORDER BY i.id LIMIT 1");
    const page = await staff.get(`/invoices/${inv.id}`);
    assert.match(page.text, />Send on WhatsApp</);
    const href = waLink(page.text);
    assert.ok(href.startsWith(`https://wa.me/${whatsapp.phoneDigits(inv.phone)}?text=`));
    const text = textOf(href);
    assert.match(text, new RegExp(`here is your invoice ${inv.number.replace(/\//g, '\\/')} from The Hooghly Residency for ₹`));
    assert.equal((await hotel.client().get(pathOf(text.match(/: (\S+)$/)[1]))).status, 200);
  });

  test('a cancelled booking hears it is cancelled; a no-show gets no button', async () => {
    const cancelled = one("SELECT confirmation FROM reservations WHERE status = 'cancelled' ORDER BY id LIMIT 1").confirmation;
    assert.match(textOf(waLink((await staff.get(`/reservations/${cancelled}`)).text)), new RegExp(`your booking ${cancelled} at The Hooghly Residency \\(.+\\) has been cancelled\\.`));
    const noShow = one("SELECT confirmation FROM reservations WHERE status = 'no_show' ORDER BY id LIMIT 1").confirmation;
    assert.equal(waLink((await staff.get(`/reservations/${noShow}`)).text), '');
  });
});
