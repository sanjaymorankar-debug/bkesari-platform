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
