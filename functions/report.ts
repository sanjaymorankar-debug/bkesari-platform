// Neon Function `report`: the Task Tracker's last-seven-days figures,
// computed next to the database it reads (the branch's DATABASE_URL, which
// Neon injects -- the same database the portal's tables live in).
//
// Called only by the portal's server (/tasks/api/report), never by a browser:
// the function URL is public, so it answers 401 unless the request carries
// the server-only ORIGIN_SECRET in X-Secret. That check runs before anything
// touches Postgres. See Neon's "trusted app server" pattern.
import { timingSafeEqual } from "node:crypto";
import { attachDatabasePool } from "@neon/functions";
import { Pool } from "pg";

const originSecret = process.env.ORIGIN_SECRET;
if (!originSecret) throw new Error("ORIGIN_SECRET is required");
const expected = Buffer.from(originSecret);

// Module scope: one small pool per isolate, reused across requests.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

function hasOriginSecret(request: Request): boolean {
  const header = request.headers.get("x-secret");
  if (header === null) return false;
  const provided = Buffer.from(header);
  return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

// Dates in the tracker are IST calendar days; timestamps are stored in UTC.
const REPORT_SQL = `
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d)
  SELECT
    (SELECT COUNT(*)::int FROM comments
       WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '7 days') AS updates_7d,
    (SELECT COUNT(*)::int FROM tasks, today
       WHERE status = 'Completed' AND actual_end > today.d - 7) AS completed_7d,
    (SELECT COUNT(*)::int FROM tasks, today
       WHERE planned_end < today.d AND status NOT IN ('Completed', 'Cancelled')) AS overdue_tasks,
    (SELECT COUNT(*)::int FROM projects, today
       WHERE planned_end < today.d AND status NOT IN ('Completed', 'Cancelled')) AS overdue_projects,
    (SELECT d::text FROM today) AS today`;

export default {
  async fetch(request: Request): Promise<Response> {
    if (!hasOriginSecret(request)) return new Response("Unauthorized", { status: 401 });
    try {
      const { rows } = await pool.query(REPORT_SQL);
      return Response.json({ ...rows[0], branch: process.env.NEON_BRANCH ?? null });
    } catch (err) {
      // 42P01: the portal has not started against this database yet, so its
      // tables do not exist. Say so rather than a bare 500.
      if ((err as { code?: string }).code === "42P01") {
        return Response.json({ error: "The tracker tables do not exist yet" }, { status: 503 });
      }
      throw err;
    }
  },
};
