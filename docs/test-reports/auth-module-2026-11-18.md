# bkesari ID: test report

**Central sign-in with Google and admin-approved project access (decision D-039)**
Report date: 18 Nov 2026, 12:30 AM IST. All times are IST (UTC + 5:30).

## 1. Summary

| | |
|---|---|
| Verdict | **PASS**: portal-tester PASS, edu-tester PASS, CI green |
| Code tested | `bkesari-platform` `7cf16c0` → `6e48919` / `625474e` (branch `claude/gracious-lamport-xdf1en`) |
| On `main` | `a07c2db` (18 Nov 2026, 12:16 AM IST): PR #34 → #35 (release) and #36 → #37 (fixes) |
| Defects found by the testers | 3 product defects (1 security), all fixed and on `main`; 7 spec and test defects, all fixed |
| Production (bkesari.com) | **Not updated yet.** bkesari.com runs on the Hostinger VPS (189.72.155.162). The Git auto-deploy feeds the shared-hosting copy, which is no longer the live site. At 12:21 AM IST, bkesari.com still served the 4 Nov release. |
| dev.bkesari.com, test.bkesari.com | Skipped on the owner's instruction (18 Nov 2026) |

## 2. What was tested

- **Hub** (`portal/bkesari-id.js`, `portal/access.js`, the pages and scripts)
  - **Google sign-in:** OIDC code + PKCE S256, state and nonce. The ID token is verified against Google's JWKS (RS256, issuer, audience, expiry, nonce, `email_verified`).
  - **Fallbacks:** the email code, and the built-in administrators.
  - **Session:** `bk_sid`.
  - **Asking for access:** one pending request per project; after a decline, the person can ask again 24 hours later.
  - **The admin's queue:** approve with a role, decline with a reason, change a role, revoke, grant directly, suspend.
  - **The person's pages:** `/account`, the home tile states, and the emails.
  - **The gate** in front of LadWani, Education and TaskList:
    - it strips client `X-Bkesari-*` headers and sets HMAC-signed ones (`HUB_PROXY_SECRET`, 60 s, one project);
    - it reads roles from the database on every request;
    - LadWani's second step travels in `X-Bkesari-Project-State`.
