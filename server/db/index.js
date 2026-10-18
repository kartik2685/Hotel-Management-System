'use strict';
/* SQLite connection (Node's built-in node:sqlite) with small query helpers. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return wrap(db);
}

function wrap(db) {
  const cache = new Map();
  const prepare = (sql) => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };
  let depth = 0;
  return {
    raw: db,
    all: (sql, ...params) => prepare(sql).all(...params),
    get: (sql, ...params) => prepare(sql).get(...params),
    run: (sql, ...params) => prepare(sql).run(...params),
    exec: (sql) => db.exec(sql),
    /* Runs fn inside a transaction (nested calls use savepoints). */
    tx(fn) {
      const name = 'sp' + depth;
      db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
      depth += 1;
      try {
        const result = fn();
        depth -= 1;
        db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
        return result;
      } catch (error) {
        depth -= 1;
        db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw error;
      }
    },
    close: () => db.close(),
  };
}

module.exports = { open };
