# Testing report — Kesari redesign, 3 Nov 2026

**Date of prompt:** 3 Nov 2026 Time 08:42 AM >
Report written 3 Nov 2026, between 12:30 PM and 01:52 PM (IST, UTC + 5:30). All times below are IST.

- **Change under test:** `bkesari-platform`, branch `claude/confident-goldberg-i9xe8m`, draft PR [sanjaymorankar-debug/bkesari-platform#25](https://github.com/sanjaymorankar-debug/bkesari-platform/pull/25). Commits: dd56117 at 11:16 AM, 70cc39e at 11:43 AM, 981b49f at 12:24 PM, 0c24f83 at 12:42 PM, then the testers' fixes from 5f3c633 (12:44 PM) to 71d3d4a (01:52 PM), and the commit of this report.
- **Where it was tested:** a Linux container: Node 22.23.4, PHP 8.3.6, PostgreSQL 16, Chromium (Playwright), axe-core 4.x, Lighthouse 13.
- **The stack:** the same code the hub site runs (`node portal/server.js`, LadWani's export and API in-process, its own PostgreSQL databases), with throwaway databases.
- **Test and Prod servers:** **this release is not yet deployed to test.bkesari.com or bkesari.com.** §9 explains why, and what testing on them remains.

## 1. Summary

| Area | Result |
|---|---|
| Hub + TaskList + shell + Kesari, automated (R1) | **162 / 162 pass**, 0 skipped, plus **32 / 32** deploy-guard cases (159 at the start; +2 race tests, +1 cookie test) |
| portal-tester (TEST_SPEC.md S1–S7, R1–R4) | **PASS**, twice. On `e7c7ac4` (report `20261103-073944`, 01:09 PM), then on `5010301` after the proxy cookie fix (report `20261103-082002`, 01:50 PM): S1–S7 green; R1 162, S5 42 probes, S6 27, S7 18; 26 / 26 critical regressions |
| LadWani API (Jest) | **252 / 252 pass** in 31 suites; typecheck and lint clean (2 old warnings); static export builds |
| Education (PHPUnit, edu/TEST_SPEC.md) | **473 tests** on SQLite (468 pass, the 5 known skips), PostgreSQL (473 / 473) and through the pooler (473 / 473); smoke through the hub 60 / 0 (HTTP) and 21 / 0 (browser) |
| edu-tester | **PASS** (report `.claude/test-runs/20261103-075722-edu-tester.md`, 01:27 PM): every level S1–S7 green at or above baseline; 5 defects found and fixed (D-22 to D-26) |
| Auth isolation (signing in or out of one project never affects another; cross-project reuse refused) | **Pass**: §3 |
| Role-based access | **Pass**: §4 |
| Responsive, 360 / 768 / 1280 px, EN / MR / HI | **No horizontal scroll on any page**: §5 |
| Accessibility (axe-core, WCAG 2.2 AA) | 134 scans (114 public page × width × language, 20 signed-in): 3 serious violations found, all fixed, **0 left** |
| Lighthouse (mobile) | **Performance 95–100, accessibility 100, best practices 100** on every key page; LCP ≤ 1.2 s; CLS ≤ 0.064: §7 |
| Mobile apps (Android, iOS) | **Not built**: blocked, §8 |
| Test server / Prod server | **Not run on the redesign** (not deployed): §9 |

**Overall: PASS for the code on the branch. Not yet released.** Deploying to test, then prod, then testing there is the remaining step. It needs the owner's go-ahead and the SMS and mail providers (§9).

## 2. Functional tests per flow

| Flow | How tested | Result |
|---|---|---|
| Hub home: 6 tiles with status chips and Open; ATIP opens in a new window; banner | `hub.pg.test.js`; browser | Pass |
| Language EN → मराठी → हिंदी, saved (cookie `k_lang`), the hub rendered in that language on the server | `hub.pg.test.js`; browser | Pass |
| About, Privacy (DPDP), Terms, 404, 500 | `hub.pg.test.js`; browser | Pass |
| Contact: stored; forged token, cross-site, honeypot, <3 s fill and the 6th message in an hour refused; inline errors | `hub.pg.test.js` | Pass |
| Old shared sign-in addresses → "Choose a project"; `/access/*` and `/admin/access` redirect; old APIs 410; `/education/*` → `/edu/*`; `/tasks/*` → `/tasklist/` | `hub.pg.test.js`, `tasklist.pg.test.js` | Pass |
| Hub admin: own login, no sign-up, no OTP, lockout; tiles, banner (EN/MR) and inbox edited and shown at once; audit log | `hub.pg.test.js`; CI smoke step | Pass |
| TaskList sign-up / sign-in by mobile + OTP (code delivered; never echoed when SMS is live; refused on prod with no provider) | `tasklist.pg.test.js`; browser | Pass |
| TaskList email + password: sign-up, verify link, sign-in, 5 failures → 15-minute lock (the right password refused while locked), unknown address answers like a wrong password | `tasklist.pg.test.js` | Pass |
| TaskList forgot / reset: same answer for any address, single-use link, every session ended | `tasklist.pg.test.js` | Pass |
| TaskList quick add (IST dates, times, #tags, @list, !priority, repeat, Marathi/Hindi day words) | `quickadd.test.js` (7), `tasklist.pg.test.js`; browser | Pass |
| TaskList Today, Upcoming (agenda, calendar), Lists, Tags, Search, Completed, Settings | browser (Chromium, 360 / 390 / 1280 px) | Pass |
| TaskList detail: notes, due IST, priority, tags, list, repeat, reminder, sub-tasks, links, status updates; delete | `tasklist.pg.test.js`; browser | Pass |
| TaskList board: drag and drop; keyboard Alt + arrows; order kept after reload | `tasklist.pg.test.js`; browser | Pass (defect TL-D1 fixed) |
| TaskList repeat: completing a weekday task brings the next (Fri → Mon) | `tasklist.pg.test.js` | Pass |
| TaskList offline: banner, queued create synced once on reconnect (`client_id`) | `tasklist.pg.test.js`; browser offline toggle | Pass |
| TaskList download my data; delete my account (only mine goes) | `tasklist.pg.test.js` | Pass |
| ATIP: upload needs the token; newest only; view-only page (own CSP, controls hidden, also without `</head>`) | `hub.pg.test.js` | Pass |
| LadWani: landing, sign-in (OTP / password), sign-up stepper, forgot, verify, pending, family tree with list view | LadWani Jest (incl. a real-HTTP suite); browser; Lighthouse | Pass |
| LadWani in the hub: no gate, no hub token, raw body to the API, path traversal refused, engine thread cap | `ladwani.test.js` (16) | Pass |
| Education: own sign-in (password, mobile + OTP), lockout, `/sign-in` aliases, `/shell/me`, languages | edu suites (§1) | Pass (edu-tester; also under 12 requests sent at once) |
| Migration from the shared ID: dry run changes nothing; `--apply` makes TaskList accounts and hands over the old tracker; safe to re-run | `migrate.pg.test.js` (3) | Pass |

## 3. Auth isolation

| Check | Evidence | Result |
|---|---|---|
| Each project has its own cookie, scoped: `tl_sid` Path=/tasklist, `lw_sid` Path=/ladwani, `edu_sid` Path=/edu, `hub_admin_sid` Path=/; all HttpOnly, SameSite=Lax, Secure except plain-http localhost | `tasklist.pg.test.js` (cookie attributes), `hub.pg.test.js`, `ladwani.test.js`, edu `OwnAccountTest` | Pass |
| A TaskList session opens nothing at the hub admin (401) or ATIP (404) | `tasklist.pg.test.js`; browser e2e | Pass |
| The hub admin's session is no one in TaskList (401) | `tasklist.pg.test.js` | Pass |
| Signing out of TaskList leaves the hub admin signed in, and the other way round | `tasklist.pg.test.js` :: accounts are isolated | Pass |
| A forged session cookie or another project's cookie opens no TaskList page or API, however the path is spelled | `server.test.js` (14 spellings) | Pass |
| No hub token is forwarded to LadWani or Education, forged or not | `ladwani.test.js`; S5 proxy line | Pass |
| The hub admin's session cookie (`hub_admin_sid`, Path=/) is removed before a request reaches Education or any proxied app; the app's own cookies pass | `proxy.test.js` (fails without the fix) | Pass (D-20, fixed) |
| One-time codes and passwords sent together: at most 5 tries, and a code signs in once | `tasklist.pg.test.js` (two race tests) | Pass (D-15, D-16, fixed) |
| Session tokens are stored only as hashes; OTP codes as HMACs; reset tokens hashed and single use | `tasklist.pg.test.js` | Pass |
| CSRF: signed-in writes need the session's token; signed-out forms the double-submit token; JSON only; foreign Origin refused | `tasklist.pg.test.js`, `hub.pg.test.js` | Pass |

## 4. Role-based access

| Check | Result |
|---|---|
| ATIP: the hub admin with the **owner** role sees it; an **editor** admin gets 404; anonymous 404; TaskList's owner role grants nothing there | Pass (`hub.pg.test.js`) |
| TaskList report (Neon Function): owner role only; others 404 | Pass (route + `server.test.js`) |
| TaskList rows: each person sees, edits and deletes only their own; nobody sees the old shared tracker's rows until migrated | Pass (`tasklist.pg.test.js`) |
| Education role middleware (parent, student, teacher, school_admin, district / state / national, system_admin) | Pass (`RbacBoundaryTest`, `AppealsTest`, `AcademicRecordsTest`, the 57 guest routes refused; edu-tester CR-01 to CR-21) |
| LadWani roles (member, Karta, operator, admin) on its API | Pass (LadWani Jest) |

## 5. Responsive checks (360 / 768 / 1280 px)

Every page below was opened at 360, 768 and 1280 px, in English, मराठी and हिंदी. A screenshot was taken and `document.scrollWidth − innerWidth` measured.

| Pages | Result |
|---|---|
| Hub: `/`, `/about`, `/contact`, `/privacy`, `/terms`, `/auth/sign-in`, 404, `/admin`, `/environment/`, `/driving-simulator/`, `/styleguide/` | no horizontal scroll at any width or language |
| TaskList: `/tasklist/sign-in`, `/sign-up`, `/forgot-password`; signed in: Today, Upcoming, Board, Lists, Tags, Search, Completed, Settings, task detail | no horizontal scroll (the board scrolls inside its own strip on phones, by design) |
| LadWani: `/ladwani/`, `/sign-in/`, `/sign-up/`, `/forgot-password/`, `/pending/` | no horizontal scroll |

Defects found here and fixed: the header overflowed by 18–26 px at 360–390 px in Marathi and Hindi (D-03 in §10); TaskList's six OTP boxes overflowed at 360 px (D-04).

## 6. Accessibility (axe-core, WCAG 2.0/2.1/2.2 A + AA tags)

Each page was scanned with axe-core 4 (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) in Chromium, after the page and its fonts had loaded.

| Scope | Scans | Violations at the start | Violations now |
|---|---|---|---|
| Public pages: the 19 routes of §5 (hub 11, TaskList 3, LadWani 5) × 360 and 1280 px × EN / मराठी / हिंदी | 114 | 3 serious (D-05, D-06, D-07 in §10) | **0** |
| Signed in: TaskList Today, Upcoming, Board, Lists, Tags, Search, Completed, Settings and the task detail, plus the LadWani sign-in, × 360 and 1280 px | 20 | 0 | **0** |

The 404 page logs one console error by design: the browser reports the 404 status of the page itself.

LadWani's signed-in screens (family tree, approvals, governance, bureau) are **not** in these scans: they need an approved member account with seeded family data. They are listed as open in §11, for the Test-server run.

Also checked:
- **Keyboard:** Tab order, the 3 px focus ring, Esc closes dialogs, and the board moves by keyboard.
- **Screens:** `lang` on every page, a skip link, and labels on every field.
- **Motion:** reduced motion is honoured.
- **Contrast in dark mode:** every text pair was computed, and is ≥ 4.5:1 in light and dark (`kesari-ui.test.js`).

## 7. Lighthouse (mobile preset, simulated slow 4G)

| Page | Performance | Accessibility | Best practices | SEO* | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| `/` | 100 | 100 | 100 | 60* | 1.0 s | 0.027 | 0 ms |
| `/contact` | 100 | 100 | 100 | 60* | 1.0 s | 0.019 | 20 ms |
| `/auth/sign-in` | 100 | 100 | 100 | 60* | 1.0 s | 0.003 | 30 ms |
| `/environment/` | 100 | 100 | 100 | 60* | 1.0 s | 0.001 | 50 ms |
| `/tasklist/sign-in` | 99 | 100 | 100 | 60* | 1.2 s | 0.064 | 100 ms |
| `/ladwani/` | 99 | 100 | 100 | 60* | 1.0 s | 0.004 | 120 ms |
| `/ladwani/sign-in/` | 96 | 100 | 100 | 60* | 1.0 s | 0.008 | 220 ms |
| `/ladwani/sign-up/` | 95 | 100 | 100 | 60* | 1.0 s | 0.017 | 250 ms |

\* SEO is 60 only because the local run is the **dev** tier, which sends `X-Robots-Tag: noindex` on purpose (`is-crawlable`, the only SEO audit that fails). Production sends no such header.

**Before** (live prod, 3 Nov 2026, 09:30 AM, `docs/ux-audit.md`): `/` 93 / 95 / 100, CLS 0.13, LCP 2.0–2.3 s.

Fixed during this run:
- LadWani sign-in was at 80, LCP 4.7 s (D-11).
- LadWani sign-up CLS was 0.18 (D-12).

## 8. Mobile apps

| App | Android | iOS |
|---|---|---|
| LadWani (`com.bkesari.ladwani`) | Scaffolded; **not built** | Scaffolded; **not built** |
| bkesari Education (`com.bkesari.education`) | Scaffolded; **not built** | Scaffolded; **not built** |
| TaskList (`com.bkesari.tasklist`) | Scaffolded; **not built** | Scaffolded; **not built** |

Each app has a Capacitor 8 configuration (`mobile/apps/*/capacitor.config.json`: its own project over https, navigation kept to bkesari.com, no mixed content) and an offline screen in EN/MR/HI. `mobile.test.js` checks them.

**Blocked:**
- **Android:** Google's SDK host refuses this session's network (HTTP 403), and there is no KVM for an emulator.
- **iOS:** builds need macOS and Xcode.
- **Signing:** release signing must use the owner's keys.

There are **no build numbers to record yet**. Steps are in `mobile/README.md`. Build and test on the Mac: Android Emulator (Pixel 6, API 35, plus a 2 GB / 3G profile) and iOS Simulator (iPhone SE, iPhone 16).

## 9. Test server and Prod server

**Not run on this release.** The code is on the branch and draft PR #25. It has **not** been merged to `dev`, `staging` or `main`, so test.bkesari.com and bkesari.com still run the previous release. Why it was not promoted from this session (decision log D-025):
1. Promoting replaces how every real person signs in. The old shared accounts need `tools/migrate_shared_id.mjs --apply` on each tier's databases first, and an email or SMS telling people.
2. No SMS gateway and no mail sender are configured (D-012). On production, mobile sign-in and password resets would answer "not available yet" until they are.
3. dev.bkesari.com has no working TLS certificate (audit finding 11), so the dev tier cannot be checked.

**What was measured on the servers today:** the before-state of prod and test (`docs/ux-audit.md`, 09:30–09:45 AM): 89 screenshots, axe on every page, and Lighthouse on 5 pages.

**The PR's Hostinger preview** (`yellow-gaur-979644.hostingersite.com`) rebuilds on every push and served `5010301` at 01:37 PM. This environment's network refuses that host (HTTP 403 from the proxy), so it could not be tested from here. It is worth a look in a browser before step 2.

**Promotion and the tests to run on each tier** (owner's go-ahead needed):

| Step | Tier | Tests |
|---|---|---|
| 1 | Set on each tier: `HUB_AUTH_SECRET`, `HUB_ADMIN_EMAIL` + `HUB_ADMIN_PASSWORD_HASH`, `SMS_WEBHOOK_URL`, the mail sender (DEPLOY.md Part 1) | — |
| 2 | Merge PR #25 → `staging` → test.bkesari.com | `bash scripts/smoke-dev.sh https://test.bkesari.com --env test`; TESTING.md §4; `migrate_shared_id.mjs` dry run then `--apply` on test's databases; the usability round of `docs/design/usability-tests.md`; this report's §3 isolation checks by hand in two browsers |
| 3 | `staging` → `main` → bkesari.com | `bash scripts/smoke-dev.sh https://bkesari.com --env prod`; Lighthouse on the 8 pages of §7; axe on §6's pages; `migrate_shared_id.mjs --apply --notify` |
| 4 | Afterwards | `neon.ts` `auth: false` + `neon deploy`; remove `HUB_TOKEN_PRIVATE_KEY`, `TRACKER_*`, `NEON_AUTH_*`, `HUB_JWKS*` from every tier |

## 10. Defects found and fixed

| ID | Severity | Where | Found by | Fix |
|---|---|---|---|---|
| D-01 | S2 | TaskList board: a move was not saved (PostgreSQL rejected `$2` used as both varchar and text) | browser e2e | Separate boolean parameter; `tasklist.pg.test.js` checks the order after reload |
| D-02 | S3 | TaskList: the task detail reopened after Save (a dialog's close event is asynchronous) | browser e2e | Address put back before re-rendering |
| D-03 | S3 | Shell: overflow 18–26 px at 360–390 px in MR/HI; project name drawn in ink | LadWani agent, Education agent, scan | Phone layout (logo alone inside a project); selector specificity |
| D-04 | S3 | TaskList: the OTP boxes overflowed at 360 px | scan | Six-column grid |
| D-05 | S3 | Brand saffron as text 4.28:1 on the page (axe, /about, 7 nodes) | axe | `--k-accent-ink` `#A64808` for text |
| D-06 | S3 | Deceased tree node faded below AA (axe, style guide) | axe | Dashed + grey background, no opacity |
| D-07 | S3 | Account button: spoken name did not begin with its visible text (WCAG 2.5.3, 16 screens) | axe | Visible name first, "Account" after it, visually hidden |
| D-08 | S4 | `/tasklist/` redirected to `/tasklist//` | route probe | Exact-path check |
| D-09 | S3 | Sub-task tick in the detail did nothing | review | Direct update for sub-tasks |
| D-10 | S3 | Quick add: "Report 2 Nov" written on 3 Nov meant 2 Nov 2027 | browser e2e | Dates up to 30 days past stay this year (overdue) |
| D-11 | S3 | LadWani sign-in LCP 4.7 s: chunks sent uncompressed; footer painted only after the shell's script | Lighthouse | gzip in the hub; footer in the built page |
| D-12 | S3 | LadWani sign-up CLS 0.18 (skeleton then form) | Lighthouse | Step 1 drawn at once |
| D-13 | S4 | Console errors on every page: signed-out `401`s from the shell's account check and LadWani's session check; `/favicon.ico` 404 | Lighthouse best practices | 200 with `user: null`; LadWani asks before refreshing; favicon served |
| D-14 | S3 | TaskList search: a spare bound parameter made PostgreSQL refuse the query | review | One parameter used twice |
| D-15 | S2 | TaskList / hub admin one-time codes: 10 wrong codes sent together got 6–9 checks against one code (limit 5), and one right code sent several times at once gave several sessions | portal-tester | Each try claimed, and a matching code spent, in one atomic `UPDATE … RETURNING`; a test sends the requests together |
| D-16 | S2 | TaskList / hub admin passwords: 9 wrong passwords sent together were all checked, so a lock after 5 could be outrun | portal-tester | The try is claimed (and the lock applied) in one `UPDATE` before the password is compared; the test adds 15 ms per query, as a remote database would |
| D-17 | S3 | `compression` < 1.8.2 (high, GHSA-vc2v-76pw-4v95, new in this branch) and `qs` 6.16.0 (moderate) | portal-tester (`npm audit`) | Patch updates in the lockfile; `npm audit --omit=dev` at 0 |
| D-18 | S3 | The Neon parity script still drove the retired Task Tracker (410s) | portal-tester | Rewritten for TaskList's own sign-in; 18 / 18 |
| D-19 | S4 | Smoke step checked the LadWani API's "ready" line before the API had printed it | portal-tester | Waits up to 10 s for the line |
| D-20 | S3 | The hub admin's session cookie (Path=/) was forwarded to Education's server with every `/edu/` request | portal-tester (code reading) | The proxy drops `hub_admin_sid` and its CSRF pair (D-027); a test checks it |
| D-21 | S4 | Dead branch for the retired hub gate in `smoke-dev.sh`; stale counts in `TEST_SPEC.md` | portal-tester | Removed; spec counts updated |
| D-22 | S3 | Education mobile sign-in (new): 12 wrong codes sent together were all checked; one code signed in 12 times; 12 codes sent to one number (limit 3) | edu-tester | Atomic try counter per code; the code spent by the first request to claim it; send limit on each request's own count |
| D-23 | S3 | Education password lockout (also in the old code): 12 wrong passwords sent together were all checked | edu-tester | Count first, refuse on the request's own count |
| D-24 | S3 | Education 2FA challenge (also in the old code): 6–9 of 12 wrong codes checked | edu-tester | Count first |
| D-25 | S3 | Under D-22–D-24: Laravel's `RateLimiter::hit()` could reset a fresh key's count, letting up to twice the limit through | edu-tester | New `App\Support\Attempts`, counting under a per-key lock; `AttemptsTest` |
| D-26 | S3 | Education 2FA recovery code (also in the old code): one code signed in 6–9 times when sent together | edu-tester | Spent in a transaction under a row lock |
| D-27 | S3 | Test tooling (no product code): on a full disk the deploy-bundle step could run `npm ci --omit=dev` in the working tree; repeat smoke runs within an hour hit the sign-in rate limits (429); one cookie probe matched `tl_sid_csrf` and could not fail | portal-tester (re-run) | The step runs only when its temp copy exists; S5 and S7 reset the counters first; the probe matches the exact name |

## 11. Pass / fail

**PASS:** everything that could be run on the branch: automated suites, both testing agents (§1), isolation, roles, responsive, accessibility after fixes, and Lighthouse.

**Open, not failures of the code:**
- Test and Prod testing of this release (§9).
- Android and iOS builds (§8).
- SMS and mail providers (D-012).
- The Education learning screens the brief lists but the product does not have (D-024).
- LadWani's operator document viewer and governance views (tracker).
- Privacy-friendly analytics (tracker).
- axe on LadWani's signed-in screens, with a seeded approved member (§6).
- **Owner decisions raised by the testers:**
  - With no SMS provider, dev and test show the one-time code on screen. Set a provider on test before real accounts are copied there (D-028).
  - A mobile number (Education) or an email (TaskList) added to an account is not yet confirmed with a code (D-028).
  - CI's smoke step and the Neon parity script now reach the live Education dev site for `/edu/`, since the hub gate is gone. Keep that, or give them a local Education stand-in (portal-tester O1).
- **Dependency advisories, report only:** Education's `symfony/mime` CVE-2026-45070 (medium; the app does not appear to reach it; `composer update symfony/mime`); LadWani's 11 npm advisories, 5 with non-breaking fixes, unchanged from before this release (they belong to the Ladwani repository).
