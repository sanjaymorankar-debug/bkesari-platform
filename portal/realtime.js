/* ============================================================
   Neon Realtime: the Task Tracker dashboard refreshes itself when anyone
   changes a project or task (a posted update touches its parent's
   updated_at too).

   The browser subscribes to one sealed live query over the ids and
   updated_at of both tables. It is only a change signal: on a change the
   page re-fetches /tasks/api/overview, which keeps every row's shape and
   all the authorization in the existing API.

   On when NEON_REALTIME_URL and NEON_REALTIME_SECRET are set (`neon deploy`
   writes both) and the database is Postgres. The secret seals queries and
   never leaves the server; the URL is the WebSocket the browser opens.
   ============================================================ */

// Plain columns only: live queries must be deterministic, and `'p' || id`
// is not (text || integer goes through a STABLE cast), so Neon rejects it.
const LIVE_SQL = `SELECT 'p' AS kind, id, updated_at FROM projects
  UNION ALL SELECT 't' AS kind, id, updated_at FROM tasks`;

function enabled() {
  return Boolean(process.env.NEON_REALTIME_URL && process.env.NEON_REALTIME_SECRET && process.env.DATABASE_URL);
}

let server;
async function realtime() {
  if (!server) {
    // ESM-only package; import() works on every Node this repo supports.
    const { createRealtime } = await import('@neon/realtime/server');
    server = createRealtime({
      secret: process.env.NEON_REALTIME_SECRET,
      // The database the live query runs in: the one DATABASE_URL names.
      db: decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)),
    });
  }
  return server;
}

/** A sealed query for the browser, and the WebSocket URL to subscribe on. */
async function sealTrackerChanges() {
  const { rawSql } = await import('@neon/realtime/server');
  const sealed = await (await realtime()).seal({ query: rawSql(LIVE_SQL) });
  return { url: process.env.NEON_REALTIME_URL, sealed };
}

module.exports = { enabled, sealTrackerChanges, LIVE_SQL };
