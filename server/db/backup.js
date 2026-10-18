'use strict';
/* Copies the live database to backups/frontdesk-YYYY-MM-DD-HHMM.db (safe while the app is running). */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { open } = require('./index');

const dir = path.join(config.root, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const target = path.join(dir, `frontdesk-${stamp}.db`);
const db = open(config.dbPath);
db.raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup written to ${target}`);
