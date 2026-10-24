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

/** Newest first, each with a link that works for an hour without credentials. */
async function listSnapshots(limit = 30) {
  const { ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const { Contents = [] } = await client().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
  const newest = Contents.sort((a, b) => (a.Key < b.Key ? 1 : -1)).slice(0, limit);
  return Promise.all(newest.map(async (item) => ({
    key: item.Key,
    size: item.Size,
    url: await getSignedUrl(client(), new GetObjectCommand({ Bucket: BUCKET, Key: item.Key }), { expiresIn: 3600 }),
  })));
}

module.exports = { enabled, archiveSnapshot, listSnapshots, snapshotKey, BUCKET };
