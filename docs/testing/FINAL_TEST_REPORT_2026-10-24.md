# Final test report: every project on PostgreSQL (Neon), 2026-10-24

All seven projects now run on **PostgreSQL**, ready for **Neon**. Each has its
own **testing agent** with its own specification. After a code change, the
project's agent ran the full standard and regression suites, fixed the
defects it found, and re-ran everything. This report gathers the final
results.

Nothing here touched Neon or any hosted database. Every suite ran against a
throwaway local PostgreSQL 16. The "Neon parity" levels used a local stand-in
for Neon:
- a direct endpoint over TLS with SCRAM;
- a pooled endpoint through PgBouncer 1.22 in transaction mode, TLS required;
- server-side termination of idle connections, as a Neon suspend does;
- each app running as a non-superuser that owns its database and belongs to
  a `neon_superuser` stand-in.

## Summary

| Project | Repository · PR | Agent / spec | Final verdict | Final counts | Defects fixed |
|---|---|---|---|---|---|
| Hub (portal, Task Tracker, ATIP viewer) | bkesari-platform · [#11](https://github.com/sanjaymorankar-debug/bkesari-platform/pull/11) | `portal-tester` · `TEST_SPEC.md` | **PASS** | 67/67 without a database, 82/82 on PostgreSQL, Neon parity 17/17, 20 critical regressions OK | 8 (1 × S1) |
| Education (hub copy, `/edu/`) | bkesari-platform · [#11](https://github.com/sanjaymorankar-debug/bkesari-platform/pull/11) | `edu-tester` · `edu/TEST_SPEC.md` | **PASS** | 423 tests: 418 + 5 PostgreSQL-only skips on SQLite; 423/423 on PostgreSQL and through the pooler; browser smoke 18/18 | 14 (2 × S1) |
| Education (standalone, edutest.agtci.com) | edu · [#6](https://github.com/sanjaymorankar-debug/edu/pull/6) | `edu-standalone-tester` · `TEST_SPEC.md` | **PASS** | 130/130 on PostgreSQL and through the pooler; 60/60 concurrent complaint numbers | 10 |
| Milk & Dairy (`/milk/`) | bkesari · [#18](https://github.com/sanjaymorankar-debug/bkesari/pull/18) | `milk-tester` · `TEST_SPEC.md` | **PASS** | 328/328 (also through the pooler); smoke 27/27; E2E 10/10; idle-termination 27/27 pooled and direct | 10 (3 × S1) |
| LadWani (`main`; handed over) | Ladwani · [#15](https://github.com/sanjaymorankar-debug/Ladwani/pull/15) | `ladwani-tester` · `TEST_SPEC.md` | **PASS** | 332/332; 2,250 pooled queries with 0 errors; smoke 24/24 after idle termination | 5 (1 × S1) |
| ATIP | ATIP-DEV · [#14](https://github.com/sanjaymorankar-debug/ATIP-DEV/pull/14) | `atip-tester` · `TEST_SPEC.md` | **PASS** | 1578 collected: 1565 passed, 13 expected skips, 0 failed; broker/network canary clean | 10 (2 × S1); 2 open |
| agtci.com | agtci · [#7](https://github.com/sanjaymorankar-debug/agtci/pull/7) (base `staging`) | `agtci-tester` · `TEST_SPEC.md` | **PASS** | every level at baseline, run twice; 19 critical regressions OK | 8 |

CI is green on every PR's latest pushed commit, except where the PR list at
the end says otherwise.

Severity scale (the same in every spec):
- S1: data loss, a security hole, money, or the app does not start.
- S2: a feature broken.
- S3: degraded, with a workaround.
- S4: cosmetic or docs.

## How the testing agents work

- Each repository has `.claude/agents/<agent>.md`, the procedure, and
  `TEST_SPEC.md`, the specification. The spec covers scope, environment, the
  standard suite (S levels, including Neon parity), the regression suite
  (R levels, critical regressions and a numeric baseline), pass criteria,
  defect handling and the report format.
- `.claude/hooks/test_gate.py`, wired into each repository's
  `.claude/settings.json`, stops a Claude Code session from finishing while
  code it changed has not been through that project's agent. Agents fix, then
  re-run everything; at most three loops.
- Each run writes `.claude/test-runs/<UTC>-<agent>.md` (git-ignored).
- `docs/TESTING_AGENTS.md` lists every agent. It also describes the one step
  left to you for cloud sessions that open several repositories at once:
  installing the hooks at user level from the environment's setup script.

## Defects found and fixed, by project

### Hub (bkesari-platform, outside `edu/`)
- **S1** A connection dropped by the server in the middle of a transaction
  crashed the whole hub process. `tx()` now keeps an error listener.
- **S2** The Task Tracker page was served **without its login** at
  `/%74asks/`, `//tasks/`, `/shared/../tasks/` and similar paths. The login
  check now runs on the decoded path, before static files.
- **S3** A malformed JSON body, sent before any login, got a stack trace with
  server paths. It now gets a plain 400.
- **S3** An ATIP snapshot without `</head>` showed its order controls (still
  inert under the CSP).
- **S3** body-parser had a DoS advisory; the lockfile now has the fixed
  version.
- **S4** The proxy's 502 page marked the wrong tab.
- Two test defects.
- Neon readiness: tables are created over the direct URL, `channel_binding`
  is honoured, there is a 15 s connect timeout, and the app stops at once
  with "permission denied for schema public" when the `neondb` GRANTs have
  not been run.

### Education, hub copy (bkesari-platform `edu/`)
- **S1** Through Neon's pooler, every migration and multi-statement
  transaction failed (25P02). A one-statement transaction was **silently
  rolled back while reporting success**. The cause was PHP's named prepared
  statements; the app now uses unnamed ones.
- **S1 (docs)** The deploy guide said to seed production, which would have
  created the demo admin with its published password.
- **S2** No file upload worked under `/edu/` (Livewire posted to
  `/edu/edu/...`); fixed by `BasePathSignedUploadUrl`.
- **S2** Every complaint-evidence download answered 500.
- **S2** Complaint numbers collided after a deletion and under concurrency.
  Numbering now takes an advisory lock inside a savepoint, with a retry
  (60/60 under 6 × 10 contention through the pooler).
- **S2** There was no route for migrations over Neon's direct endpoint; it
  now goes through `DB_URL_UNPOOLED`.
- **S3** Two-factor codes could be guessed without limit. They are now
  limited to 5 per account per minute.
- **S3** `channel_binding` was dropped.
- **S3** A session `SET search_path` leaked across pooled connections.
- **S3** Nothing stopped the tests from running against a hosted database.
- **S4** The CSS build differed from machine to machine and lacked classes.
- **S4** Stale docs.

### Education, standalone (edu)
The same Laravel/Neon fixes as the hub copy: unnamed statements, `direct`
endpoint, channel binding, the 2FA throttle, evidence downloads, complaint
numbering, the test host guard, and the CSS rebuild with a CI freshness check.
Also:
- the CI database check could never fail;
- the docs still described MySQL.

### Milk & Dairy (bkesari)
- **S1** **Anonymous visitors received every column of every approved
  shop**, including the encrypted PAN, its last four digits and holder name,
  fee status and referral ids, in `/api/shops` and in the HTML of `/`,
  `/shops` and `/search`. `GET /api/shops/{id}` gave any shop's full row to
  anyone. Public queries now use an allowlist, and the GET route needs the
  owner or an admin.
- **S1** A connection dropped mid-transaction (wallet, checkout,
  subscription) crashed the process.
- **S1** A server-terminated idle connection was an unhandled error.
- **S2** `npm run db:migrate` refused to run without the app's secrets, and
  had no direct-endpoint variable.
- **S2** Anonymous rate limits (grievance filing and lookup, cron) could be
  bypassed by sending a fake `X-Forwarded-For`. With the bypass, anyone who
  knows a complainant's email could read every grievance ticket. The visitor
  is now taken from the right of the chain, past loopback and
  `TRUSTED_PROXIES`, and the cron route checks its token before counting.
- **S3** The stock ledger recorded wrong `previous_units` under concurrent
  orders.
- **S3** `channel_binding` was ignored.
- **S3** `next start` opened several pools.
- One stale end-to-end test.
- Docs.

### LadWani `main` (Ladwani)
- **S1** `NEXTAUTH_URL=.../ladwani` silently switched off next-auth's
  middleware protection.
- **S2** After a Neon suspend, every dead connection failed once with P1017.
- **S2** Three base-path redirect defects, one of them an open redirect via
  `callbackUrl`.

### ATIP (ATIP-DEV)
- **S1** Tests could write into the configured PostgreSQL runtime. On a Mac
  switched to Neon, that would be production. Module- and session-scoped
  fixtures could reach it too. `conftest` now pins SQLite at import.
- **S2** One test made a live Dhan API call when real credentials were
  present.
- **S2** The Mac's LaunchAgent could not see `ATIP_DATABASE_URL`, splitting
  data between SQLite and PostgreSQL.
- **S3** Tests wrote into the checkout's live `atip_data/`.
- **S3** Tests downloaded from nseindia.com. A session-wide offline guard and
  a broker canary now stop that.
- **S3** A pooler could never reuse a connection.
- **S3** The data-move tool could upgrade the target instead of the copy.
- **S3** A generic `DATABASE_URL` was misreported.
- **S4** `/api/ml/regime` answered 500 instead of 404 or 400.
- **CI** A risk-model test demanded agreement beyond double precision and
  failed on GitHub's runner. Its tolerance now scales with the size of the
  terms.

### agtci.com (agtci)
- **S2** A dropped idle connection crashed the process.
- **S2** A query to a compute that was not yet awake waited forever.
- **S2** Migrations would have run DDL through the pooler.
- **S3** `channel_binding` was ignored.
- **S3** `tsc` failed on a fresh clone.
- **S3** Nothing touched the database; a `/api/health` route now does.
- **S4** A `mysql://` URL was accepted by validation.
- **S4** Docs.
- The safety check now also refuses the real Neon database name.

## Neon layout and how to create it

The full guide is [`docs/NEON.md`](../NEON.md). `tools/neon_provision.mjs`
creates the branches, databases and logins through Neon's API. It writes each
tier's `.env` lines and the isolation SQL, and never prints a password.

- **Project:** one Neon project for everything, in an **Asia region**
  (Singapore, `aws-ap-southeast-1`, is Neon's closest region with every
  service). The other session is creating it once you confirm there.
- **Branches:**
  - `production` serves bkesari.com;
  - `test` serves test.bkesari.com;
  - `dev` serves dev.bkesari.com.
- **Databases and logins:**
  - the hub uses `neondb` (Neon Auth lives there) as `bk_portal_app`;
  - `bk_milk`, `bk_edu`, `bk_ladwani`, `bk_atip` and `bk_agtci` are each
    owned by their own `bk_*_app` login;
  - `bk_edu_standalone` exists on `test` only;
  - `bk_env` is created by the other session.
- **Isolation:** every Neon role belongs to `neon_superuser`, which can read
  all data in any database it can connect to. So each database also gets
  `REVOKE CONNECT, TEMPORARY … FROM PUBLIC`, from the generated `<tier>.sql`.
  This was proven on the stand-in: before it, the hub's login read Milk &
  Dairy's tables; after it, the connection is refused.
- **Pooled and direct:** every app uses the pooled URL at runtime and the
  direct URL for migrations. Both URLs keep
  `?sslmode=require&channel_binding=require`. ATIP, one long-running process,
  uses the direct URL only.

## Open items and decisions for you

1. **Confirm the new Neon project in Singapore** in the other session, which
   is waiting on your go-ahead. Nothing holds real data yet, so moving now
   costs nothing. Then run `tools/neon_provision.mjs --project <new id>` and
   copy each block of `~/.bkesari_neon/<tier>.env` into that site's server
   `.env`.
2. **`neondb` lockdown.** The `REVOKE … FROM PUBLIC` for `neondb` stays
   commented out until the other session reports which login Neon Auth and
   the `report` Function use.
3. **Security upgrades (report-only, each needs its own change and a
   re-test):**
   - `next` 16.3.x has critical advisories (Image Optimizer RCE and others)
     in Milk & Dairy and agtci. The fix is `next@16.4.3` with
     `eslint-config-next`.
   - `npm audit fix` covers zod, sharp and source-map-js.
   - Education (both copies): `laravel/framework` 13.26 → 13.30,
     `symfony/http-foundation` (Cache-Control ReDoS, reachable by any
     visitor), `league/commonmark`.
   - ATIP: `kiteconnect`'s transitive advisories.
4. **`TRUSTED_PROXIES` on Milk & Dairy.** Set it to the server's IP after the
   first live deploy confirms the proxy chain (DEPLOYMENT.md, "Trusted
   proxies"). Until then, visitors behind Hostinger's front end share one
   rate-limit bucket: that errs toward over-limiting, never toward a bypass.
5. **ATIP D10.** The interactive pages under `/ATIP/` use root-relative URLs
   and do not work there. This is pre-existing and needs a base-path change.
6. **Hardening, not defects:**
   - The hub parses JSON bodies before its login check.
   - Education keys its login throttle on email plus IP behind proxies.
   - Education accepts a TOTP code again within its 30 s window.
   - agtci's `smoke.mjs` has no database-name guard.
   - LadWani's lint cannot run (an ESLint 9 config next to ESLint 8).
7. **Outside this work, report only:** GoKesari was not touched. It probably
   shares Milk & Dairy's shop-data leak; worth checking.
8. **LadWani** is now with the other session, which is moving the `rebuild`
   branch to PostgreSQL in Ladwani#16. Whether `main` (#15) merges depends on
   which one stays deployed.
9. **agtci tiers.** Confirm which Neon branch each agtci.com tier uses
   (`staging` → `test`?).

## Pull requests (all draft)

- [bkesari-platform#11](https://github.com/sanjaymorankar-debug/bkesari-platform/pull/11): hub, Education (hub copy), the Neon guide and tool, this report.
- [bkesari#18](https://github.com/sanjaymorankar-debug/bkesari/pull/18): Milk & Dairy.
- [edu#6](https://github.com/sanjaymorankar-debug/edu/pull/6): Education, standalone (base `staging`).
- [Ladwani#15](https://github.com/sanjaymorankar-debug/Ladwani/pull/15): LadWani `main` (handed over).
- [ATIP-DEV#14](https://github.com/sanjaymorankar-debug/ATIP-DEV/pull/14): ATIP.
- [agtci#7](https://github.com/sanjaymorankar-debug/agtci/pull/7): agtci.com (base `staging`).
