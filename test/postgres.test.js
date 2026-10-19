'use strict';
/* PostgreSQL support (Supabase): the same tables and answers as SQLite. Runs on an embedded Postgres (PGlite),
   so no server is needed. The whole suite can also run on Postgres: npm run test:pg */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { open, openWhenReady } = require('../server/db');
const postgres = require('../server/db/postgres');
const functions = require('../server/db/functions');
const TABLES = require('../server/db/tables');
const seed = require('../server/db/seed');
const settingsService = require('../server/services/settings');
const { copyAll } = require('../server/db/copy');

describe('connecting', () => {
  test('? placeholders become $1, $2… but not inside quotes or comments', () => {
    assert.equal(postgres.positional('SELECT * FROM t WHERE a = ? AND b IN (?, ?)'), 'SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)');
    assert.equal(postgres.positional("SELECT 'what?', \"odd?col\" FROM t WHERE x = ? -- why?\nAND y = ?"), "SELECT 'what?', \"odd?col\" FROM t WHERE x = $1 -- why?\nAND y = $2");
    assert.equal(postgres.positional("SELECT 'it''s ?' AS s, ?"), "SELECT 'it''s ?' AS s, $1");
  });

  test('Supabase connection strings: encrypted, without failing on the certificate', () => {
    const pooler = 'postgresql://postgres.abcdefghijklmnop:s3cret@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';
    assert.deepEqual(postgres.connectionConfig(pooler), { connectionString: pooler, ssl: { rejectUnauthorized: false } });
    const required = postgres.connectionConfig(`${pooler}?sslmode=require`);
    assert.equal(required.connectionString, pooler); // sslmode is handled here, not by the driver
    assert.deepEqual(required.ssl, { rejectUnauthorized: false });
    assert.deepEqual(postgres.connectionConfig(`${pooler}?sslmode=verify-full`).ssl, { rejectUnauthorized: true });
    assert.equal(postgres.connectionConfig(`${pooler}?sslmode=disable`).ssl, false);
    assert.equal(postgres.connectionConfig('postgres://me:pw@localhost:5432/hotel').ssl, false);
    assert.throws(() => postgres.connectionConfig('postgresql://postgres.abc:[YOUR-PASSWORD]@aws-1-x.pooler.supabase.com:5432/postgres'), /placeholder/);
  });

  test('logs name the database but never the password', () => {
    const label = postgres.describe('postgresql://postgres.abc:Very-Secret-1@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres');
    assert.equal(label, 'PostgreSQL on aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres');
    assert.doesNotMatch(label, /Secret/);
  });

  test('connection problems come with what to do about them', () => {
    assert.match(postgres.hintFor({ code: 'ENETUNREACH' }), /Session pooler/);
    assert.match(postgres.hintFor({ code: '28P01', message: 'password authentication failed for user "postgres"' }), /Reset database password/);
    assert.match(postgres.hintFor({ code: 'XX000', message: 'Tenant or user not found' }), /postgres\.<project-ref>/);
    assert.match(postgres.hintFor({ code: 'ENOTFOUND' }), /host name was not found/);
    // Render's private address used from outside Render (e.g. npm run backup on a laptop)
    assert.match(postgres.hintFor({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND dpg-d3k9abc123def4567890-a' }), /External Database URL/);
    assert.match(postgres.hintFor({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND dpg-d3k9abc123def4567890-a.singapore-postgres.render.com' }), /host name was not found/);
    assert.match(postgres.hintFor({ code: 'ETIMEDOUT' }), /free Render database stops 30 days/);
    assert.equal(postgres.hintFor({ code: '23505', message: 'duplicate key' }), null);
  });

  test('Render’s own database: the private address render.yaml connects is encrypted too', () => {
    const config = postgres.connectionConfig('postgresql://frontdesk:Abc123xyz@dpg-d3k9abc123def4567890-a:5432/frontdesk');
    assert.deepEqual(config.ssl, { rejectUnauthorized: false }); // Render's private network offers TLS with its own certificate
    assert.equal(postgres.describe('postgresql://frontdesk:Abc123xyz@dpg-d3k9abc123def4567890-a:5432/frontdesk'), 'PostgreSQL on dpg-d3k9abc123def4567890-a:5432/frontdesk');
  });

  test('a database that is still starting is tried again; a wrong setting fails at once', async () => {
    const lines = [];
    const log = (line) => lines.push(line);
    await assert.rejects(openWhenReady('postgresql://u:p@127.0.0.1:1/db', { attempts: 3, waitMs: 5, log }),
      (error) => error.connecting === true && error.code === 'ECONNREFUSED');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^The database is not answering yet \(ECONNREFUSED\); trying again in 0 seconds \(attempt 2 of 3\)\.$/);
    lines.length = 0;
    await assert.rejects(openWhenReady('postgresql://u:[YOUR-PASSWORD]@127.0.0.1:1/db', { attempts: 3, waitMs: 5, log }), /placeholder/);
    assert.equal(lines.length, 0); // nothing to wait for
  });
});

describe('PostgreSQL database', () => {
  let pg;
  let lite;
  before(async () => {
    pg = open('pglite:memory');
    lite = open(':memory:');
    settingsService.reset();
    await seed.loadDemo(lite, { password: 'harlow-demo' });
    settingsService.reset();
  });
  after(() => {
    pg.close();
    lite.close();
  });

  test('has the same tables and columns as SQLite, at the same version', () => {
    const sqliteTables = lite.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
    const pgTables = pg.all("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY name").map((r) => r.name);
    assert.deepEqual(sqliteTables, [...TABLES].sort(), 'server/db/tables.js lists every SQLite table');
    assert.deepEqual(pgTables, ['app_meta', ...TABLES].sort(), 'server/db/tables.js lists every Postgres table');
    for (const table of TABLES) {
      const a = lite.all(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).map((r) => r.name);
      const b = pg.all('SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position', table).map((r) => r.name);
      assert.deepEqual(b, a, `columns of ${table}`);
    }
    const sqliteVersion = lite.get('PRAGMA user_version').user_version;
    const pgVersion = Number(pg.get("SELECT value FROM app_meta WHERE key = 'schema_version'").value);
    assert.equal(pgVersion, sqliteVersion, 'every SQLite migration needs a twin in server/db/migrations/pg/');
  });

  test('keeps every row away from the Supabase Data API (row level security on)', () => {
    const open = pg.all("SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = current_schema()::regnamespace AND NOT relrowsecurity");
    assert.deepEqual(open, []);
  });

  test('setting up the tables again changes nothing', () => {
    pg.exec(fs.readFileSync(path.join(__dirname, '..', 'server', 'db', 'schema.pg.sql'), 'utf8'));
    assert.equal(pg.get("SELECT value FROM app_meta WHERE key = 'schema_version'").value, '5');
  });

  test('the SQL helpers answer the same on both databases', () => {
    for (const value of ['101', '12B', 'PH-1', ' 7', '', null]) {
      const a = lite.get('SELECT leading_int(?) AS n', value).n;
      const b = pg.get('SELECT leading_int(?) AS n', value).n;
      assert.equal(b, a, `leading_int(${JSON.stringify(value)})`);
      assert.equal(functions.leadingInt(value), a);
    }
    assert.equal(pg.get("SELECT days_between('2026-09-24', '2026-10-02') AS n").n, 8);
    assert.equal(lite.get("SELECT days_between('2026-09-24', '2026-10-02') AS n").n, 8);
  });

  test('a SQLite hotel copies to Postgres in full, and new rows continue the ids', () => {
    const counts = copyAll(lite, pg);
    for (const table of TABLES) {
      assert.equal(pg.get(`SELECT COUNT(*) AS n FROM ${table}`).n, counts[table], table);
      assert.equal(counts[table], lite.get(`SELECT COUNT(*) AS n FROM ${table}`).n, table);
    }
    assert.ok(counts.reservations > 100 && counts.users === 9);
    const sample = (db) => db.all('SELECT confirmation, arrival, total_cents FROM reservations ORDER BY id LIMIT 5').map((r) => ({ ...r }));
    assert.deepEqual(sample(pg), sample(lite));
    const last = pg.get('SELECT MAX(id) AS n FROM guests').n;
    const id = pg.get("INSERT INTO guests (first_name, last_name, created_at) VALUES ('New', 'Guest', '2026-09-24 11:00') RETURNING id").id;
    assert.equal(id, last + 1);
    assert.throws(() => copyAll(lite, pg), /already has data/);
  });

  test('transactions: all or nothing, nested ones roll back on their own', () => {
    const name = () => pg.get("SELECT name FROM users WHERE email = 'elena.marsh@example.com'").name;
    assert.throws(() => pg.tx(() => {
      pg.run("UPDATE users SET name = 'Changed' WHERE email = 'elena.marsh@example.com'");
      throw new Error('stop');
    }), /stop/);
    assert.equal(name(), 'Elena Marsh');
    pg.tx(() => {
      pg.run("UPDATE users SET name = 'Elena M.' WHERE email = 'elena.marsh@example.com'");
      assert.throws(() => pg.tx(() => {
        pg.run("UPDATE users SET name = 'Inner' WHERE email = 'elena.marsh@example.com'");
        throw new Error('inner');
      }));
    });
    assert.equal(name(), 'Elena M.');
    assert.throws(() => pg.tx(async () => {}), /synchronous/);
  });

  test('database errors keep their Postgres code; emails are unique in any case', () => {
    assert.throws(
      () => pg.run("INSERT INTO users (name, email, password_hash, role, code, created_at) VALUES ('X', 'ELENA.MARSH@example.com', 'h', 'admin', 'xx', '2026-09-24')"),
      (error) => error.code === '23505' && /users_email/.test(error.message),
    );
    assert.equal(pg.run("UPDATE rooms SET hk_status = 'dirty' WHERE number = ?", '101').changes, 1);
  });
});
