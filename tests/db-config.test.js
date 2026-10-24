/**
 * How portal/db.js turns the environment into connection settings, for the
 * strings Neon hands out (docs/NEON.md) as well as a local database. No
 * database needed: this is about what would be sent, not about sending it.
 *
 * The Neon strings end in ?sslmode=require&channel_binding=require. Both have
 * to survive the trip into node-postgres: TLS must stay on (and verified)
 * without DB_SSL, and channel binding must not be silently dropped.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('pg-connection-string');

const { connectionConfig, schemaConfig } = require('../portal/db.js');

const POOLED = 'postgresql://portal_app:pw@ep-cool-name-123-pooler.eu-central-1.aws.neon.tech/portal?sslmode=require&channel_binding=require';
const DIRECT = 'postgresql://portal_app:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/portal?sslmode=require&channel_binding=require';

test('a Neon URL is used as given, with TLS on and verified, and no DB_SSL', () => {
  const config = connectionConfig({ DATABASE_URL: POOLED });
  assert.equal(config.connectionString, POOLED, 'the URL reaches pg unchanged');
  // pg merges what it parses from the URL over the rest of the config, so the
  // URL's sslmode is what decides TLS. Parse it the way pg does.
  const fromUrl = parse(config.connectionString);
  assert.equal(typeof fromUrl.ssl, 'object', 'sslmode=require turns TLS on');
  assert.notEqual(fromUrl.ssl.rejectUnauthorized, false, 'and does not switch certificate checks off');
  assert.equal(config.ssl, undefined, 'nothing from DB_SSL, which was not set');
  // And what pg itself resolves from the whole config, the explicit
  // `ssl: undefined` included: the URL's sslmode must win over it.
  const ConnectionParameters = require('pg/lib/connection-parameters');
  const resolved = new ConnectionParameters(config);
  assert.ok(resolved.ssl, 'pg would connect without TLS');
  assert.notEqual(resolved.ssl.rejectUnauthorized, false);
});

test('channel_binding=require turns channel binding on', () => {
  // pg ignores channel_binding in a URL; enableChannelBinding is what it reads.
  assert.equal(connectionConfig({ DATABASE_URL: POOLED }).enableChannelBinding, true);
  const local = 'postgresql://bk_portal:pw@127.0.0.1:5432/bk_portal';
  assert.equal(connectionConfig({ DATABASE_URL: local }).enableChannelBinding, undefined);
  assert.equal(connectionConfig({ DATABASE_URL: `${local}?channel_binding=disable` }).enableChannelBinding, undefined);
});

test('a cold start has time to connect, but a dead database does not hang for ever', () => {
  // Neon suspends an idle compute; the first connection after that wakes it,
  // which takes a few seconds. pg's default is no limit at all.
  const ms = connectionConfig({ DATABASE_URL: POOLED }).connectionTimeoutMillis;
  assert.ok(ms >= 10000 && ms <= 60000, `connect timeout is ${ms} ms`);
  assert.equal(schemaConfig({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT }).connectionTimeoutMillis, ms);
});

test('the schema goes over DATABASE_URL_UNPOOLED when it is set, and the app stays on the pooled URL', () => {
  assert.equal(schemaConfig({ DATABASE_URL: POOLED }), null, 'unset: the pool does it');
  const direct = schemaConfig({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT });
  assert.equal(direct.connectionString, DIRECT);
  assert.equal(direct.enableChannelBinding, true);
  assert.equal(connectionConfig({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT }).connectionString, POOLED);
  // Beside the DB_* settings it could name another database than the app uses.
  assert.equal(schemaConfig({ DB_NAME: 'bk_portal', DATABASE_URL_UNPOOLED: DIRECT }), null);
});

test('the DB_* settings still work without a URL, with DB_SSL for TLS', () => {
  const config = connectionConfig({
    DB_HOST: 'db.example', DB_PORT: '5433', DB_NAME: 'bk_portal', DB_USER: 'bk_portal', DB_PASSWORD: 'pw', DB_SSL: 'require',
  });
  assert.equal(config.connectionString, undefined);
  assert.deepEqual([config.host, config.port, config.database, config.user], ['db.example', 5433, 'bk_portal', 'bk_portal']);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.deepEqual(connectionConfig({ DB_NAME: 'x', DB_SSL: 'no-verify' }).ssl, { rejectUnauthorized: false });
  assert.equal(connectionConfig({ DB_NAME: 'x' }).ssl, undefined);
});
