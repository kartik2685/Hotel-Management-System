'use strict';
/* What the admin panel shows about the database: which one, where it is, how big and how near. */
const path = require('node:path');
const config = require('../config');

// Supabase's pooler hosts carry the AWS region: aws-0-ap-southeast-1.pooler.supabase.com
const AWS_REGIONS = {
  'ap-southeast-1': 'Singapore', 'ap-south-1': 'Mumbai', 'ap-southeast-2': 'Sydney', 'ap-northeast-1': 'Tokyo',
  'ap-northeast-2': 'Seoul', 'us-east-1': 'North Virginia', 'us-east-2': 'Ohio', 'us-west-1': 'North California',
  'us-west-2': 'Oregon', 'ca-central-1': 'Canada', 'eu-west-1': 'Ireland', 'eu-west-2': 'London', 'eu-west-3': 'Paris',
  'eu-central-1': 'Frankfurt', 'eu-central-2': 'Zurich', 'eu-north-1': 'Stockholm', 'sa-east-1': 'São Paulo',
};
// Render Postgres: private address dpg-<id>-a, public address dpg-<id>-a.<region>-postgres.render.com
const RENDER_REGIONS = { oregon: 'Oregon', ohio: 'Ohio', virginia: 'Virginia', frankfurt: 'Frankfurt', singapore: 'Singapore' };
const RENDER_FREE_DAYS = 30; // a free Render database stops 30 days after it is created…
const RENDER_GRACE_DAYS = 14; // …and is deleted 14 days after that unless it is upgraded
// Every page asks the database a dozen or more things; slower round trips than this add up to slow pages.
const FAR_MS = 15;

/* True when the data is in a file the host throws away: Render's free instances have no disk. */
const temporaryFile = (db, env = process.env) => db.dialect === 'sqlite' && Boolean(env.RENDER) && !env.DB_PATH;

/* "PostgreSQL on host:port/db" (see postgres.js describe) → { host, provider, region, privateNetwork }. */
function postgresHost(label) {
  const host = (String(label).match(/^PostgreSQL on ([^:/\s]+)/) || [])[1] || null;
  const result = { host, provider: null, region: null, privateNetwork: false };
  if (!host) return result;
  if (/\.supabase\.(com|co)$/i.test(host)) {
    const code = (host.match(/^aws-\d+-([a-z]{2}-[a-z]+-\d)\.pooler\.supabase\.com$/i) || [])[1];
    return { ...result, provider: 'supabase', region: code ? AWS_REGIONS[code.toLowerCase()] || code : null };
  }
  const renderPublic = host.match(/^dpg-[a-z0-9]+-[a-z]\.([a-z]+)-postgres\.render\.com$/i);
  if (renderPublic) return { ...result, provider: 'render', region: RENDER_REGIONS[renderPublic[1].toLowerCase()] || renderPublic[1] };
  if (/^dpg-[a-z0-9]+-[a-z]$/i.test(host)) return { ...result, provider: 'render', privateNetwork: true };
  return result;
}

const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const isoDay = (n) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const longDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/* When a free Render database set up on `createdAt` stops and is deleted, seen from `today` (both YYYY-MM-DD).
   null once the stop date has passed: a free database that had stopped could not be read at all, so this one
   was upgraded. */
function renderFreePlan(createdAt, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(createdAt)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(today))) return null;
  const stops = dayNumber(createdAt) + RENDER_FREE_DAYS;
  const daysLeft = stops - dayNumber(today);
  if (daysLeft < 0) return null;
  return {
    stops: longDay(isoDay(stops)),
    deleted: longDay(isoDay(stops + RENDER_GRACE_DAYS)),
    daysLeft,
    urgent: daysLeft <= 7,
  };
}

const sizeText = (bytes) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

/* The middle of three tiny queries, in milliseconds. */
function roundTrip(db) {
  const times = [];
  for (let i = 0; i < 3; i += 1) {
    const start = process.hrtime.bigint();
    db.get('SELECT 1 AS one');
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  return times.sort((a, b) => a - b)[1];
}

const NAMES = { supabase: 'Supabase (PostgreSQL)', render: 'Render PostgreSQL' };

/* today: the hotel's date (YYYY-MM-DD), for the free-plan reminder. */
function databaseInfo(db, { today } = {}) {
  if (db.dialect === 'postgres') {
    const { host, provider, region, privateNetwork } = postgresHost(db.label);
    const ms = roundTrip(db);
    const meta = Object.fromEntries(db.all("SELECT key, value FROM app_meta WHERE key IN ('schema_version', 'created_at')").map((r) => [r.key, r.value]));
    return {
      title: [NAMES[provider] || 'PostgreSQL', region, privateNetwork && 'private network'].filter(Boolean).join(' · '),
      where: host || db.label.replace(/^PostgreSQL\s*/, '').replace(/^\((.*)\)$/, '$1') || 'PostgreSQL',
      tables: db.get("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'").n,
      version: meta.schema_version,
      size: sizeText(db.get('SELECT pg_database_size(current_database()) AS n').n),
      setUp: meta.created_at ? longDay(meta.created_at) : null,
      ms: ms < 1 ? 'under 1 ms' : `${ms.toFixed(1)} ms`,
      far: ms > FAR_MS,
      freePlan: provider === 'render' ? renderFreePlan(meta.created_at, today) : null,
      temporary: false,
    };
  }
  const file = db.label.replace(/^SQLite file /, '');
  const inside = file.startsWith(config.root + path.sep);
  return {
    title: 'SQLite file',
    where: inside ? path.relative(config.root, file) : file,
    tables: db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%'").n,
    version: String(db.get('PRAGMA user_version').user_version),
    size: sizeText(db.get('PRAGMA page_count').page_count * db.get('PRAGMA page_size').page_size),
    setUp: null,
    ms: null,
    far: false,
    freePlan: null,
    temporary: temporaryFile(db),
  };
}

module.exports = { databaseInfo, postgresHost, renderFreePlan, temporaryFile, sizeText };
