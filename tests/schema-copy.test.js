/**
 * database/portal/01_portal_schema.sql is the hand-run copy of the schema the
 * portal applies to itself on start (portal/sql/schema.sql). Two copies drift
 * unless something checks them, so this does.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('database/portal/01_portal_schema.sql carries portal/sql/schema.sql unchanged', () => {
  assert.ok(read('database/portal/01_portal_schema.sql').endsWith(read('portal/sql/schema.sql')));
});

test('no MySQL syntax is left in the portal schema', () => {
  const sql = read('portal/sql/schema.sql');
  for (const mysqlOnly of [/AUTO_INCREMENT/i, /ENGINE\s*=/i, /utf8mb4/i, /`/, /DATETIME/i, /MEDIUMTEXT/i]) {
    assert.doesNotMatch(sql, mysqlOnly);
  }
});

test('database/portal/02_hub_schema.sql carries portal/sql/hub_schema.sql unchanged', () => {
  assert.ok(read('database/portal/02_hub_schema.sql').endsWith(read('portal/sql/hub_schema.sql')));
});

test('portal/sql/schema.sql is exactly tasklist_schema.sql plus atip_schema.sql', () => {
  // The app applies the per-project files (server.js openDatabases); the hand-run
  // copy and the tests use schema.sql. Comments aside, they must be the same DDL.
  const ddl = (s) => s.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).join('\n');
  assert.equal(ddl(read('portal/sql/schema.sql')),
    ddl(read('portal/sql/tasklist_schema.sql') + '\n' + read('portal/sql/atip_schema.sql')));
});
