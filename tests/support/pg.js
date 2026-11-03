'use strict';

/**
 * Each PostgreSQL test file works in a schema of its own on TEST_DATABASE_URL,
 * so files that run at the same time (node --test runs files in parallel)
 * never drop each other's tables. The schema is wiped at the start of the
 * file; nothing outside it is touched.
 */
const { Client } = require('pg');

const URL_ = process.env.TEST_DATABASE_URL;
const skip = URL_ ? false : 'TEST_DATABASE_URL is not set (point it at a PostgreSQL database this test may wipe)';

/** A fresh, empty schema named t_<name>, and a connection string whose search_path is it. */
async function freshSchema(name) {
  const schema = `t_${name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
  const c = new Client({ connectionString: URL_ });
  await c.connect();
  try {
    await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await c.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await c.end();
  }
  const u = new URL(URL_);
  u.searchParams.set('options', `-c search_path=${schema}`);
  return { schema, url: u.toString() };
}

module.exports = { URL_, skip, freshSchema };
