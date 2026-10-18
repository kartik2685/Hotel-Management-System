'use strict';
/* Admin → Overview → Database: where the data is kept, and backups downloaded from the browser. */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startHotel } = require('./helpers');
const { open } = require('../server/db');
const TABLES = require('../server/db/tables');
const system = require('../server/services/system');

let hotel;
before(async () => { hotel = await startHotel(); });
after(async () => { await hotel.stop(); });

const sqlite = () => hotel.db.dialect === 'sqlite';
// Rows as sorted JSON, so engines that list columns in another order still compare equal.
const rows = (db, table) => db.all(`SELECT * FROM ${table}`).map((r) => JSON.stringify(Object.entries({ ...r }).sort())).sort();
const leftovers = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`hms-backup-${process.pid}-`));

describe('database card', () => {
  test('admins see which database the hotel runs on; managers do not', async () => {
    const admin = hotel.client();
    await admin.login();
    const page = await admin.get('/admin');
    assert.equal(page.status, 200);
    assert.match(page.text, /<h2 class="card__title" id="db-title">Database<\/h2>/);
    assert.match(page.text, sqlite() ? /<p class="card__subtitle">SQLite file<\/p>/ : /<p class="card__subtitle">PostgreSQL<\/p>/);
    assert.match(page.text, sqlite() ? /<dt>Tables<\/dt><dd>25 · version 2<\/dd>/ : /<dt>Tables<\/dt><dd>26 · version 2<\/dd>/);
    assert.match(page.text, /<dt>Size<\/dt><dd>[\d.]+ (KB|MB)<\/dd>/);
    assert.equal(/<dt>Round trip<\/dt>/.test(page.text), !sqlite()); // only a database server has a network round trip
    assert.match(page.text, /<dt>Last backup<\/dt><dd>none yet<\/dd>/);
    assert.match(page.text, /<form class="form-actions" method="post" action="\/admin\/backup">/);
    assert.doesNotMatch(page.text, /temporary file/);

    const manager = hotel.client();
    await manager.login('gus.palmer@example.com');
    const other = await manager.get('/admin');
    assert.equal(other.status, 200);
    assert.doesNotMatch(other.text, /db-title|\/admin\/backup/);
  });

  test('on Render without DATABASE_URL it warns that the file is temporary', async () => {
    const admin = hotel.client();
    await admin.login();
    process.env.RENDER = 'true';
    try {
      const page = await admin.get('/admin');
      assert.equal(/The data is in a temporary file\./.test(page.text), sqlite());
    } finally {
      delete process.env.RENDER;
    }
    // The same check prints a warning when the server starts (server/index.js).
    const fake = (dialect) => ({ dialect });
    assert.equal(system.temporaryFile(fake('sqlite'), { RENDER: 'true' }), true);
    assert.equal(system.temporaryFile(fake('sqlite'), { RENDER: 'true', DB_PATH: '/var/data/frontdesk.db' }), false); // a paid disk
    assert.equal(system.temporaryFile(fake('postgres'), { RENDER: 'true' }), false);
    assert.equal(system.temporaryFile(fake('sqlite'), {}), false);
  });

  test('Supabase connections are recognised, with their region', () => {
    assert.deepEqual(system.postgresHost('PostgreSQL on aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'),
      { host: 'aws-1-ap-southeast-1.pooler.supabase.com', supabase: true, region: 'Singapore' });
    assert.deepEqual(system.postgresHost('PostgreSQL on aws-0-ap-south-1.pooler.supabase.com:5432/postgres'),
      { host: 'aws-0-ap-south-1.pooler.supabase.com', supabase: true, region: 'Mumbai' });
    assert.deepEqual(system.postgresHost('PostgreSQL on aws-0-xx-newplace-9.pooler.supabase.com:6543/postgres').region, 'xx-newplace-9');
    assert.deepEqual(system.postgresHost('PostgreSQL on db.abcdefghijklmnop.supabase.co:5432/postgres'),
      { host: 'db.abcdefghijklmnop.supabase.co', supabase: true, region: null });
    assert.deepEqual(system.postgresHost('PostgreSQL on 127.0.0.1:54329/postgres'), { host: '127.0.0.1', supabase: false, region: null });
    assert.deepEqual(system.postgresHost('PostgreSQL (embedded, in memory)'), { host: null, supabase: false, region: null });
    assert.equal(system.sizeText(300), '1 KB');
    assert.equal(system.sizeText(9.6 * 1024 * 1024), '9.6 MB');
    assert.equal(system.sizeText(1.5 * 1024 ** 3), '1.50 GB');
  });
});

describe('backups', () => {
  test('a backup downloads as one SQLite file with every row, and is logged', async () => {
    const admin = hotel.client();
    await admin.login();
    await admin.get('/admin');
    const r = await admin.request('POST', '/admin/backup', { form: { _csrf: admin.csrf }, binary: true });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="?frontdesk-backup-2026-09-24-1042\.db"?$/);
    assert.equal(r.headers.get('content-type'), 'application/vnd.sqlite3');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.body.subarray(0, 16).toString('latin1'), 'SQLite format 3\0');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-restore-'));
    const file = path.join(dir, 'backup.db');
    fs.writeFileSync(file, r.body);
    const copy = open(file); // the app opens a backup as it is
    try {
      for (const table of TABLES) {
        const live = rows(hotel.db, table);
        const saved = rows(copy, table);
        if (table === 'activity_log') {
          assert.equal(live.length, saved.length + 1); // + the backup itself
          continue;
        }
        assert.deepEqual(saved, live, table);
      }
      assert.ok(copy.get('SELECT COUNT(*) AS n FROM reservations').n > 40);
    } finally {
      copy.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const page = await admin.get('/admin');
    assert.match(page.text, /<dt>Last backup<\/dt><dd>2026-09-24 10:42 · Elena Marsh<\/dd>/);
    assert.equal(hotel.db.get('SELECT summary FROM activity_log ORDER BY id DESC LIMIT 1').summary, 'Downloaded a backup of the database');
    for (let i = 0; i < 20 && leftovers().length; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(leftovers(), []); // the temporary file is gone
  });

  test('only an admin, with the page’s form token, gets a backup', async () => {
    const admin = hotel.client();
    await admin.login();
    await admin.get('/admin');
    const forged = await admin.request('POST', '/admin/backup', { form: { _csrf: 'forged' } });
    assert.equal(forged.status, 403);

    const manager = hotel.client();
    await manager.login('gus.palmer@example.com');
    await manager.get('/admin');
    assert.equal((await manager.post('/admin/backup')).status, 403);

    const desk = hotel.client();
    await desk.login('rosa.soto@example.com');
    await desk.get('/dashboard');
    assert.equal((await desk.post('/admin/backup')).status, 403);

    const nobody = await hotel.client().request('POST', '/admin/backup', { form: {} });
    assert.equal(nobody.status, 302); // to the sign-in page
  });
});
