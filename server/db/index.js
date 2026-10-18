'use strict';
/*
 * Database connection: one small synchronous API (db.get / db.all / db.run / db.exec / db.tx) on two engines.
 *   - SQLite (Node's built-in node:sqlite): a single file, used by default (DB_PATH).
 *   - PostgreSQL, e.g. Supabase: used when DATABASE_URL is set (see postgres.js).
 * Queries are written once, in SQL both understand. db.dialect is 'sqlite' or 'postgres'.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const functions = require('./functions');

const isPostgres = (target) => /^(postgres(ql)?|pglite):/i.test(String(target || ''));

/* target: a SQLite file path (or ':memory:'), or a postgres://… connection string. */
function open(target) {
  if (isPostgres(target)) return require('./postgres').open(target);
  return openSqlite(target);
}

function openSqlite(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  functions.register(db);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);
  return wrap(db, file === ':memory:' ? 'SQLite (in memory)' : `SQLite file ${file}`);
}

/* Applies db/migrations/NNN-*.sql in order. PRAGMA user_version holds the current version.
   Every migration needs a PostgreSQL twin in db/migrations/pg/ with the same number. */
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

function wrap(db, label) {
  const cache = new Map();
  const prepare = (sql) => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };
  return {
    dialect: 'sqlite',
    label,
    raw: db,
    all: (sql, ...params) => prepare(sql).all(...params),
    get: (sql, ...params) => prepare(sql).get(...params),
    run: (sql, ...params) => prepare(sql).run(...params),
    exec: (sql) => db.exec(sql),
    tx: transaction({ begin: 'BEGIN IMMEDIATE', exec: (sql) => db.exec(sql) }),
    close: () => db.close(),
  };
}

/* db.tx(fn): runs fn inside a transaction; nested calls use savepoints. fn must be synchronous —
   everything it does commits together, or nothing does if it throws. Shared with postgres.js. */
function transaction({ begin, exec }) {
  let depth = 0;
  return function tx(fn) {
    const name = 'sp' + depth;
    exec(depth === 0 ? begin : `SAVEPOINT ${name}`);
    depth += 1;
    let result;
    try {
      result = fn();
      if (result && typeof result.then === 'function') throw new TypeError('db.tx() needs a synchronous function.');
    } catch (error) {
      depth -= 1;
      try {
        exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
      } catch {
        // The connection is gone; the database rolls the transaction back by itself.
      }
      throw error;
    }
    depth -= 1;
    try {
      exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${name}`);
    } catch (error) {
      if (depth === 0) {
        try {
          exec('ROLLBACK'); // a failed COMMIT must not leave the transaction open
        } catch {
          // already over
        }
      }
      throw error;
    }
    return result;
  };
}

module.exports = { open, isPostgres, transaction };
