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
    assert.equal(/<dt>Set up<\/dt><dd>\d{1,2} [A-Z][a-z]{2,3} \d{4}<\/dd>/.test(page.text), !sqlite()); // the day PostgreSQL was set up
    assert.doesNotMatch(page.text, /free database/); // not a Render database
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

  test('Render and Supabase databases are recognised, with their region', () => {
    const host = (label) => system.postgresHost(label);
    assert.deepEqual(host('PostgreSQL on dpg-d3k9abc123def4567890-a:5432/frontdesk'),
      { host: 'dpg-d3k9abc123def4567890-a', provider: 'render', region: null, privateNetwork: true }); // render.yaml's DATABASE_URL
    assert.deepEqual(host('PostgreSQL on dpg-d3k9abc123def4567890-a.singapore-postgres.render.com:5432/frontdesk'),
      { host: 'dpg-d3k9abc123def4567890-a.singapore-postgres.render.com', provider: 'render', region: 'Singapore', privateNetwork: false });
    assert.deepEqual(host('PostgreSQL on aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'),
      { host: 'aws-1-ap-southeast-1.pooler.supabase.com', provider: 'supabase', region: 'Singapore', privateNetwork: false });
    assert.equal(host('PostgreSQL on aws-0-ap-south-1.pooler.supabase.com:5432/postgres').region, 'Mumbai');
    assert.equal(host('PostgreSQL on aws-0-xx-newplace-9.pooler.supabase.com:6543/postgres').region, 'xx-newplace-9');
    assert.deepEqual(host('PostgreSQL on db.abcdefghijklmnop.supabase.co:5432/postgres'),
      { host: 'db.abcdefghijklmnop.supabase.co', provider: 'supabase', region: null, privateNetwork: false });
    assert.deepEqual(host('PostgreSQL on 127.0.0.1:54329/postgres'), { host: '127.0.0.1', provider: null, region: null, privateNetwork: false });
    assert.deepEqual(host('PostgreSQL (embedded, in memory)'), { host: null, provider: null, region: null, privateNetwork: false });
    assert.equal(system.sizeText(300), '1 KB');
    assert.equal(system.sizeText(9.6 * 1024 * 1024), '9.6 MB');
    assert.equal(system.sizeText(1.5 * 1024 ** 3), '1.50 GB');
  });

  test('a free Render database: when it stops and is deleted, and when that becomes urgent', () => {
    const plan = (today) => system.renderFreePlan('2026-09-20', today);
    assert.deepEqual(plan('2026-09-24'), { stops: '20 Oct 2026', deleted: '3 Nov 2026', daysLeft: 26, urgent: false });
    assert.deepEqual(plan('2026-10-13'), { stops: '20 Oct 2026', deleted: '3 Nov 2026', daysLeft: 7, urgent: true });
    assert.equal(plan('2026-10-20').daysLeft, 0); // the last day
    assert.equal(plan('2026-10-21'), null); // past it and still answering: it was upgraded
    assert.equal(system.renderFreePlan(undefined, '2026-09-24'), null);
    assert.equal(system.renderFreePlan('2026-09-20', ''), null);
  });

  test('on a Render database the card counts down the free plan', { skip: process.env.TEST_DATABASE ? false : 'needs PostgreSQL' }, async () => {
    const created = hotel.db.get("SELECT value FROM app_meta WHERE key = 'created_at'").value;
    assert.match(created, /^\d{4}-\d{2}-\d{2}$/); // written when the app first set the database up
    const admin = hotel.client();
    await admin.login();
    const label = hotel.db.label;
    hotel.db.label = 'PostgreSQL on dpg-d3k9abc123def4567890-a:5432/frontdesk'; // as render.yaml connects it
    try {
      hotel.db.run("UPDATE app_meta SET value = '2026-09-20' WHERE key = 'created_at'");
      let page = await admin.get('/admin');
      assert.match(page.text, /<p class="card__subtitle">Render PostgreSQL · private network<\/p>/);
      assert.match(page.text, /<dt>Set up<\/dt><dd>20 Sept? 2026<\/dd>/);
      assert.match(page.text, /<div class="notice"><svg[^]*?<strong>26 days left on Render’s free database, if it is still on the free plan\.<\/strong> It stops on 20 Oct 2026 and is deleted on 3 Nov 2026\./);
      hotel.db.run("UPDATE app_meta SET value = '2026-08-27' WHERE key = 'created_at'");
      page = await admin.get('/admin');
      assert.match(page.text, /<div class="notice notice--error" role="alert"><svg[^]*?<strong>2 days left on Render’s free database/);
      hotel.db.run("UPDATE app_meta SET value = '2026-08-01' WHERE key = 'created_at'");
      page = await admin.get('/admin');
      assert.doesNotMatch(page.text, /free database/); // still answering after the stop date: it was upgraded
    } finally {
      hotel.db.label = label;
      hotel.db.run("UPDATE app_meta SET value = ? WHERE key = 'created_at'", created);
    }
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
