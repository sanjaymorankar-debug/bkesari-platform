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

// A stand-in for S3's ListObjectsV2: keys in ascending order, at most 1000 per
// page, CommonPrefixes when a Delimiter is given -- the behaviour the archive
// listing has to cope with.
function fakeS3(keys) {
  const sorted = [...keys].sort();
  const calls = [];
  const send = async (command) => {
    const { Prefix = '', Delimiter, ContinuationToken } = command.input;
    calls.push(command.input);
    const entries = [];
    for (const key of sorted) {
      if (!key.startsWith(Prefix)) continue;
      const rest = key.slice(Prefix.length);
      const cut = Delimiter ? rest.indexOf(Delimiter) : -1;
      const entry = cut >= 0 ? { prefix: Prefix + rest.slice(0, cut + 1) } : { key };
      const last = entries[entries.length - 1];
      if (entry.prefix && last && last.prefix === entry.prefix) continue;
      entries.push(entry);
    }
    const start = ContinuationToken ? Number(ContinuationToken) : 0;
    const page = entries.slice(start, start + 1000);
    const truncated = start + 1000 < entries.length;
    return {
      Contents: page.filter((e) => e.key).map((e) => ({ Key: e.key, Size: 1 })),
      CommonPrefixes: page.filter((e) => e.prefix).map((e) => ({ Prefix: e.prefix })),
      IsTruncated: truncated,
      NextContinuationToken: truncated ? String(start + 1000) : undefined,
    };
  };
  return { send, calls };
}

test('newestSnapshots: the newest uploads, even past S3\'s 1000-key page', async () => {
  // Ten days of uploads every 5 minutes: 2880 keys. A single listing returns
  // the oldest 1000, which is what the archive page showed after 3.5 days.
  const keys = [];
  for (let day = 1; day <= 10; day++) {
    const d = `2026-10-${String(day).padStart(2, '0')}`;
    for (let m = 0; m < 24 * 60; m += 5) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      keys.push(storage.snapshotKey(d, `${d} ${hh}:${mm}:00`));
    }
  }
  const { send } = fakeS3(keys);
  const newest = await storage.newestSnapshots(send, 30);
  assert.equal(newest.length, 30);
  assert.equal(newest[0].Key, 'atip-snapshots/2026-10-10/20261010235500.html');
  assert.equal(newest[29].Key, 'atip-snapshots/2026-10-10/20261010213000.html');
});

test('newestSnapshots: an old undated snapshot does not jump ahead of newer dated ones', async () => {
  const keys = [
    storage.snapshotKey(null, '2026-10-01 09:00:00'),
    storage.snapshotKey('2026-10-23', '2026-10-23 10:00:00'),
    storage.snapshotKey('2026-10-24', '2026-10-24 10:00:00'),
    storage.snapshotKey(null, '2026-10-24 11:00:00'),
  ];
  const newest = await storage.newestSnapshots(fakeS3(keys).send, 3);
  assert.deepEqual(newest.map((o) => o.Key), [
    'atip-snapshots/undated/20261024110000.html',
    'atip-snapshots/2026-10-24/20261024100000.html',
    'atip-snapshots/2026-10-23/20261023100000.html',
  ]);
});
