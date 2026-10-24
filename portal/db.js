const fs = require('fs');
const path = require('path');
const { Pool, types: pgTypes } = require('pg');

/* ============================================================
   PostgreSQL access for the portal (Task Tracker + ATIP snapshot).

   Connection, in order of preference:
     DATABASE_URL  postgresql://user:password@host:5432/dbname
     DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
   DB_SSL=require (or true) turns TLS on, which managed PostgreSQL
   services generally insist on; DB_SSL=no-verify skips certificate checks.

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

function connectionConfig(env = process.env) {
  const common = { max: Number(env.DB_POOL_MAX || 5), ssl: sslOption(env.DB_SSL), types };
  if (env.DATABASE_URL) return { ...common, connectionString: env.DATABASE_URL };
  return {
    ...common,
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  };
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

const SCHEMA_FILE = path.join(__dirname, 'sql', 'schema.sql');
// Any constant works; it only has to be the same in every process.
const SCHEMA_LOCK = 4823501;

module.exports = async function createDb(options = {}) {
  const config = { ...connectionConfig(options.env || process.env), ...(options.config || {}) };
  if (!config.connectionString && !config.database) {
    throw new Error('No database configured: set DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (PostgreSQL).');
  }
  const pool = new Pool(config);
  // An idle client that loses its connection (database restart, network blip)
  // emits 'error' on the pool; unhandled, that would take the process down.
  pool.on('error', (err) => console.error('PostgreSQL idle client error:', err.message));

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(helpers(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Create any missing tables. Serialised with an advisory lock: two app
  // processes starting at once would otherwise both try to create the same
  // table, and IF NOT EXISTS does not stop that race in PostgreSQL.
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  try {
    await tx(async (q) => {
      await q.run('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
      await q.run(schema);
    });
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
  if (!options.quiet) console.log(`Database: PostgreSQL ${describe(config)}`);

  return { ...helpers(pool), tx, end: () => pool.end() };
};

module.exports.connectionConfig = connectionConfig;
