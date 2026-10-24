/**
 * The Neon wiring that can be tested without a Neon account: who the Task
 * Tracker lets in, the Express <-> Fetch bridge under the Neon Auth proxy,
 * and the object key each ATIP snapshot is archived under.
 *
 * The services themselves (sign-in, Realtime, the report Function, the
 * bucket) need a live branch; DEPLOY.md's Neon section lists how they were
 * checked end to end.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const neonAuth = require('../portal/neon-auth.js');
const storage = require('../portal/storage.js');

const allowed = new Set(['asha@example.com']);

test('decide: no session signs in, unverified verifies, unlisted is denied', () => {
  assert.equal(neonAuth.decide(null, allowed), 'signin');
  assert.equal(neonAuth.decide({ email: 'asha@example.com', emailVerified: false }, allowed), 'verify');
  assert.equal(neonAuth.decide({ email: 'ravi@example.com', emailVerified: true }, allowed), 'denied');
  assert.equal(neonAuth.decide({ email: 'asha@example.com', emailVerified: true }, allowed), 'allow');
});

test('decide: an allowed address that is not verified is still not let in', () => {
  // Anyone can create an account with any address, so the allow-list alone
  // would admit a stranger who signed up as someone on it.
  assert.equal(neonAuth.decide({ email: 'asha@example.com', emailVerified: false }, allowed), 'verify');
});

test('decide: email comparison ignores case', () => {
  assert.equal(neonAuth.decide({ email: 'Asha@Example.COM', emailVerified: true }, allowed), 'allow');
});

test('allowedEmails: comma or whitespace separated, lower-cased; unset admits nobody', (t) => {
  const saved = process.env.TRACKER_ALLOWED_EMAILS;
  t.after(() => {
    if (saved === undefined) delete process.env.TRACKER_ALLOWED_EMAILS;
    else process.env.TRACKER_ALLOWED_EMAILS = saved;
  });
  process.env.TRACKER_ALLOWED_EMAILS = ' Asha@example.com,ravi@example.com\n  meera@example.com ';
  assert.deepEqual([...neonAuth.allowedEmails()], ['asha@example.com', 'ravi@example.com', 'meera@example.com']);
  delete process.env.TRACKER_ALLOWED_EMAILS;
  assert.equal(neonAuth.allowedEmails().size, 0);
  assert.equal(neonAuth.decide({ email: 'asha@example.com', emailVerified: true }, neonAuth.allowedEmails()), 'denied');
});

test('toFetchRequest: absolute URL, forwarded scheme, headers and a raw body', async () => {
  const body = Buffer.from('{"email":"a@b.c"}');
  const req = {
    method: 'POST',
    originalUrl: '/api/auth/sign-in/email?x=1',
    protocol: 'http',
    headers: { host: 'dev.bkesari.com', 'x-forwarded-proto': 'https', cookie: 'a=1; b=2', 'content-type': 'application/json' },
  };
  const r = neonAuth.toFetchRequest(req, body);
  assert.equal(r.url, 'https://dev.bkesari.com/api/auth/sign-in/email?x=1');
  assert.equal(r.method, 'POST');
  assert.equal(r.headers.get('cookie'), 'a=1; b=2');
  assert.equal(await r.text(), '{"email":"a@b.c"}');
});

test('toFetchRequest: a GET carries no body even if one was parsed', () => {
  const req = { method: 'GET', originalUrl: '/tasks/', protocol: 'http', headers: { host: 'localhost:3000' } };
  const r = neonAuth.toFetchRequest(req, Buffer.from('ignored'));
  assert.equal(r.url, 'http://localhost:3000/tasks/');
  assert.equal(r.body, null);
});

test('writeFetchResponse: each Set-Cookie stays separate, Expires commas included', async () => {
  // Joining them with commas would split "Expires=Thu, 01 Jan 1970" in two,
  // which is how a sign-out that should clear cookies silently fails to.
  const headers = new Headers({ 'content-type': 'application/json', 'content-length': '999' });
  headers.append('set-cookie', 'a=1; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  headers.append('set-cookie', 'b=2; Path=/; HttpOnly');
  const sent = {};
  const res = {
    status(code) { sent.status = code; return this; },
    setHeader(name, value) { sent[name.toLowerCase()] = value; },
    send(buf) { sent.body = buf.toString(); },
  };
  await neonAuth.writeFetchResponse(res, new Response('{"ok":true}', { status: 201, headers }));
  assert.equal(sent.status, 201);
  assert.deepEqual(sent['set-cookie'], ['a=1; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'b=2; Path=/; HttpOnly']);
  assert.equal(sent['content-type'], 'application/json');
  assert.equal(sent['content-length'], undefined, 'Express computes the length of the body it sends');
  assert.equal(sent.body, '{"ok":true}');
});

test('snapshotKey: dated folder, digits-only file name, nothing else from the input', () => {
  assert.equal(storage.snapshotKey('2026-10-24', '2026-10-24 15:23:34'), 'atip-snapshots/2026-10-24/20261024152334.html');
  assert.equal(storage.snapshotKey(null, '2026-10-24 15:23:34'), 'atip-snapshots/undated/20261024152334.html');
  // trade_date comes from the uploader: a path in it must not reach the key.
  assert.equal(storage.snapshotKey('../../etc', '2026-10-24 15:23:34'), 'atip-snapshots/undated/20261024152334.html');
});
