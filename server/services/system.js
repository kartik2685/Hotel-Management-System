'use strict';
/* What the admin panel shows about the database: which one, where it is, how big and how near. */
const path = require('node:path');
const config = require('../config');

// Supabase's pooler hosts carry the AWS region: aws-0-ap-southeast-1.pooler.supabase.com
const REGIONS = {
  'ap-southeast-1': 'Singapore', 'ap-south-1': 'Mumbai', 'ap-southeast-2': 'Sydney', 'ap-northeast-1': 'Tokyo',
  'ap-northeast-2': 'Seoul', 'us-east-1': 'North Virginia', 'us-east-2': 'Ohio', 'us-west-1': 'North California',
  'us-west-2': 'Oregon', 'ca-central-1': 'Canada', 'eu-west-1': 'Ireland', 'eu-west-2': 'London', 'eu-west-3': 'Paris',
  'eu-central-1': 'Frankfurt', 'eu-central-2': 'Zurich', 'eu-north-1': 'Stockholm', 'sa-east-1': 'São Paulo',
};
// Every page asks the database a dozen or more things; slower round trips than this add up to slow pages.
const FAR_MS = 15;

/* True when the data is in a file the host throws away: Render's free instances have no disk. */
const temporaryFile = (db, env = process.env) => db.dialect === 'sqlite' && Boolean(env.RENDER) && !env.DB_PATH;

/* "PostgreSQL on host:port/db" (see postgres.js describe) → { host, supabase, region }. */
function postgresHost(label) {
  const host = (String(label).match(/^PostgreSQL on ([^:/\s]+)/) || [])[1] || null;
  const code = host && (host.match(/^aws-\d+-([a-z]{2}-[a-z]+-\d)\.pooler\.supabase\.com$/i) || [])[1];
  return {
    host,
    supabase: Boolean(host && /\.supabase\.(com|co)$/i.test(host)),
    region: code ? REGIONS[code.toLowerCase()] || code : null,
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

function databaseInfo(db) {
  if (db.dialect === 'postgres') {
    const { host, supabase, region } = postgresHost(db.label);
    const ms = roundTrip(db);
    return {
      name: supabase ? 'Supabase (PostgreSQL)' : 'PostgreSQL',
      where: host || db.label.replace(/^PostgreSQL\s*/, '').replace(/^\((.*)\)$/, '$1') || 'PostgreSQL',
      region,
      tables: db.get("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'").n,
      version: db.get("SELECT value FROM app_meta WHERE key = 'schema_version'").value,
      size: sizeText(db.get('SELECT pg_database_size(current_database()) AS n').n),
      ms: ms < 1 ? 'under 1 ms' : `${ms.toFixed(1)} ms`,
      far: ms > FAR_MS,
      temporary: false,
    };
  }
  const file = db.label.replace(/^SQLite file /, '');
  const inside = file.startsWith(config.root + path.sep);
  return {
    name: 'SQLite file',
    where: inside ? path.relative(config.root, file) : file,
    region: null,
    tables: db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%'").n,
    version: String(db.get('PRAGMA user_version').user_version),
    size: sizeText(db.get('PRAGMA page_count').page_count * db.get('PRAGMA page_size').page_size),
    ms: null,
    far: false,
    temporary: temporaryFile(db),
  };
}

module.exports = { databaseInfo, postgresHost, temporaryFile, sizeText };
