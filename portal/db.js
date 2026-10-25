const fs = require('fs');
const path = require('path');
const { Pool, Client, types: pgTypes } = require('pg');

/* ============================================================
   PostgreSQL access for the portal (Task Tracker + ATIP snapshot).

   Connection, in order of preference:
     DATABASE_URL           postgresql://user:password@host:5432/dbname
                            On Neon, the POOLED string (its host has -pooler
                            in it): every query the app makes goes over it.
     DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   instead of a URL
   DATABASE_URL_UNPOOLED, set beside DATABASE_URL, is the DIRECT string, used
   only to create the tables on start: DDL and the advisory lock around it
   belong on a direct connection, not on PgBouncer. Unset, that goes over the
   connection above.
   docs/NEON.md has the Neon side.

   TLS. A URL carries its own: ?sslmode=require (node-postgres 8 verifies the
   certificate, as verify-full does), and channel_binding=require, which turns
   on SCRAM channel binding where the server offers it. DB_SSL=require (or
   true) turns TLS on for the DB_* settings or a URL without sslmode;
   DB_SSL=no-verify skips certificate checks. A URL's sslmode wins over DB_SSL.

   The helpers take PostgreSQL's numbered placeholders ($1, $2, ...):
     all(sql, params)  -> every row
     get(sql, params)  -> the first row, or null
     run(sql, params)  -> { rowCount, rows }  (add RETURNING id for the new id)
     tx(async (q) => { ... })  -> the same three helpers inside one transaction
   ============================================================ */

const OID = { INT8: 20, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184 };

// The API has always handed dates and times to the browser as the plain text
// the database holds ("2026-10-09", "2026-10-09 14:05:00"), never as JS Dates
// shifted through the server's time zone. COUNT(*) is BIGINT, which pg returns
// as a string by default; the counts here are small, so return numbers.
const types = {
  getTypeParser(oid, format) {
    if (oid === OID.DATE || oid === OID.TIMESTAMP || oid === OID.TIMESTAMPTZ) return (v) => v;
    if (oid === OID.INT8) return (v) => (v === null ? null : Number(v));
    return pgTypes.getTypeParser(oid, format);
  },
};

function toParams(params) {
  return (params || []).map(v => (v === undefined ? null : v));
}

function sslOption(value) {
  const v = String(value || '').toLowerCase();
  if (!v || v === 'false' || v === '0' || v === 'disable' || v === 'off') return undefined;
  if (v === 'no-verify') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

// Long enough for a Neon compute waking from suspend, which takes a few
// seconds; short enough that an unreachable database is an error in the log
// rather than a start-up, or a request, that hangs for ever. pg's default is
// no limit at all.
const CONNECT_TIMEOUT_MS = 15000;

// node-postgres reads sslmode from a URL but ignores channel_binding, which
// libpq honours; this turns it into the option pg does read. pg still falls
// back to plain SCRAM when the server offers nothing better (PgBouncer).
function urlConfig(url) {
  let binding = '';
  try { binding = new URL(url).searchParams.get('channel_binding') || ''; } catch { /* pg reports a bad URL */ }
  return { connectionString: url, ...(binding === 'require' || binding === 'prefer' ? { enableChannelBinding: true } : {}) };
}

function connectionConfig(env = process.env) {
  const common = {
    max: Number(env.DB_POOL_MAX || 5), ssl: sslOption(env.DB_SSL), types, connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  };
  if (env.DATABASE_URL) return { ...common, ...urlConfig(env.DATABASE_URL) };
  return {
    ...common,
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  };
}

/**
 * The direct connection the schema is applied over, or null to use the pool.
 * Only as the twin of a DATABASE_URL: beside DB_* settings it could name a
 * different database from the one the app then uses.
 */
function schemaConfig(env = process.env) {
  if (!env.DATABASE_URL || !env.DATABASE_URL_UNPOOLED) return null;
  return { ssl: sslOption(env.DB_SSL), connectionTimeoutMillis: CONNECT_TIMEOUT_MS, ...urlConfig(env.DATABASE_URL_UNPOOLED) };
}

function describe(config) {
  if (config.connectionString) {
    try {
      const u = new URL(config.connectionString);
      return `${decodeURIComponent(u.username)}@${u.hostname}:${u.port || 5432}${u.pathname}`;
    } catch {
      return '(DATABASE_URL)';
    }
  }
  return `${config.user}@${config.host}:${config.port}/${config.database}`;
}

function helpers(client) {
  return {
    async all(sql, params) { return (await client.query(sql, toParams(params))).rows; },
    async get(sql, params) { return (await client.query(sql, toParams(params))).rows[0] || null; },
    async run(sql, params) {
      const r = await client.query(sql, toParams(params));
      return { rowCount: r.rowCount, rows: r.rows };
    },
  };
}

// Default: the whole portal schema in one database (tests, local use). In
// production each project has its own database and server.js passes the files
// that belong to it.
const DEFAULT_SCHEMA_FILES = ['schema.sql', 'hub_schema.sql'];
// Any constant works; it only has to be the same in every process.
const SCHEMA_LOCK = 4823501;

// BEGIN ... COMMIT on one client, rolled back if anything in `fn` throws.
async function transaction(client, fn) {
  await client.query('BEGIN');
  try {
    const result = await fn(helpers(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

module.exports = async function createDb(options = {}) {
  const env = options.env || process.env;
  const config = { ...connectionConfig(env), ...(options.config || {}) };
  if (!config.connectionString && !config.database) {
    throw new Error('No database configured: set DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (PostgreSQL).');
  }
  const direct = schemaConfig(env);
  const pool = new Pool(config);
  // An idle client that loses its connection (database restart, network blip,
  // Neon suspending an idle compute) emits 'error' on the pool; unhandled,
  // that would take the process down. The pool has already dropped it.
  pool.on('error', (err) => console.error('PostgreSQL idle client error:', err.message));

  async function tx(fn) {
    const client = await pool.connect();
    // While a client is checked out the pool stops listening for its errors,
    // and an 'error' nobody listens for ends the process. A connection the
    // server drops between two statements of a transaction does exactly
    // that, so listen here, and hand a dead client back to be destroyed
    // rather than reused.
    let lost;
    const onError = (err) => { lost = err; };
    client.on('error', onError);
    try {
      return await transaction(client, fn);
    } finally {
      client.removeListener('error', onError);
      client.release(lost);
    }
  }

  // Create any missing tables. Serialised with an advisory lock: two app
  // processes starting at once would otherwise both try to create the same
  // table, and IF NOT EXISTS does not stop that race in PostgreSQL. The lock
  // is transaction-scoped, so it is safe even through PgBouncer, but with
  // DATABASE_URL_UNPOOLED set all of it goes over the direct connection.
  const schema = (options.schemaFiles || DEFAULT_SCHEMA_FILES)
    .map((f) => fs.readFileSync(path.join(__dirname, 'sql', f), 'utf8')).join('\n');
  const applySchema = async (q) => {
    await q.run('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
    await q.run(schema);
  };
  try {
    if (direct) {
      const client = new Client(direct);
      client.on('error', () => {}); // a lost connection fails the query below instead
      await client.connect();
      try {
        await transaction(client, applySchema);
      } finally {
        await client.end().catch(() => {});
      }
    } else {
      await tx(applySchema);
    }
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
  if (!options.quiet) {
    console.log(`Database: PostgreSQL ${describe(config)}${direct ? ` (tables set up over ${describe(direct)})` : ''}`);
  }

  return { ...helpers(pool), tx, end: () => pool.end() };
};

module.exports.connectionConfig = connectionConfig;
module.exports.schemaConfig = schemaConfig;
