/**
 * The Neon wiring that can be tested without a Neon account: the object key
 * each ATIP snapshot is archived under, and TaskList's live-refresh client.
 * (Neon Auth, the old shared bkesari ID, was retired on 3 Nov 2026: every
 * project signs its own people in. Its tests went with it.)
 *
 * The services themselves (Realtime, the report Function, the bucket) need a
 * live branch; DEPLOY.md's Neon section lists how they were checked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../portal/storage.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');


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

test('live.js: with Realtime off (a 404 from /live) it opens no WebSocket and reports nothing', async () => {
  // The built bundle the page loads, not the source: what the browser runs.
  let sockets = 0;
  const listeners = [];
  const ctx = {
    TextEncoder, TextDecoder, setTimeout, clearTimeout, console, queueMicrotask, crypto: globalThis.crypto,
    WebSocket: class { constructor() { sockets++; throw new Error('no WebSocket expected'); } },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = (...a) => listeners.push(a);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../portal/public/tasklist/live.js'), 'utf8'), ctx);
  const watcher = await ctx.bkLive.watchTracker({
    fetchLive: async () => null, // what tasklist/app.js passes on for a 404
    onChange: () => assert.fail('onChange called'),
    onStatus: (s) => assert.fail(`onStatus(${s}) called`),
  });
  assert.equal(watcher, null);
  assert.equal(sockets, 0);
  assert.equal(listeners.length, 0);
});
