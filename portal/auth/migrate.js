/**
 * Applies portal/sql/auth/<dialect>/NNN_*.sql in order, once each, and records
 * them in auth_schema_migrations. Safe to run on every start.
 */
const fs = require('fs');
const path = require('path');
const { nowUtc } = require('./util');

function statements(sql) {
  return sql
    .split(';')
    .map(s => s.trim())
    // A chunk that is only comments is an empty query to MySQL.
    .filter(s => s.split('\n').some(line => line.trim() && !line.trim().startsWith('--')));
}

async function migrate(db, { log = console } = {}) {
  const dir = path.join(__dirname, '..', 'sql', 'auth', db.dialect);
  await db.exec(`CREATE TABLE IF NOT EXISTS auth_schema_migrations (
    version VARCHAR(100) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL
  )`);
  const done = new Set((await db.all('SELECT version FROM auth_schema_migrations')).map(r => r.version));
  const files = fs.readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    for (const stmt of statements(fs.readFileSync(path.join(dir, file), 'utf8'))) await db.exec(stmt);
    await db.run('INSERT INTO auth_schema_migrations (version, applied_at) VALUES (?, ?)', [file, nowUtc()]);
    applied.push(file);
    log.log(`auth migration applied: ${file}`);
  }
  return applied;
}

module.exports = { migrate, statements };
