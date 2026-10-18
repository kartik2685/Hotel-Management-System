'use strict';
/* Starts the Frontdesk server. */
const config = require('./config');
const { open } = require('./db');
const seed = require('./db/seed');
const auth = require('./lib/auth');
const { temporaryFile } = require('./services/system');
const { createApp } = require('./app');

async function main() {
  const db = open(config.databaseUrl || config.dbPath);
  console.log(`Database: ${db.label}`);
  if (temporaryFile(db)) {
    console.warn('WARNING: DATABASE_URL is not set, so the data is in a file on this server. Render’s free plan deletes that file '
      + 'on every restart and redeploy and after 15 minutes without visitors. In Render → Environment, add DATABASE_URL with your '
      + 'Supabase connection string (Supabase → Connect → Session pooler).');
  }
  if (seed.isEmpty(db)) console.log(startMessage(await seed.firstRun(db)));
  auth.purgeExpired(db);
  setInterval(() => auth.purgeExpired(db), 60 * 60 * 1000).unref();

  const app = createApp(db);
  const server = app.listen(config.port, config.host, () => {
    console.log(`Frontdesk is running on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  });
  const stop = () => server.close(() => {
    db.close();
    process.exit(0);
  });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

/* Printed once, when a new database is set up. A printed password comes last, with nothing after it to copy by mistake. */
function startMessage({ kind, email, password }) {
  const what = kind === 'empty' ? 'empty hotel created' : 'demo hotel loaded';
  if (!password) return `New database: ${what}. Sign in as ${email} with the password in ${kind === 'empty' ? 'ADMIN_PASSWORD' : 'DEMO_PASSWORD'}.`;
  const change = kind === 'empty' ? ' You will be asked to change the password.' : '';
  return `New database: ${what}.${change} Sign in as ${email} with this password: ${password}`;
}

main().catch((error) => {
  console.error(error.connecting ? error.message : error); // database connection problems: just the explanation
  process.exit(1);
});
