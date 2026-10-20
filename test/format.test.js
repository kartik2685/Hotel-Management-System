'use strict';
/* Shared formatting (server/lib/format.js): real calendar dates only, money split the way the locale writes it,
   and amounts typed in that same locale read back at the right size. */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const f = require('../server/lib/format');

describe('dates and money', () => {
  test('a date that is not on the calendar is not a date', () => {
    assert.equal(f.isDate('2026-09-24'), true);
    assert.equal(f.isDate('2024-02-29'), true, 'a leap day exists');
    for (const bad of ['2026-02-30', '2026-11-31', '2025-02-29', '2026-13-01', '2026-9-4', '24-09-2026', 'today', '', null, undefined]) {
      assert.equal(f.isDate(bad), false, String(bad));
    }
  });

  test('money splits at the decimal mark of the hotel’s number format', () => {
    try {
      f.setCurrency('€', 'de-DE');
      assert.equal(f.money(123456), '€1.234,56');
      assert.deepEqual(f.moneyParts(123456), ['€1.234', ',56']);
      f.setCurrency('₹', 'en-IN');
      assert.equal(f.money(123456), '₹1,234.56');
      assert.deepEqual(f.moneyParts(123456), ['₹1,234', '.56']);
      assert.deepEqual(f.moneyParts(-123456), ['-₹1,234', '.56']);
    } finally {
      f.setCurrency('$', 'en-US');
    }
  });

  test('money typed in the hotel’s own format reads at the right size', () => {
    try {
      f.setCurrency('$', 'en-US');
      assert.equal(f.parseMoney('1,234.50'), 123450);
      assert.equal(f.parseMoney('$ 1,234.50'), 123450);
      assert.equal(f.parseMoney('1234.5'), 123450);
      assert.equal(f.parseMoney('1,234,567'), 123456700);
      assert.equal(f.parseMoney('₹1,23,456.78'), 12345678, 'Indian grouping copied from the page still reads');
      assert.equal(f.parseMoney('1,234.567'), null, 'three decimals are not money');
      assert.equal(f.parseMoney('1.234'), null, 'in en-US a dot is the decimal point, not a thousands mark');

      f.setCurrency('€', 'de-DE');
      assert.equal(f.parseMoney('1.234,56'), 123456);
      assert.equal(f.parseMoney('1234,56'), 123456, 'a comma decimal is not a thousands separator');
      assert.equal(f.parseMoney('1.234'), 123400, 'in de-DE a dot groups thousands');
      assert.equal(f.parseMoney('1.234.567'), 123456700);
      assert.equal(f.parseMoney('1234.567'), null);

      // a guest typing the other convention still gets the amount they meant
      f.setCurrency('₹', 'en-IN');
      assert.equal(f.parseMoney('12,5'), 1250);
      assert.equal(f.parseMoney('1.234,56'), 123456);

      assert.equal(f.parseMoney('-100'), -10000);
      for (const bad of ['', 'abc', '1.2.3', '12.345.6789', '1,23,45', '12,3456', '1,23,4,567', ',5', '.5']) assert.equal(f.parseMoney(bad), null, String(bad));
    } finally {
      f.setCurrency('$', 'en-US');
    }
  });
});
