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
  migrate(db);
  return wrap(db);
}

/* Applies db/migrations/NNN-*.sql in order. PRAGMA user_version holds the current version. */
function migrate(db) {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 0) {
    version = 1; // schema.sql is version 1
    db.exec('PRAGMA user_version = 1');
  }
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}-.*\.sql$/.test(f)).sort();
  for (const file of files) {
    const target = Number(file.slice(0, 3));
    if (target <= version) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      db.exec(`PRAGMA user_version = ${target}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${file} failed: ${error.message}`);
    }
    version = target;
  }
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
