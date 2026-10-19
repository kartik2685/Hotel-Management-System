'use strict';
/*
 * Runs in a worker thread and owns the PostgreSQL connection for postgres.js. Each message is one call;
 * the answer goes back on the port and the shared signal wakes the waiting main thread.
 * A lost connection is reopened on the next call.
 */
const { workerData } = require('node:worker_threads');

const { config, port } = workerData;
const signal = new Int32Array(workerData.signal);

let opening = null; // Promise of { query, exec, close }
let generation = 0; // which connection is current, so a stale one cannot reset a newer one
let inTransaction = 0; // generation of the connection holding the open transaction (0: none)

const toNumber = (value) => (value === null ? null : Number(value)); // bigint and numeric, like SQLite

function connection() {
  if (!opening) {
    const mine = (generation += 1);
    opening = (config.pglite !== undefined ? openPglite() : openPg(mine)).catch((error) => {
      if (generation === mine) opening = null;
      error.connecting = true;
      throw error;
    });
  }
  return opening;
}

async function openPg(mine) {
  const pg = require('pg');
  const getTypeParser = (oid, format) => (oid === 20 || oid === 1700 ? toNumber : pg.types.getTypeParser(oid, format));
  const client = new pg.Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
    application_name: 'frontdesk',
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000, // notice a silently dropped connection within about a minute
    connectionTimeoutMillis: 10_000,
    query_timeout: 25_000,
    types: { getTypeParser },
  });
  const lost = () => {
    if (generation === mine) opening = null; // reconnect on the next call
  };
  client.on('error', lost);
  client.on('end', lost);
  await client.connect();
  return {
    async query(sql, params) {
      const result = await client.query(sql, params);
      return { rows: result.rows, count: result.rowCount ?? 0 };
    },
    exec: (sql) => client.query(sql),
    close: () => client.end(),
  };
}

async function openPglite() {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const options = { parsers: { [types.INT8]: toNumber, [types.NUMERIC]: toNumber } };
  const db = new PGlite(config.pglite ? { ...options, dataDir: config.pglite } : options);
  await db.waitReady;
  return {
    async query(sql, params) {
      const result = await db.query(sql, params);
      return { rows: result.rows, count: result.affectedRows ?? 0 };
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}

/* Errors from the database itself carry a five-character SQLSTATE code (e.g. 23505). Anything else on a network
   connection (timeouts, resets) means the connection can no longer be trusted: drop it, reconnect on the next call. */
const fromServer = (error) => typeof (error && error.code) === 'string' && /^[0-9A-Z]{5}$/.test(error.code);

function drop() {
  const open = opening;
  opening = null;
  generation += 1;
  if (open) open.then((db) => db.close()).catch(() => {});
}

async function answer({ type, sql, params }) {
  if (type === 'close') {
    const open = opening;
    opening = null;
    generation += 1;
    if (open) await (await open).close();
    return undefined;
  }
  const db = await connection();
  const statement = type === 'exec' ? sql.trim().toUpperCase() : '';
  if (inTransaction && inTransaction !== generation) {
    // The connection that held the transaction is gone, and the database rolled it back. Carrying on with the
    // rest of it on a new connection would save half of it, so everything fails until the app rolls back.
    if (statement === 'ROLLBACK' || statement === 'COMMIT') inTransaction = 0; // the transaction is over either way
    if (statement === 'ROLLBACK') return undefined;
    throw new Error('The database connection was lost in the middle of a transaction; none of it was saved.');
  }
  if (type === 'exec') {
    if (statement === 'BEGIN') {
      await db.exec(sql);
      inTransaction = generation;
    } else if (statement === 'COMMIT' || statement === 'ROLLBACK') {
      try {
        await db.exec(sql);
      } finally {
        inTransaction = 0;
      }
    } else {
      await db.exec(sql);
    }
    return undefined;
  }
  const result = await db.query(sql, params);
  if (type === 'all') return result.rows;
  if (type === 'get') return result.rows[0];
  return { changes: result.count };
}

port.on('message', async (message) => {
  let reply;
  try {
    reply = { id: message.id, value: await answer(message) };
  } catch (error) {
    if (config.pglite === undefined && !fromServer(error) && !(error && error.connecting)) drop();
    reply = {
      id: message.id,
      error: {
        message: String((error && error.message) || error),
        code: error && error.code,
        detail: error && error.detail,
        constraint: error && error.constraint,
        hint: error && error.hint,
        connecting: Boolean(error && error.connecting),
      },
    };
  }
  port.postMessage(reply);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
