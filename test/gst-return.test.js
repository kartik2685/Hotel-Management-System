'use strict';
/* GST returns (services/gst-return.js): GSTR-1 for a month from the invoices issued, adding up to them, with
   CSV files in the GST offline tool's format. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const sample = require('../server/db/sample');
const gstReturn = require('../server/services/gst-return');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];
const STAFF = 'Staff-Test-2026';
const MONTH = '2026-09'; // the test clock reads 24 Sep 2026: the sample's first weeks

describe('GST returns', () => {
  let hotel;
  let manager;
  const issued = () => hotel.db.all("SELECT number, status, data FROM invoices WHERE status <> 'cancelled'").map((r) => ({ ...r, d: JSON.parse(r.data) })).filter((r) => r.d.date.startsWith(MONTH));

  before(async () => {
    hotel = await startHotel({
      load: async (db) => {
        await seed.createEmptyHotel(db, { email: OWNER[0], name: 'Hotel Owner', password: OWNER[1] });
        await sample.add(db, { password: STAFF });
      },
    });
    manager = hotel.client();
    await manager.login('sneha.banerjee@hooghlyresidency.example.com', STAFF);
  });
  after(() => hotel.stop());

  test('managers see the month: B2B invoices, tax by rate, files and documents issued; the front desk does not', async () => {
    const page = await manager.get(`/admin/gst-return?month=${MONTH}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /href="\/admin\/gst-return" class="[^"]*is-active|aria-current="page"[^>]*>GST returns|>GST returns</);
    assert.match(page.text, /place of supply <strong>19-West Bengal<\/strong>/);
    assert.match(page.text, /Your GSTIN <strong class="mono">19AAHCH4821K1Z5<\/strong>/);
    assert.match(page.text, /href="\/admin\/gst-return\.csv\?month=2026-09&amp;part=b2b"/);
    assert.match(page.text, /Table 13 · \d+ lines?/);
    const desk = hotel.client();
    await desk.login('priya.das@hooghlyresidency.example.com', STAFF);
    assert.equal((await desk.get('/admin/gst-return')).status, 403);
  });

  test('the return adds up to the invoices it is made from', () => {
    const r = gstReturn.build(hotel.db, MONTH);
    const invoices = issued();
    const sum = (list, key) => list.reduce((n, x) => n + x[key], 0);
    assert.ok(invoices.length > 0);
    assert.equal(r.totals.b2b.taxable + r.totals.b2c.taxable, invoices.reduce((n, x) => n + x.d.taxable, 0));
    assert.equal(r.totals.b2b.tax + r.totals.b2c.tax, invoices.reduce((n, x) => n + x.d.tax, 0));
    assert.equal(r.totals.b2b.invoices, invoices.filter((x) => x.d.billTo.gstin).length);
    assert.equal(sum(r.b2b, 'taxable'), r.totals.b2b.taxable);
    assert.equal(sum(r.b2cs, 'taxable') + sum(r.b2cl, 'taxable'), r.totals.b2c.taxable);
    assert.equal(sum(r.hsn, 'taxable'), r.totals.b2b.taxable + r.totals.b2c.taxable);
    assert.equal(sum(r.byRate, 'cgst') + sum(r.byRate, 'sgst') + sum(r.byRate, 'igst'), r.totals.b2b.tax + r.totals.b2c.tax);
    assert.ok(r.b2b.every((x) => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(x.gstin) && x.pos === '19-West Bengal'));
    const all = hotel.db.all('SELECT data, status FROM invoices').filter((x) => JSON.parse(x.data).date.startsWith(MONTH));
    assert.deepEqual(r.docs.map((x) => [x.total, x.cancelled]), [[all.length, all.filter((x) => x.status === 'cancelled').length]]);
  });

  test('an invoice with room service shows the room at 5% and the food at 18%, in B2B and in the SAC summary', () => {
    const r = gstReturn.build(hotel.db, MONTH);
    const twoRates = Object.entries(r.b2b.reduce((m, x) => ({ ...m, [x.number]: [...(m[x.number] || []), x.rate] }), {})).find(([, rates]) => rates.length > 1);
    assert.ok(twoRates, 'a B2B invoice with two rates');
    assert.deepEqual(twoRates[1].sort((a, b) => a - b), [5, 18]);
    assert.ok(r.hsn.some((x) => x.section === 'B2B' && x.sac === '996331' && x.rate === 18));
    assert.ok(r.hsn.some((x) => x.sac === '996311' && x.description === 'Accommodation services'));
  });

  test('CSV files carry the offline tool’s columns, its date format and amounts with two decimals', async () => {
    const b2b = await manager.get(`/admin/gst-return.csv?month=${MONTH}&part=b2b`);
    assert.equal(b2b.status, 200);
    assert.match(b2b.headers.get('content-type'), /^text\/csv/);
    assert.match(b2b.headers.get('content-disposition'), /filename="gstr1-2026-09-b2b\.csv"/);
    const [header, first] = b2b.text.replace(/^\uFEFF/, '').split('\r\n');
    assert.equal(header, 'GSTIN/UIN of Recipient,Receiver Name,Invoice Number,Invoice date,Invoice Value,Place Of Supply,Reverse Charge,Applicable % of Tax Rate,Invoice Type,E-Commerce GSTIN,Rate,Taxable Value,Cess Amount');
    assert.match(first, /^\d{2}[A-Z]{5}\d{4}[A-Z]\w{3},[^,]+,INV\/26-27\/\d{4},\d{2}-Sep-2026,\d+\.\d\d,19-West Bengal,N,,Regular B2B,,(5|18),\d+\.\d\d,0\.00$/);
    const docs = (await manager.get(`/admin/gst-return.csv?month=${MONTH}&part=docs`)).text.replace(/^\uFEFF/, '').split('\r\n');
    assert.equal(docs[0], 'Nature of Document,Sr. No. From,Sr. No. To,Total Number,Cancelled');
    const r = gstReturn.build(hotel.db, MONTH); // the series of the month: its first and last number
    assert.equal(docs[1], `Invoices for outward supply,${r.docs[0].first},${r.docs[0].last},${r.docs[0].total},${r.docs[0].cancelled}`);
    assert.match(docs[1], /^Invoices for outward supply,INV\/26-27\/\d{4},INV\/26-27\/\d{4},\d+,\d+$/);
    const hsn = (await manager.get(`/admin/gst-return.csv?month=${MONTH}&part=hsn`)).text;
    assert.match(hsn, /\r\nB2B,996311,Accommodation services,NA,0,\d+\.\d\d,5,\d+\.\d\d,0\.00,\d+\.\d\d,\d+\.\d\d,0\.00/);
    assert.equal((await manager.get(`/admin/gst-return.csv?month=${MONTH}&part=everything`)).status, 404);
  });

  test('a month without invoices says so', async () => {
    const page = await manager.get('/admin/gst-return?month=2026-01');
    assert.match(page.text, /No invoice was billed to a GSTIN in Jan 2026\./);
    assert.match(page.text, /No GST invoice was issued in Jan 2026\./);
  });
});

describe('GST returns at a hotel without GST', () => {
  let hotel;
  before(async () => { hotel = await startHotel(); }); // the demo hotel charges a flat sales tax
  after(() => hotel.stop());

  test('there is no GST returns page or tab', async () => {
    const admin = hotel.client();
    await admin.login();
    assert.equal((await admin.get('/admin/gst-return')).status, 404);
    assert.doesNotMatch((await admin.get('/admin/reports')).text, /GST returns/);
  });
});
