'use strict';
/*
 * Copies every row from one database to another, empty one. Works both ways:
 *   npm run db:copy -- --from data/frontdesk.db --to "postgres://…"   move a SQLite hotel to Supabase
 *   npm run db:copy -- --from "postgres://…" --to backups/copy.db      Supabase to a SQLite file (a backup)
 * --from defaults to DB_PATH and --to to DATABASE_URL.
 */
const { open, isPostgres } = require('./index');
const TABLES = require('./tables');

const BATCH = 200; // rows per INSERT

/* Reads a PostgreSQL source from one snapshot, so rows the app writes during the copy can't leave, say,
   a payment without its booking. (A SQLite source is a file nobody else is writing to, or VACUUM INTO.) */
function snapshot(source, fn) {
  if (source.dialect !== 'postgres') return fn();
  return source.tx(() => {
    source.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return fn();
  });
}

/* Copies all tables inside one transaction on the target; returns { table: rows }. */
function copyAll(source, target) {
  if (target.get('SELECT COUNT(*) AS n FROM users').n > 0) {
    throw new Error(`${target.label} already has data. Copy into an empty database.`);
  }
  const counts = {};
  snapshot(source, () => target.tx(() => {
    for (const table of TABLES) {
      const rows = source.all(`SELECT * FROM ${table}`);
      counts[table] = rows.length;
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const one = `(${columns.map(() => '?').join(', ')})`;
      for (let at = 0; at < rows.length; at += BATCH) {
        const batch = rows.slice(at, at + BATCH);
        target.run(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${batch.map(() => one).join(', ')}`,
          ...batch.flatMap((row) => columns.map((c) => row[c])),
        );
      }
    }
    if (target.dialect === 'postgres') {
      // New rows must get ids after the copied ones.
      for (const table of TABLES) {
        const identity = target.get(
          "SELECT 1 AS yes FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = 'id' AND is_identity = 'YES'",
          table,
        );
        if (identity) target.get(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 0) + 1 FROM ${table}), false)`);
      }
    }
  }));
  return counts;
}

function main() {
  const config = require('../config');
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const from = option('--from') || config.dbPath;
  const to = option('--to') || config.databaseUrl;
  if (!to) {
    console.error('Say where to copy to: --to "postgres://…" (or set DATABASE_URL), or --to a new .db file.');
    process.exit(1);
  }
  if (from === to) {
    console.error('--from and --to are the same database.');
    process.exit(1);
  }
  const source = open(from);
  const target = open(to);
  try {
    const counts = copyAll(source, target);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`Copied ${total} rows from ${source.label} to ${target.label}.`);
    if (!isPostgres(to)) console.log('Keep this file somewhere safe; copy it back with --from it --to your DATABASE_URL.');
  } finally {
    source.close();
    target.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { copyAll };
