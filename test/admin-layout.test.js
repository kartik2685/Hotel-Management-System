'use strict';
/* The admin pages that were rebuilt (payments, website) share one layout: a compact row of
   filters or totals at the top, then cards paired in columns instead of one long stack. */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startHotel } = require('./helpers');

const css = fs.readFileSync(path.join(__dirname, '..', 'assets/css/pages/admin.css'), 'utf8');

function slice(html, start, end) {
  const at = html.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  return html.slice(at, html.indexOf(end, at));
}

describe('admin page layout', () => {
  test('payments: filters on one row, totals as tiles, report and settings paired in columns', async () => {
    const hotel = await startHotel();
    try {
      const owner = hotel.client();
      await owner.login();
      const page = await owner.get('/admin/payments');
      assert.equal(page.status, 200);

      // every filter sits in the compact filter grid, not in a one-field-per-row form grid
      const filters = slice(page.text, '<form class="card pay-filters"', '</form>');
      assert.equal((filters.match(/pay-filters__field/g) || []).length, 5);
      assert.equal(filters.includes('form-grid__col'), false);
      assert.match(filters, /name="from"/);
      assert.match(filters, /name="to"/);
      assert.match(filters, /name="shift"/);
      assert.match(filters, /name="staff"/);
      assert.match(filters, /name="method"/);

      // the four totals are cards, not a plain definition list
      const stats = slice(page.text, '<div class="admin-cards pay-stats">', '</div>\n\n<div class="pay-group">');
      assert.equal((stats.match(/class="card admin-card"/g) || []).length, 4);
      for (const label of ['transactions in this period', 'collected from guests', 'refunded', 'net payments']) {
        assert.match(stats, new RegExp(label));
      }

      // report first, then payment settings, then reconciliation
      const shifts = page.text.indexOf('Shift report');
      const how = page.text.indexOf('How guests pay');
      const reconcile = page.text.indexOf('Reconciliation history');
      assert.ok(shifts > -1 && how > shifts && reconcile > how);

      // transactions on the left, by-staff and by-method cards stacked on the right
      const report = slice(page.text, '<div class="admin-grid">', '<div class="pay-group">');
      assert.match(report, /id="p-transactions"/);
      assert.match(report, /id="p-by-staff"/);
      assert.match(report, /id="p-by-method"/);
      assert.equal((report.match(/class="admin-stack"/g) || []).length, 1);

      // settings and history are two-column splits, not five full-width cards
      assert.equal((page.text.match(/class="pay-split"/g) || []).length, 2);
      const pay = slice(page.text, 'How guests pay', 'Reconciliation history');
      assert.equal((pay.match(/<section class="card"/g) || []).length, 2);
      assert.match(pay, /id="p-youpi"/);
      assert.match(pay, /id="p-upi"/);
      assert.match(pay, /name="upi_id"/);
      assert.match(pay, /name="upi_qr_upload"/);

      // the long settlement instructions are tucked into one collapsible card
      assert.match(page.text, /<details class="card pay-details">/);
      assert.match(page.text, /Bank settlement, UPI and QR/);
      assert.match(page.text, /This adapter is test-only/);
    } finally { await hotel.stop(); }
  });

  test('payments: filtering by staff and shift still narrows the totals', async () => {
    const hotel = await startHotel();
    try {
      const owner = hotel.client();
      await owner.login();
      const all = await owner.get('/admin/payments');
      const someone = hotel.db.get("SELECT taken_by_name AS name FROM payments WHERE taken_by_name <> '' LIMIT 1");
      const filtered = await owner.get(`/admin/payments?staff=${encodeURIComponent(someone.name)}`);
      assert.equal(filtered.status, 200);
      assert.match(filtered.text, new RegExp(someone.name));
      // a by-method card appears with the methods in the report
      assert.match(filtered.text, /By payment method/);
      assert.notEqual(all.text, filtered.text);
    } finally { await hotel.stop(); }
  });

  test('website: the same tiles-on-top layout and jump links into each part of the page', async () => {
    const hotel = await startHotel();
    try {
      const owner = hotel.client();
      await owner.login();
      const page = await owner.get('/admin/website');
      assert.equal(page.status, 200);
      const stats = slice(page.text, '<div class="admin-cards site-stats">', '<div class="admin-grid">');
      assert.equal((stats.match(/class="card admin-card"/g) || []).length, 4);
      for (const href of ['href="#site-text"', 'href="#photos"', 'href="#rooms"']) {
        assert.match(stats, new RegExp(href));
      }
      assert.match(stats, /website is open to guests/);
      assert.match(page.text, /<details class="card site-preview" id="preview">/);
    } finally { await hotel.stop(); }
  });

  test('the paired layouts are real two-column grids on desktop and stack on phones', () => {
    const split = slice(css, '.pay-split {', '}');
    assert.match(split, /display: grid/);
    assert.match(css, /@media \(min-width: 980px\) \{ \.pay-split \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
    const filters = slice(css, '.pay-filters {', '}');
    assert.match(filters, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /@media \(min-width: 1400px\) \{\s*\.pay-filters \{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\) auto; \}/);
  });
});
