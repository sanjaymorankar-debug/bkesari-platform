const fs = require('fs');
const path = require('path');

/* ============================================================
   Thin database adapter so the same SQL runs on:
   - MySQL  (DB_CLIENT=mysql)  -> Hostinger production
   - SQLite (DB_CLIENT=sqlite) -> local, zero-setup (node:sqlite)
   Both expose: all(sql, params), get(sql, params), run(sql, params)
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
  const client = (process.env.DB_CLIENT || 'sqlite').toLowerCase();
  if (client === 'mysql') return createMysql();
  if (client === 'sqlite') return createSqlite();
  throw new Error(`Unknown DB_CLIENT "${client}" (use mysql or sqlite)`);
};
