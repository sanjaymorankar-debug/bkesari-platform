const fs = require('fs');
const path = require('path');

/* ============================================================
   Thin database adapter so the same SQL runs on:
   - MySQL  (DB_CLIENT=mysql)  -> Hostinger production
   - SQLite (DB_CLIENT=sqlite) -> local, zero-setup (node:sqlite)
   Both expose: all(sql, params), get(sql, params), run(sql, params),
   plus exec(sql) for schema statements, `dialect` and close().

   createDb() with no arguments is the Task Tracker's database, exactly as
   before. The central auth service opens its own connection through
   createDb({ prefix: 'AUTH_', schema: false }): AUTH_DB_* variables, each
   falling back to the matching DB_* one, so the auth tables can live in the
   main database while the tracker keeps its own.
   ============================================================ */

function toParams(params) {
  return (params || []).map(v => (v === undefined ? null : v));
}

// AUTH_DB_HOST, falling back to DB_HOST, falling back to the default.
function setting(env, prefix, name, fallback) {
  const own = prefix ? env[`${prefix}${name}`] : undefined;
  if (own !== undefined && own !== '') return own;
  const shared = env[name];
  if (shared !== undefined && shared !== '') return shared;
  return fallback;
}

async function createMysql({ env, prefix, schema }) {
  const mysql = require('mysql2/promise');
  const cfg = {
    host: setting(env, prefix, 'DB_HOST', 'localhost'),
    port: Number(setting(env, prefix, 'DB_PORT', 3306)),
    database: setting(env, prefix, 'DB_NAME'),
    user: setting(env, prefix, 'DB_USER'),
    password: setting(env, prefix, 'DB_PASSWORD'),
  };
  const pool = mysql.createPool({
    ...cfg,
    connectionLimit: 5,
    dateStrings: true, // keep DATE/DATETIME as plain strings, no timezone shifting
    timezone: 'Z',
    charset: 'utf8mb4',
  });

  if (schema) {
    const sql = fs.readFileSync(path.join(__dirname, 'sql', 'mysql_schema.sql'), 'utf8');
    for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
  }
  console.log(`Database${prefix ? ` (${prefix.replace(/_$/, '').toLowerCase()})` : ''}: MySQL ${cfg.user}@${cfg.host}/${cfg.database}`);

  return {
    dialect: 'mysql',
    async all(sql, params) { const [rows] = await pool.query(sql, toParams(params)); return rows; },
    async get(sql, params) { const [rows] = await pool.query(sql, toParams(params)); return rows[0] || null; },
    async run(sql, params) { const [res] = await pool.query(sql, toParams(params)); return { insertId: res.insertId, changes: res.affectedRows }; },
    async exec(sql) { await pool.query(sql); },
    async close() { await pool.end(); },
  };
}

async function createSqlite({ env, prefix, schema }) {
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
  const configured = setting(env, prefix, 'SQLITE_PATH', './data/tasks.db');
  const file = configured === ':memory:' ? configured : path.resolve(__dirname, configured);
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (schema) db.exec(fs.readFileSync(path.join(__dirname, 'sql', 'sqlite_schema.sql'), 'utf8'));
  console.log(`Database${prefix ? ` (${prefix.replace(/_$/, '').toLowerCase()})` : ''}: SQLite file`, file);

  return {
    dialect: 'sqlite',
    async all(sql, params) { return db.prepare(sql).all(...toParams(params)); },
    async get(sql, params) { return db.prepare(sql).get(...toParams(params)) || null; },
    async run(sql, params) { const r = db.prepare(sql).run(...toParams(params)); return { insertId: Number(r.lastInsertRowid), changes: r.changes }; },
    async exec(sql) { db.exec(sql); },
    async close() { db.close(); },
  };
}

module.exports = async function createDb({ env = process.env, prefix = '', schema = true } = {}) {
  const client = String(setting(env, prefix, 'DB_CLIENT', 'sqlite')).toLowerCase();
  if (client === 'mysql') return createMysql({ env, prefix, schema });
  if (client === 'sqlite') return createSqlite({ env, prefix, schema });
  throw new Error(`Unknown ${prefix}DB_CLIENT "${client}" (use mysql or sqlite)`);
};