- **LadWani** (NestJS, in the hub's process): the hub-identity verifier, account linking by hub id or confirmed email, and the project-state report.
- **Education** (Laravel): the `HubIdentitySignIn` middleware and the `hub_role` column.
- **TaskList:** opens on the hub identity, in the hub's own process.
- **Day-one linking:** `tools/link_accounts_to_hub.mjs`, a dry run by default and `--apply` to write.
- **Mobile:** the bkesari app (`mobile/bkesari/`, `in.bkesari.app`, 1.1.0 build 1).

## 3. Environment

| | |
|---|---|
| Machine | Linux container (cloud session) |
| Runtimes | Node 22.23.4; PHP 8.3.6 with Composer 2.8.12 |
| Database | PostgreSQL 16.15 (TLS, SCRAM); PgBouncer 1.22.0 in transaction mode for the parity runs |
| Database roles | Not superusers |
| Network | Nothing called Google, mail, SMS or any hosted database. Google was played by a key pair made in the tests. |

## 4. Results

### Hub and LadWani (portal-tester, 17 Nov 11:51 PM to 18 Nov 12:17 AM IST)

| Level | Result |
|---|---|
| S1 static checks | PASS |
| S2 `npm test` (no database) | 151 / 151; the 8 PostgreSQL suites skipped as designed; guard 32 / 32 |
| R1 full suite (PostgreSQL) | **205 / 205**, 0 skipped. Was 187 before this change |
| LadWani Jest | **439** tests in 37 suites; typecheck clean; lint shows the 2 known warnings |
| LadWani build | 46 pages |
| S5 smoke | 81 probes ok; `smoke-dev.sh` 32 passed, 0 failed |
| S6 security | 32 ok |
| S7 Neon parity (pooler) | 18 / 0 |
| Mobile (`cd mobile && npm test`) | 29 / 29 |
| Audit (report only) | 3 high in the hub: a picomatch advisory published since the last run, reached through http-proxy-middleware |

### Education (edu-tester, 17 Nov 11:47 PM to 18 Nov 12:16 AM IST)

| Level | Result |
|---|---|
| PHPUnit | **574** tests (+30) on SQLite and on PostgreSQL, directly and through the pooler; 0 skipped on PostgreSQL |
| Migrations | 69; `migrate:fresh --seed` passes; the hand-run SQL matches (5,565 lines, 70 CHECK constraints) |
| Smoke | http 60 / 0, browser 21 / 0 |
| Critical regressions | all 22 PASS. The new CR-22 survived a mutation check: all 14 mutants are caught |
| Cross-language check | headers signed by the hub (Node) are accepted by Education (PHP), including a Marathi name. They are refused if altered, signed for another project, signed with a wrong key, or 60 s old |

### CI (GitHub Actions)

edu, ladwani and test all passed:
- on `7cf16c0` (11:56 PM IST);
- on `b6f1082` (12:00 AM IST);
- on `99e25f2`, `947af5b` and `dba7c59` (12:10 to 12:14 AM IST).

## 5. The required cases

| Case | Result | Evidence |
|---|---|---|
| Google sign-in: success and failure | PASS | `access.pg` :: Google sign-in…; `bkesari-id` :: a Google ID token is accepted only with… (bad issuer, audience, expiry, nonce, signature, algorithm; cancelled; wrong state; replayed callback) |
| Unverified email refused | PASS | the same tests: `google_unverified`, and no account is made |
| Request → approve → access | PASS | `access.pg` :: request → approve (with a role) → access; S5 TaskList lines |
| Decline, revoke and suspend each block on the next request | PASS | `access.pg` :: decline (with a reason), revoke and suspend… |
| Direct URL to a project without access is refused | PASS | `access.pg` :: without access…; S5 gate lines; S6 path loop |
| Forged `X-Bkesari-*` headers are refused | PASS | `access.pg`, `bkesari-id`, LadWani `hub-identity.spec.ts`, Education `HubIdentitySignInTest`; S5 |
| LadWani two-step approval | PASS | `access.pg` :: LadWani "approved — awaiting LadWani verification"…; LadWani `hub-identity.http.spec.ts`; S5 against LadWani's real API |
| Built-in admins still work | PASS | `access.pg` :: the built-in administrators are owners at the hub…; `builtin-admins.pg` (9) and `builtin-admins` (4) |
| Email-code fallback works | PASS | `access.pg` :: … the email code still works; S5 signs in by email code |
| Migration dry run | PASS | `link-accounts.pg` :: a dry run changes nothing; `--apply` writes…; a second run finds nothing to do |

## 6. Defects

| # | Severity | Defect | Fix |
|---|---|---|---|
| P-D1 | **Security** | The gate let through a bkesari ID whose email nobody had confirmed. An account made by SMS code could add someone else's address, be approved for a project, and be linked to that person's TaskList, LadWani or Education account. Reproduced on a dev hub. | `99e25f2`: the gate and access requests require a confirmed email. Test added. On `main`. |
| P-D2 | Medium | TaskList could not be installed as an app: the gate covers its manifest, which browsers fetch without cookies. | `99e25f2`: `crossorigin="use-credentials"` on the manifest link. Test added. |
| P-D3 | Low | A HEAD request to a project page got the API's JSON instead of the redirect. | `dba7c59`. Test added. |
| P-D4, P-D5, P-D6 | Spec and test | The S5/S6 smoke commands and the parity script predated the gate; a comment in the schema file was misplaced. | Rewritten or fixed (`6e48919`, `625474e`). |
| E-D1 to E-D4 | Spec and test | Education spec counts; an interim S5 step; a stronger two-factor test; a template count. | `b6f1082`, `947af5b`. |

## 7. Production testing

**Not yet possible.** On the owner's instruction, the release was merged straight to `main` (12:03 AM IST, and the fixes at 12:16 AM IST). The Hostinger Git build for bkesari.com completed in 1 min 26 s (12:06 AM IST).

That build went to the shared-hosting copy. bkesari.com and test.bkesari.com resolve to the VPS, and the VPS does not pull `main` by itself. A 15-minute watch found no change. At 12:21 AM IST, `https://bkesari.com/auth/sign-in` was still "Choose a project to sign in" (the 4 Nov release).

Production checks to run once the VPS is updated:
- `scripts/smoke-dev.sh https://bkesari.com --env prod`;
- `/auth/sign-in` is the bkesari ID's page;
- `/tasklist/`, `/edu/` and `/ladwani/` send a visitor to sign-in;
- the email code reaches a real inbox;
- the admin approves a request;
- `link_accounts_to_hub.mjs`: a dry run, then `--apply`.

## 8. Open items

1. **Update the VPS:**
   - pull `main`, run `npm ci && npm run build:hostinger`, and restart the hub;
   - for Education, pull and run `php artisan migrate`;
   - run the linking: `node --env-file=.env tools/link_accounts_to_hub.mjs`, then `--apply`.
2. **Settings the owner must set** (server environment only):
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the GoKesari client);
   - the redirect URI `https://bkesari.com/auth/google/callback` in Google Cloud Console;
   - `HUB_PROXY_SECRET`, with the same value in the hub and in Education's `.env`;
   - `BUILTIN_ADMIN_PASSWORD_HASH` for the hub and `BUILTIN_ADMIN_PASSWORD_BCRYPT` for Education.
3. **Owner's decision before Razorpay goes live:** LadWani's payment webhook (`/ladwani/api/v1/webhooks/payments`) is behind the gate. It needs an exemption.
4. **Owner's decisions from the LadWani work:**
   - "two operators" verification (today one is enough);
   - staff count as verified;
   - a hub `karta` without a family;
   - LadWani's own Sign out should go to the hub's sign-out.
5. **SMS codes for the bkesari ID:** they are accepted, though the contract does not list them. Since P-D1, such accounts open nothing until an email is confirmed. Whether to switch them off is the owner's call.
6. **Mobile:** native builds need a Mac (Android SDK; Xcode). The bkesari app is 1.1.0 build 1, and nothing has run on a device yet.
7. **Audits (report only):**
   - hub: 3 high (picomatch);
   - Education: `composer audit` reports 7 (Laravel/Symfony; none reached by the app's code), and `npm audit` reports 17 (dev tooling only);
   - updating is proposed as a separate change.

Full tester reports: `.claude/test-runs/20261117-184850-portal-tester.md` and `.claude/test-runs/20261117-184609-edu-tester.md`. They are git-ignored and kept in the session.
