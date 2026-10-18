'use strict';
/*
 * PostgreSQL (for example Supabase) behind the same synchronous API as the SQLite database (index.js),
 * so the rest of the app does not care which one it runs on.
 *
 * Postgres drivers are asynchronous, so the connection lives in a worker thread (postgres-worker.js)
 * and each call waits for the worker's answer (Atomics.wait). A call costs one round trip to the
 * database and the server waits during it: fine for a hotel's staff and guest traffic as long as the
 * database is close to the app — pick the same region for both.
 *
 * Connection strings: postgres://user:password@host:port/database[?sslmode=…]. Remote hosts use TLS
 * (sslmode=require, like libpq); sslmode=verify-full also checks the certificate, sslmode=disable
 * turns TLS off. pglite:memory and pglite:<folder> run an embedded Postgres (tests, local tries).
 */
const fs = require('node:fs');
const path = require('node:path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('node:worker_threads');
const { transaction } = require('./index');

const ANSWER_MS = 30_000; // a call that takes longer gives up and reconnects
const SCHEMA_LOCK = 724_025_180; // pg_advisory_xact_lock key: one server at a time sets up the tables
const MIGRATIONS = path.join(__dirname, 'migrations', 'pg');

function open(url) {
  const db = connect(url);
  try {
    setUp(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/* A connection without touching the tables (open() also creates or updates them). */
function connect(url) {
  let config;
  try {
    config = connectionConfig(url);
  } catch (error) {
    throw Object.assign(new Error(`DATABASE_URL is not a valid connection string (${error.message}). ${HINTS.url}`), { connecting: true });
  }
  return wrap(new Connection(config), describe(url));
}

/* Creates or updates the tables, inside one transaction so a failed start changes nothing. */
function setUp(db) {
  db.tx(() => {
    db.get('SELECT pg_advisory_xact_lock(?)', SCHEMA_LOCK);
    db.exec(fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf8'));
    let version = Number(db.get("SELECT value FROM app_meta WHERE key = 'schema_version'").value);
    const files = fs.existsSync(MIGRATIONS) ? fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}-.*\.sql$/.test(f)).sort() : [];
    for (const file of files) {
      const target = Number(file.slice(0, 3));
      if (target <= version) continue;
      try {
        db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
      } catch (error) {
        throw new Error(`Database migration pg/${file} failed: ${error.message}`);
      }
      db.run("UPDATE app_meta SET value = ? WHERE key = 'schema_version'", String(target));
      version = target;
    }
  });
}

function wrap(connection, label) {
  const cache = new Map();
  const text = (sql) => {
    let converted = cache.get(sql);
    if (converted === undefined) {
      converted = positional(sql);
      cache.set(sql, converted);
    }
    return converted;
  };
  const send = (type, sql, params) => connection.call({ type, sql: text(sql), params: params.map(param) });
  const exec = (sql) => connection.call({ type: 'exec', sql });
  return {
    dialect: 'postgres',
    label,
    all: (sql, ...params) => send('all', sql, params),
    get: (sql, ...params) => send('get', sql, params),
    run: (sql, ...params) => send('run', sql, params), // { changes }; use INSERT … RETURNING id for new ids
    exec,
    tx: transaction({ begin: 'BEGIN', exec }),
    close: () => connection.close(),
  };
}

/* The worker thread that owns the connection, and the blocking call into it. */
class Connection {
  constructor(config) {
    this.config = config;
    this.worker = null;
    this.seq = 0;
    this.closed = false;
  }

  start() {
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.signal = new Int32Array(new SharedArrayBuffer(4));
    this.worker = new Worker(path.join(__dirname, 'postgres-worker.js'), {
      workerData: { config: this.config, port: port2, signal: this.signal.buffer },
      transferList: [port2],
    });
    this.worker.unref();
    this.worker.on('error', () => {}); // a dead worker shows up as a call that is not answered
  }

  call(message) {
    if (this.closed) throw new Error('The database connection is closed.');
    if (!this.worker) this.start();
    const id = ++this.seq;
    this.port.postMessage({ ...message, id });
    const deadline = Date.now() + ANSWER_MS;
    for (;;) {
      Atomics.store(this.signal, 0, 0);
      const reply = receiveMessageOnPort(this.port);
      if (reply) {
        const answer = reply.message;
        if (answer.id !== id) continue; // a late answer to a call that already gave up
        if (answer.error) throw toError(answer.error, message.sql);
        return answer.value;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        this.stop();
        throw new Error(`The database did not answer within ${ANSWER_MS / 1000} seconds.`);
      }
      Atomics.wait(this.signal, 0, 0, Math.min(left, 250));
    }
  }

  stop() {
    const worker = this.worker;
    this.worker = null;
    if (worker) worker.terminate().catch(() => {});
  }

  close() {
    if (this.closed) return;
    try {
      if (this.worker) this.call({ type: 'close' });
    } catch {
      // closing anyway
    } finally {
      this.stop();
      this.closed = true;
    }
  }
}

/* SQLite-style ? placeholders to Postgres $1, $2… (ignoring ? inside quotes and comments). */
function positional(sql) {
  let out = '';
  let n = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j;
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const j = end === -1 ? sql.length - 1 : end;
      out += sql.slice(i, j + 1);
      i = j;
    } else {
      out += c === '?' ? `$${(n += 1)}` : c;
    }
  }
  return out;
}

/* Values the way SQLite would store them. */
function param(value) {
  if (value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/* What node-postgres gets: the connection string without ssl* options, plus an explicit ssl setting. */
function connectionConfig(raw) {
  const value = String(raw).trim();
  if (/^pglite:/i.test(value)) {
    const where = value.replace(/^pglite:(\/\/)?/i, '');
    return { pglite: where && where !== 'memory' ? path.resolve(where) : null };
  }
  const url = new URL(value);
  if (!url.hostname && !url.searchParams.get('host')) throw new Error('no host name');
  if (/\[?YOUR[-_ ]PASSWORD\]?/i.test(decodeURIComponent(url.password))) throw new Error(`the password is still the placeholder ${decodeURIComponent(url.password)}`);
  const mode = (url.searchParams.get('sslmode') || '').toLowerCase();
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword', 'uselibpqcompat']) url.searchParams.delete(key);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(url.hostname);
  let ssl;
  if (mode === 'disable' || (!mode && local)) ssl = false;
  else if (mode === 'verify-full' || mode === 'verify-ca') ssl = { rejectUnauthorized: true };
  else ssl = { rejectUnauthorized: false }; // encrypted; the certificate is not checked (libpq "require")
  return { connectionString: url.toString(), ssl };
}

/* "PostgreSQL on host/database" — never the password. */
function describe(raw) {
  const value = String(raw).trim();
  if (/^pglite:/i.test(value)) return `PostgreSQL (embedded, ${connectionConfig(value).pglite || 'in memory'})`;
  try {
    const url = new URL(value);
    return `PostgreSQL on ${url.hostname}${url.port ? ':' + url.port : ''}${url.pathname || ''}`;
  } catch {
    return 'PostgreSQL';
  }
}

const HINTS = {
  url: 'Copy it again from Supabase (Connect → Session pooler). If the password contains characters like @ # / ? % reset it to letters and numbers only, or URL-encode them.',
  ipv6: 'This server cannot reach the database over IPv6. On Supabase use the "Session pooler" connection string (Connect → Session pooler, host ….pooler.supabase.com), not the direct connection (db.….supabase.co).',
  host: 'The database host name was not found. Check DATABASE_URL (Supabase: Connect → Session pooler).',
  password: 'Wrong database password. Supabase: Project Settings → Database → Reset database password, then put the new one in DATABASE_URL.',
  tenant: 'Supabase did not recognise the user. For the pooler the user name is postgres.<project-ref>, exactly as shown under Connect → Session pooler.',
  refused: 'Nothing answered at that address and port. Check the host and port in DATABASE_URL.',
  timeout: 'The database did not answer. Check DATABASE_URL, and on Supabase that the project is not paused (free projects pause after a week without use).',
};

function hintFor(error) {
  const code = error.code || '';
  const message = String(error.message || '');
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'EADDRNOTAVAIL') return HINTS.ipv6;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return HINTS.host;
  if (code === '28P01' || /password authentication failed/i.test(message)) return HINTS.password;
  if (/tenant or user not found/i.test(message)) return HINTS.tenant;
  if (code === 'ECONNREFUSED') return HINTS.refused;
  if (code === 'ETIMEDOUT' || /timeout/i.test(message)) return HINTS.timeout;
  return null;
}

function toError(data, sql) {
  const error = new Error(data.message);
  for (const key of ['code', 'detail', 'constraint', 'hint']) if (data[key]) error[key] = data[key];
  if (data.connecting) {
    const hint = hintFor(data);
    error.message = `Could not connect to the database: ${data.message}${hint ? `\n${hint}` : ''}`;
    error.connecting = true;
  } else if (sql) {
    error.sql = sql;
  }
  return error;
}

module.exports = { open, connect, positional, connectionConfig, describe, hintFor };
