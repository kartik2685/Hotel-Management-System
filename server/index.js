'use strict';
/* Starts the Frontdesk server. */
const config = require('./config');
const { open } = require('./db');
const seed = require('./db/seed');
const auth = require('./lib/auth');
const { createApp } = require('./app');

async function main() {
  const db = open(config.dbPath);
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

/* Printed once, when a new database is set up. */
function startMessage({ kind, email, password }) {
  const what = kind === 'empty' ? 'empty hotel created' : 'demo hotel loaded';
  const secret = password ? `the password ${password}` : `the password in ${kind === 'empty' ? 'ADMIN_PASSWORD' : 'DEMO_PASSWORD'}`;
  const change = kind === 'empty' && password ? ' (you will be asked to change it)' : '';
  return `New database: ${what}. Sign in as ${email} with ${secret}${change}.`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
