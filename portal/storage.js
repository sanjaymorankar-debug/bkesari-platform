/* ============================================================
   Neon Object Storage: an archive of every ATIP snapshot.

   The database keeps only the newest snapshot (server.js prunes the rest on
   each upload). With storage configured, each upload is also written to the
   `assets` bucket declared in neon.ts, so earlier days stay retrievable:
     atip-snapshots/<trade date>/<received at>.html

   On when AWS_ENDPOINT_URL_S3 is set -- `neon deploy` writes it, with
   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION, which the AWS SDK
   reads itself. Neon's storage guidance offers the Files SDK or the AWS S3
   client; this is the S3 client, because the Files SDK would add React and an
   MCP SDK to a production install for no use here. Neon requires path-style
   addressing, hence forcePathStyle.
   ============================================================ */

const BUCKET = process.env.STORAGE_BUCKET || 'assets';
const PREFIX = 'atip-snapshots/';

function enabled() {
  return Boolean(process.env.AWS_ENDPOINT_URL_S3);
}

let s3;
function client() {
  if (!s3) {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3 = new S3Client({ forcePathStyle: true });
  }
  return s3;
}

/** The object key for one snapshot. Only [0-9A-Za-z-] from the inputs reach it. */
function snapshotKey(tradeDate, receivedAt) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(tradeDate || '')) ? tradeDate : 'undated';
  const stamp = String(receivedAt).replace(/[^0-9]/g, '').slice(0, 14);
  return `${PREFIX}${day}/${stamp}.html`;
}

async function archiveSnapshot({ html, tradeDate, receivedAt }) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const key = snapshotKey(tradeDate, receivedAt);
  await client().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: html, ContentType: 'text/html; charset=utf-8',
  }));
  return key;
}

/** Every object and sub-folder a listing returns, following S3's 1000-key pages. */
async function listAll(send, input) {
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const out = { contents: [], prefixes: [] };
  let token;
  do {
    const page = await send(new ListObjectsV2Command({ ...input, ContinuationToken: token }));
    out.contents.push(...(page.Contents || []));
    out.prefixes.push(...(page.CommonPrefixes || []).map((p) => p.Prefix));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/**
 * The `limit` most recently received snapshots, newest first.
 *
 * One listing of the whole prefix is not enough: S3 returns at most 1000 keys
 * per call, in ascending key order, and the uploader runs every 5 minutes, so
 * after about three and a half days a single call returned only the OLDEST
 * snapshots and the list stopped changing. Instead this lists the trade-date
 * folders, reads the newest ones until it has enough, adds the undated folder,
 * and orders by the received-at stamp in the file name (an "undated" key sorts
 * after every date, so ordering by the key put those first whatever their age).
 */
async function newestSnapshots(send, limit) {
  const undated = `${PREFIX}undated/`;
  const { prefixes } = await listAll(send, { Bucket: BUCKET, Prefix: PREFIX, Delimiter: '/' });
  const found = prefixes.includes(undated) ? (await listAll(send, { Bucket: BUCKET, Prefix: undated })).contents : [];
  let dated = 0;
  for (const day of prefixes.filter((p) => p !== undated).sort().reverse()) {
    if (dated >= limit) break;
    const { contents } = await listAll(send, { Bucket: BUCKET, Prefix: day });
    found.push(...contents);
    dated += contents.length;
  }
  const stamp = (key) => key.slice(key.lastIndexOf('/') + 1);
  return found
    .sort((a, b) => (stamp(b.Key) > stamp(a.Key) ? 1 : stamp(b.Key) < stamp(a.Key) ? -1 : (b.Key > a.Key ? 1 : -1)))
    .slice(0, limit);
}

/** Newest first, each with a link that works for an hour without credentials. */
async function listSnapshots(limit = 30) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const newest = await newestSnapshots((command) => client().send(command), limit);
  return Promise.all(newest.map(async (item) => ({
    key: item.Key,
    size: item.Size,
    url: await getSignedUrl(client(), new GetObjectCommand({ Bucket: BUCKET, Key: item.Key }), { expiresIn: 3600 }),
  })));
}

module.exports = { enabled, archiveSnapshot, listSnapshots, newestSnapshots, snapshotKey, BUCKET };
