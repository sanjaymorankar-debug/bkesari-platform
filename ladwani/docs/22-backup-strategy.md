# Phase 5 — Backup Strategy

> **Database: PostgreSQL since 2026-10-24.** This document was written for MySQL 8.
> The app now runs on PostgreSQL (Neon in the hosted tiers). Read MySQL-specific
> commands here (mysqldump, phpMyAdmin, InnoDB settings) as their PostgreSQL
> equivalents (pg_dump/pg_restore, the Neon console, Neon branches and restore);
> `docs/26-local-testing.md` describes what changed in the code.

## 1. What Needs Backing Up

- **MySQL database** — the only stateful store this app has. Everything else (built frontend/backend artifacts, uploaded-file bytes once real object storage is wired in) is either reproducible from source or lives in externally-durable storage (R2).
- **Uploaded file bytes**, once `apps/api/src/uploads` is pointed at a real `FileStorage` provider — R2's own durability/versioning covers this; it is explicitly not something this app's backup job needs to touch.

## 2. Database Backup

```bash
mysqldump --single-transaction --routines --triggers \
  -u <user> -p<password> -h <host> community_platform \
  | gzip > "backup-$(date +%Y%m%d-%H%M%S).sql.gz"
```

- `--single-transaction` takes a consistent snapshot on InnoDB tables without locking the whole database — safe to run against a live site.
- Run on a daily cron (Hostinger's own cron job scheduler, or an external one hitting a protected backup-trigger endpoint if the host doesn't allow shell cron) with a retention window of **30 daily + 12 monthly** snapshots, uploaded off-host immediately after each dump completes (R2 or another provider — never left only on the same disk as the live database).
- Encrypt at rest if the storage target doesn't already (dumps contain full PII — member details, financial ledger, matrimony profiles).

## 3. Restore Procedure

```bash
gunzip < backup-20260901-020000.sql.gz | mysql -u <user> -p<password> -h <host> community_platform_restore
```

Always restore into a **freshly named database** first, never directly over the live one — verify row counts and a handful of spot-checked records (a known family, a known payment transaction) before ever pointing the app at the restored copy. Practice this quarterly against a throwaway database; a backup nobody has ever restored is not a tested backup.

## 4. Recovery Point / Recovery Time Targets

Given this is a community platform (not a financial exchange), a **24-hour RPO** (daily backup) is reasonable for most data. The financial ledger and payment/refund records are the exception worth calling out: because every payment transaction records the gateway's own order/payment IDs (`payment_gateway_transactions`), a lost day of financial activity is *reconcilable* against Razorpay's own dashboard/API even in the worst case — the reconciliation job in `payments.service.ts` already exists to catch exactly this kind of drift. RTO is bounded by how fast a fresh MySQL instance can be provisioned and a dump restored — typically well under an hour for this data volume.

## 5. What This Build Does Not Yet Automate

There is no backup job wired into this repo or CI — the commands above are documented, not scheduled. Standing up the actual cron (or Hostinger's scheduled-task equivalent) and the off-host upload step is an infrastructure action against the live host, which — like the cutover itself (`23-production-cutover-plan.md`) — should happen with its own explicit go-ahead rather than being assumed as part of this milestone's code changes.
