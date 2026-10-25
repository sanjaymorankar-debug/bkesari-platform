# Phase 5 — Production Cutover Plan

**This document describes the cutover. It does not authorize it.** Per `13-development-roadmap.md` §1a: *"That step gets its own explicit go-ahead when M5 is ready, the same way every other step in this project has."* Nothing in this build has touched `devmiladwani.agtci.com` or its database — this plan is what executing that go-ahead will look like when given, not a record of it having happened.

## 1. What Cutover Means

The live site currently runs a different, working application ("Mi Ladwani") with real registered users and its own database. Cutover replaces it entirely:

1. The old application's database tables are dropped (or the database is recreated) — **this is the irreversible, destructive step** flagged since Phase 1.
2. This build's Prisma migrations are applied to create the new schema from scratch.
3. This build is deployed and brought up in place of the old one.
4. Seed data (`apps/api/prisma/seed.ts`) runs to establish the one Community row, permissions, roles, and starter lookup catalogs.

There is no migration path from the old schema to the new one — Phase 1's decision was a clean start, not a data carryover (roadmap §1: *"Existing data: deleted, not migrated"*).

## 2. Pre-Cutover Checklist

- [ ] All M0–M5 checkpoint reports reviewed and accepted.
- [ ] CI green on the `rebuild` branch's latest commit.
- [ ] A full `mysqldump` of the **old** live database taken and stored off-host, even though it won't be restored into the new app — it's the only copy of the old data once step 1 below runs, and someone may need it later for reference or a manual export to give to old users.
- [ ] Real credentials in hand and set in the production environment: `JWT_SECRET`, `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` (if going live with real payments on day one — otherwise cutover can ship with `PAYMENT_GATEWAY_PROVIDER` unset and switch over later), `WEB_ORIGIN`, `DATABASE_URL`.
- [ ] A maintenance-mode page or equivalent ready to show old-site users during the cutover window.
- [ ] Rollback plan confirmed: the old database dump can be restored and the old application redeployed within the stated RTO if cutover fails partway (see `22-backup-strategy.md` §4).
- [ ] The specific go/no-go confirmation from the project owner, given after reading this document — not implied by any earlier approval in this project.

## 3. Cutover Sequence

```bash
# 1. Freeze writes to the old app (maintenance mode) and take the final backup.
mysqldump --single-transaction -u <user> -p<password> -h <host> old_database | gzip > final-old-backup.sql.gz

# 2. Drop the old schema (or point DATABASE_URL at a freshly created database —
#    preferred, since it sidesteps any leftover-table ambiguity).
mysql -u <user> -p<password> -h <host> -e "DROP DATABASE old_database; CREATE DATABASE community_platform;"

# 3. Apply this build's migrations against the new, empty database.
DATABASE_URL="mysql://.../community_platform" npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# 4. Seed the starter catalogs, permissions, and the one Community row.
DATABASE_URL="mysql://.../community_platform" node apps/api/dist/prisma/seed.js

# 5. Deploy and start this build's API and web processes (21-deployment-guide.md §3).

# 6. Smoke test against production: register, log in, create a family, browse the
#    community feed, list a service, and — if real Razorpay credentials are live —
#    a real ₹1 test payment end to end.

# 7. Point the domain / reverse proxy at the new processes; lift maintenance mode.
```

## 4. Rollback

If step 6's smoke test fails: restore `final-old-backup.sql.gz` into a database, redeploy the old application against it, and repoint the domain back — this is why maintenance mode stays up through step 6, not lifted until the new build is verified. Because step 2 is destructive to the *old* database's live copy, rollback restores from the backup taken in step 1, not from the (now-gone) original tables — this is exactly why that backup is a hard checklist item, not optional.

## 5. Post-Cutover

- Old site's registered users have no accounts in the new system (clean start, per §1) — communicating this transition to them is a product/communications task outside this document's scope, but should happen before, not after, cutover.
- Monitor error logs and the audit log viewer (`/admin/audit-log`) closely for the first 24–48 hours.
- Keep `final-old-backup.sql.gz` retained indefinitely (or per whatever data-retention policy applies) — it is the only remaining record of the old application's data once step 2 runs.
