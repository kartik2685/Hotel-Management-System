'use strict';
/*
 * SQL helpers the queries use on both databases. PostgreSQL gets them from schema.pg.sql;
 * SQLite gets these JavaScript versions when the database is opened (index.js).
 */

/* leading_int('101') = 101, leading_int('12B') = 12, leading_int('PH-1') = 0, leading_int(NULL) = NULL.
   Sorts room numbers like numbers without failing on letters. */
function leadingInt(value) {
  if (value === null || value === undefined) return null;
  const match = /^\s*([+-]?\d+)/.exec(String(value));
  return match ? Number(match[1]) : 0;
}

/* days_between('2026-09-24', '2026-09-27') = 3 (dates are 'YYYY-MM-DD'). */
function daysBetween(first, last) {
  if (first === null || first === undefined || last === null || last === undefined) return null;
  const day = (text) => Date.parse(`${String(text).slice(0, 10)}T00:00:00Z`);
  const days = Math.round((day(last) - day(first)) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

/* Registers the helpers on a node:sqlite DatabaseSync. */
function register(db) {
  db.function('leading_int', { deterministic: true }, leadingInt);
  db.function('days_between', { deterministic: true }, daysBetween);
}

module.exports = { register, leadingInt, daysBetween };
