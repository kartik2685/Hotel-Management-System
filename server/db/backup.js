'use strict';
/*
 * Writes a copy of the live database to backups/frontdesk-YYYY-MM-DD-HHMM.db (safe while the app is running).
 * With DATABASE_URL set (PostgreSQL / Supabase) the copy is a SQLite file with the same tables; restore it
 * with: npm run db:copy -- --from backups/<file>.db --to "<an empty Postgres database>".
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { open } = require('./index');
const { copyAll } = require('./copy');

const dir = path.join(config.root, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const target = path.join(dir, `frontdesk-${stamp}.db`);

const db = open(config.databaseUrl || config.dbPath);
try {
  if (db.dialect === 'sqlite') {
    db.raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } else {
    fs.rmSync(target, { force: true });
    const copy = open(target);
    try {
      copyAll(db, copy);
    } finally {
      copy.close();
    }
  }
  console.log(`Backup of ${db.label} written to ${target}`);
} finally {
  db.close();
}
