const fs = require('fs');
const path = require('path');

/* ============================================================
   Thin database adapter so the same SQL runs on:
   - MySQL    (DB_CLIENT=mysql)    -> Hostinger production
   - Postgres (DB_CLIENT=postgres) -> Neon (DATABASE_URL from `neon deploy`)
   - SQLite   (DB_CLIENT=sqlite)   -> local, zero-setup (node:sqlite)
   All expose: all(sql, params), get(sql, params), run(sql, params)
   and close(), which releases the connection pool / file handle.

   The server never calls close() -- it holds one database for the life of the
   process -- but a test opens several, and a MySQL pool keeps the event loop
   alive until it is ended, so without this a test run hangs instead of exiting.
   ============================================================ */

function toParams(params) {
  return (params || []).map(v => (v === undefined ? null : v));
}

async function createMysql() {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: 5,
    dateStrings: true, // keep DATE/DATETIME as plain strings, no timezone shifting
    timezone: 'Z',
    charset: 'utf8mb4',
  });

  const schema = fs.readFileSync(path.join(__dirname, 'sql', 'mysql_schema.sql'), 'utf8');
  for (const stmt of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }
  console.log(`Database: MySQL ${process.env.DB_USER}@${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME}`);

  return {
    async all(sql, params) { const [rows] = await pool.query(sql, toParams(params)); return rows; },
    async get(sql, params) { const [rows] = await pool.query(sql, toParams(params)); return rows[0] || null; },
    async run(sql, params) { const [res] = await pool.query(sql, toParams(params)); return { insertId: res.insertId, changes: res.affectedRows }; },
    async close() { await pool.end(); },
  };
}

/**
 * The app writes MySQL/SQLite-style `?` placeholders; Postgres wants $1, $2, ...
 * A `?` inside a quoted literal is left alone. None of the app's SQL has one,
 * but a status string containing a question mark is one edit away.
 */
function toPgPlaceholders(sql) {
  let n = 0;
  let out = '';
  let quote = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

async function createPostgres() {
  const { Pool, Client, types } = require('pg');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DB_CLIENT=postgres needs DATABASE_URL (`neon deploy` writes it to .env.local)');

  // Match what the other two clients hand back, so the API's JSON is the same
  // on all three: DATE and TIMESTAMP as the plain strings that were written
  // (pg's default is a JS Date, which serialises as "...T05:06:07.000Z"), and
  // COUNT(*) as a number (pg's default for bigint is a string, "3").
  const parsers = {
    1082: (v) => v, // date
    1114: (v) => v, // timestamp without time zone
    20: (v) => Number(v), // int8 / bigint, i.e. COUNT(*)
  };
  const getTypeParser = (oid, format) => parsers[oid] || types.getTypeParser(oid, format);

  // Neon's pooled DATABASE_URL goes through PgBouncer in transaction mode, which
  // is right for the app's queries but not for DDL. Run the schema over the
  // direct connection when there is one.
  const schemaClient = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || url });
  await schemaClient.connect();
  try {
    await schemaClient.query(fs.readFileSync(path.join(__dirname, 'sql', 'postgres_schema.sql'), 'utf8'));
  } finally {
    await schemaClient.end();
  }

  const pool = new Pool({ connectionString: url, max: 5, types: { getTypeParser } });
  const host = new URL(url).hostname;
  console.log(`Database: Postgres ${host}/${new URL(url).pathname.slice(1)}`);

  const query = (sql, params) => pool.query(toPgPlaceholders(sql), toParams(params));
  return {
    async all(sql, params) { return (await query(sql, params)).rows; },
    async get(sql, params) { return (await query(sql, params)).rows[0] || null; },
    async run(sql, params) {
      // Postgres has no LAST_INSERT_ID(); every table here has an `id`, so ask for it.
      const insert = /^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql);
      const res = await query(insert ? `${sql} RETURNING id` : sql, params);
      return { insertId: insert ? res.rows[0].id : undefined, changes: res.rowCount };
    },
    async close() { await pool.end(); },
  };
}

async function createSqlite() {
  // node:sqlite landed in Node 22.5 and is the reason the README asks for 22.13+.
  // SQLite is the DEFAULT client, so on an older Node a bare `npm start` would
  // otherwise die with an unexplained "Cannot find module 'node:sqlite'".
  // Hostinger runs this on MySQL, where any Node >= 20 is fine.
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    throw new Error(
      `The local SQLite client needs Node 22.13+ for node:sqlite (this is ${process.version}). ` +
      'Either upgrade Node, or set DB_CLIENT=mysql with DB_HOST/DB_NAME/DB_USER/DB_PASSWORD.');
  }
  const file = path.resolve(__dirname, process.env.SQLITE_PATH || './data/tasks.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, 'sql', 'sqlite_schema.sql'), 'utf8'));
  console.log('Database: SQLite file', file);

  return {
    async all(sql, params) { return db.prepare(sql).all(...toParams(params)); },
    async get(sql, params) { return db.prepare(sql).get(...toParams(params)) || null; },
    async run(sql, params) { const r = db.prepare(sql).run(...toParams(params)); return { insertId: Number(r.lastInsertRowid), changes: r.changes }; },
    async close() { db.close(); },
  };
}

module.exports = async function createDb() {
  // With DATABASE_URL set (Neon) and no DB_CLIENT, Postgres is the obvious
  // intent; quietly writing to a local SQLite file instead would look like it
  // worked while every change stayed on this one machine.
  const fallback = process.env.DATABASE_URL ? 'postgres' : 'sqlite';
  const client = (process.env.DB_CLIENT || fallback).toLowerCase();
  if (client === 'mysql') return createMysql();
  if (client === 'postgres' || client === 'postgresql') return createPostgres();
  if (client === 'sqlite') return createSqlite();
  throw new Error(`Unknown DB_CLIENT "${client}" (use mysql, postgres or sqlite)`);
};

module.exports.toPgPlaceholders = toPgPlaceholders;
