'use strict';
/* Runtime settings, read from environment variables (see .env.example). */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// Local settings can live in a .env file next to package.json. Real environment variables (a hosting
// dashboard) always win over it. Tests never read it.
const envFile = path.join(root, '.env');
if (!process.env.NODE_TEST_CONTEXT && fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const flag = (value, fallback = false) => (value === undefined || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value));
const production = env.NODE_ENV === 'production';
const embed = flag(env.EMBED_PREVIEW);

module.exports = {
  root,
  production,
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  dbPath: env.DB_PATH || path.join(root, 'data', 'frontdesk.db'),
  // PostgreSQL connection string (e.g. Supabase). When set, it is used instead of the SQLite file.
  databaseUrl: (env.DATABASE_URL || '').trim() || null,
  // Set when the app runs behind a proxy/load balancer that sets X-Forwarded-* headers.
  trustProxy: flag(env.TRUST_PROXY, false),
  // Secure cookies need HTTPS. On by default in production.
  cookieSecure: embed || (env.COOKIE_SECURE ? flag(env.COOKIE_SECURE) : production),
  // Allow the app to be shown inside another site's frame (live preview panels only).
  embed,
  // Development aid: "/" shows a Desktop / Tablet / Mobile preview bar around the app.
  previewBar: flag(env.PREVIEW_BAR),
  // Fixed hotel clock "YYYY-MM-DDTHH:MM" for demos and automated checks.
  fixedNow: env.HMS_NOW || null,
  sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES || 30),
  sessionRememberDays: Number(env.SESSION_REMEMBER_DAYS || 30),
  demoPassword: env.DEMO_PASSWORD || 'harlow-demo',
};
