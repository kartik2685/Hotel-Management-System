'use strict';
/* Starts the Frontdesk server. */
const config = require('./config');
const { open } = require('./db');
const seed = require('./db/seed');
const auth = require('./lib/auth');
const { createApp } = require('./app');

async function main() {
  const db = open(config.dbPath);
  if (seed.isEmpty(db)) {
    const result = await seed.loadDemo(db);
    console.log(`New database: demo hotel loaded. Sign in as ${result.users[0].email} with the password ${result.password}`);
  }
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
