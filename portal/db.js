const fs = require('fs');
const path = require('path');

/* ============================================================
   Thin database adapter so the same SQL runs on:
   - MySQL  (DB_CLIENT=mysql)  -> Hostinger production
   - SQLite (DB_CLIENT=sqlite) -> local, zero-setup (node:sqlite)
   Both expose: all(sql, params), get(sql, params), run(sql, params)
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
  };
}

async function createSqlite() {
  const { DatabaseSync } = require('node:sqlite');
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
  };
}

module.exports = async function createDb() {
  const client = (process.env.DB_CLIENT || 'sqlite').toLowerCase();
  if (client === 'mysql') return createMysql();
  if (client === 'sqlite') return createSqlite();
  throw new Error(`Unknown DB_CLIENT "${client}" (use mysql or sqlite)`);
};
