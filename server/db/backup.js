'use strict';
/*
 * A copy of the whole database in one SQLite file, safe to make while the app is running:
 *   npm run backup                               writes backups/frontdesk-YYYY-MM-DD-HHMM.db
 *   Admin panel → Overview → Download a backup   the same file, straight to the browser
 * With DATABASE_URL (PostgreSQL / Supabase) the copy is a SQLite file with the same tables. The app opens it
 * as it is (DB_PATH=<file> npm start), and it goes back into an empty Postgres database with
 * npm run db:copy -- --from <file>.db --to "<connection string>".
 */
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('./index');
const { copyAll } = require('./copy');

/* Writes a backup of `db` to `file`, replacing it. */
function backupTo(db, file) {
  fs.rmSync(file, { force: true });
  if (db.dialect === 'sqlite') {
    db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    return;
  }
  const copy = open(file);
  try {
    copyAll(db, copy);
    copy.exec('PRAGMA journal_mode = DELETE'); // one self-contained file
  } catch (error) {
    copy.close();
    fs.rmSync(file, { force: true });
    throw error;
  }
  copy.close();
}

function main() {
  const config = require('../config');
  const dir = path.join(config.root, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const target = path.join(dir, `frontdesk-${stamp}.db`);
  const db = open(config.databaseUrl || config.dbPath);
  try {
    backupTo(db, target);
    console.log(`Backup of ${db.label} written to ${target}`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.connecting ? error.message : error); // database connection problems: just the explanation
    process.exit(1);
  }
}

module.exports = { backupTo };
