# Central login: deploying to dev, then promoting to test and production

The design is in [DESIGN.md](./DESIGN.md). This page lists the steps.

**gokesari.com is not touched by any of this.** It keeps its own SSO, database
and cookies. None of the values below may be copied to it or from it.

Every piece is off until it is configured, so the code can be deployed before
any switch is turned on. Turn things on in this order, on **dev.bkesari.com
first**, checking each step before the next.

| # | Repo / PR | Switch |
|---|---|---|
| 1 | bkesari-platform: hub + `portal/auth` | `AUTH_ENABLED=1` |
| 2 | bkesari-platform: `edu/` | `BKESARI_SSO_INTROSPECT_URL` |
| 3 | Ladwani | `BKESARI_SSO_INTROSPECT_URL` |
| 4 | bkesari (Milk & Dairy) | `BKESARI_SSO_INTROSPECT_URL` |
| 5 | ATIP-DEV (hosted only) | `BKESARI_SSO_INTROSPECT_URL` |
| 6 | agtci | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` |

---

## Part A: dev

### A1. Secrets, generated once per tier and never committed

On your own machine:

```bash
cd bkesari-platform
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # -> AUTH_SECRET
npm run auth -- keygen                                                         # -> AUTH_OIDC_PRIVATE_KEY (one-line form)
```

Store these in hPanel → Node.js Web App → Environment variables for
**dev.bkesari.com only**. Test and production each get their own. Never reuse
a value across tiers.

### A2. Hub (dev.bkesari.com)

Environment variables, in addition to the existing ones:

```
AUTH_ENABLED=1
AUTH_PUBLIC_URL=https://dev.bkesari.com
AUTH_SECRET=<A1>
AUTH_OIDC_PRIVATE_KEY=<A1>
AUTH_OWNER_EMAIL=<your email>
# The auth tables go in the main (Milk & Dairy) dev database:
AUTH_DB_CLIENT=mysql
AUTH_DB_HOST=localhost
AUTH_DB_NAME=<dev Milk & Dairy database>
AUTH_DB_USER=<a user with CREATE/ALTER on it>
AUTH_DB_PASSWORD=...
SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASSWORD=... SMTP_FROM=no-reply@bkesari.com
# optional:
AUTH_GOOGLE_CLIENT_ID=... AUTH_GOOGLE_CLIENT_SECRET=...   # redirect URI: https://dev.bkesari.com/auth/google/callback
AUTH_GATE_TABS=tasks              # start with TaskList only; add milk,edu,ladwani as each is switched on
```

Deploy `dev` as usual. On startup the hub applies `portal/sql/auth/mysql/001_auth.sql`.
To apply it by hand instead, run `npm run auth -- migrate` or paste the file into phpMyAdmin.
Every table is prefixed `auth_`, so nothing in the Milk & Dairy schema is
affected.

Then, in the hub's directory on the server (hPanel → SSH / terminal), with the same environment:

```bash
npm run auth -- owner:bootstrap --name "Your Name"      # asks for a password (or AUTH_BOOTSTRAP_PASSWORD)
npm run auth -- owner:totp                              # shows a key: add it to your authenticator app
npm run auth -- owner:totp:confirm 123456               # the current 6-digit code
```

**Check:**
- `bash scripts/smoke-dev.sh https://dev.bkesari.com` passes. It detects central-login mode.
- Sign in at `https://dev.bkesari.com/auth/login`. You are asked for the TOTP code.
- `/auth/admin` opens.
- `/atip/` opens for you.
- In a private window, `/atip/` is a 404.

### A3. Register each project on the hub

Each project needs its own client, and each secret is printed only once:

```bash
npm run auth -- client:add --id edu-dev     --kind internal --tier dev
npm run auth -- client:add --id ladwani-dev --kind internal --tier dev
npm run auth -- client:add --id milk-dev    --kind internal --tier dev
npm run auth -- client:add --id atip-dev    --kind internal --tier dev     # only if ATIP is hosted
npm run auth -- client:add --id agtci-dev   --kind oidc     --tier dev --feature AGTCI \
     --redirect    https://dev.agtci.com/auth/callback \
     --post-logout https://dev.agtci.com/ \
     --backchannel https://dev.agtci.com/auth/backchannel-logout
npm run auth -- client:list
```

Redirect URIs are only accepted on bkesari.com / agtci.com hosts, over https.

### A4. Each project (dev)

Common values for every bkesari.com project:

```
BKESARI_SSO_INTROSPECT_URL=https://dev.bkesari.com/auth/api/introspect
BKESARI_SSO_URL=https://dev.bkesari.com
BKESARI_SSO_CLIENT_ID=<from A3>
BKESARI_SSO_CLIENT_SECRET=<from A3>
BKESARI_SSO_ENFORCE=          # leave empty at first; see A5
```

| Project | Extra | Then |
|---|---|---|
| Education (`edu/`, Laravel) | — | `php artisan migrate` (adds `sso_role_grants`), `php artisan config:clear` |
| LadWani (Next 14) | `NEXT_PUBLIC_BKESARI_SSO_URL=https://dev.bkesari.com` | **rebuild**: the middleware and the sign-out button read these at build time |
| Milk & Dairy (Next 16) | — | redeploy (no migration) |
| ATIP (VPS, only if hosted) | `ATIP_ROOT_PATH=/ATIP` on ATIP; `ATIP_ORIGIN=https://<vps>` on the **hub** | see ATIP-DEV `docs/HOSTED_DEPLOYMENT.md` §2.1 |
| agtci.com (dev.agtci.com) | `OIDC_ISSUER=https://dev.bkesari.com/auth`, `OIDC_CLIENT_ID=agtci-dev`, `OIDC_CLIENT_SECRET`, `AGTCI_URL=https://dev.agtci.com` | `npm run db:migrate` (adds `sso_sessions`), redeploy |

Then add each tab to `AUTH_GATE_TABS` on the hub as it is switched on, until
the value is `milk,edu,ladwani,tasks`.

### A5. Grant access, then enforce

1. In `/auth/admin`, give yourself and a few testers the subscriptions they need. Your owner account is ADMIN-level and is already entitled to every feature.
2. Run through the manual checks below.
3. Only then set `BKESARI_SSO_ENFORCE=1` on Education, LadWani and Milk & Dairy. From that point the projects' own password logins are off. **Existing local accounts are not deleted.** They are linked to the central account with the same email the first time that person signs in centrally, so ask existing users to sign up at bkesari.com with the same address.

### A6. Manual checks on dev

| # | Check | Expect |
|---|---|---|
| 1 | Sign up with a new email | Consent box required; verification email arrives; sign in works only after verifying |
| 2 | Wrong password 5 times | Account locked; `ACCOUNT_LOCKED` in the audit log |
| 3 | New user opens `/ladwani/` | "Subscribe / request access" page; `/ladwani/api/...` answers 403 |
| 4 | Request access, admin approves | LadWani opens with no second login; menu now shows LadWani |
| 5 | Admin sets an expiry in the past (DB) or revokes | Tab disappears, page goes back to subscribe |
| 6 | Admin tries to change own role / grant ADMIN | Refused, `ROLE_CHANGE_DENIED` audited |
| 7 | USER, MODERATOR, ADMIN visit `/atip/`, `/ATIP/api/...` | 404, no ATIP tab, no mention anywhere |
| 8 | Owner without TOTP on the session visits `/atip/` | Asked for a code; then opens |
| 9 | Signed in at dev.bkesari.com, open dev.agtci.com → Client area | Signed in silently |
| 10 | Sign out at dev.bkesari.com | dev.agtci.com client area asks to sign in again; LadWani / Education sessions end within 30 s |
| 11 | Sign out at dev.agtci.com | dev.bkesari.com is signed out too |
| 12 | Audit log | Logins, role changes, subscription changes and every ATIP access are listed (ATIP rows visible to the owner only) |

The automated version of most of these: `npm test` in each repo (see each PR).

---

## Part B: promoting to test, then production

Promote one tier at a time, in the existing branch flow (`dev` → `staging` →
`main` for bkesari-platform; `staging` → `main` for the others). Repeat Part A
on the new tier **with new values**. Use this checklist:

### Before

- [ ] All PRs merged, and CI green on the target branch of every repo.
- [ ] Every item in A6 passed on the tier below, and has been for at least a few days.
- [ ] New `AUTH_SECRET`, new `AUTH_OIDC_PRIVATE_KEY`, new client secrets. **Nothing reused from dev.**
- [ ] `AUTH_PUBLIC_URL` is `https://test.bkesari.com` or `https://bkesari.com`. Run `curl -I` on that URL and confirm `X-Bkesari-Env` reports the right tier.
- [ ] `AUTH_DB_*` points at **that tier's** main database. Take a backup of it first.
- [ ] SMTP configured and a test mail received. Without SMTP, test and production cannot send verification or reset links.
- [ ] Google OAuth client (if used) has this tier's callback URL, and only that one.
- [ ] Clients registered with this tier's hosts only: `--tier test|prod`, `test.agtci.com` / `agtci.com` redirect URIs.
- [ ] `AUTH_OWNER_EMAIL` set; `owner:bootstrap` and `owner:totp` done on this tier; recovery plan noted (see below).
- [ ] agtci `OIDC_ISSUER` points at the **same tier's** hub (`test.agtci.com` → `test.bkesari.com/auth`).

### Switch on

- [ ] Hub first, with `AUTH_GATE_TABS=` (empty): sign-in and the admin panel work, and no project is gated yet.
- [ ] Grant subscriptions to existing users who should keep access (bulk: see "Bulk grants" below).
- [ ] Add tabs to `AUTH_GATE_TABS` one at a time; switch each project's `BKESARI_SSO_*` on with its tab.
- [ ] agtci last.
- [ ] `BKESARI_SSO_ENFORCE=1` on each project only after its users have central accounts.

### After

- [ ] `scripts/smoke-dev.sh <tier url> --env <tier>` passes.
- [ ] A6 checks 3, 7, 9, 10 and 11 repeated by hand on this tier.
- [ ] Audit log shows the checks. On production, keep an eye on `LOGIN_FAILED` and `ACCOUNT_LOCKED` for the first days.

### Rollback

Each switch reverts independently, and nothing is deleted:

- `AUTH_GATE_TABS=` stops gating at the hub.
- Unset `BKESARI_SSO_*` in a project; it goes back to its own login.
- `AUTH_ENABLED=` restores the old Basic-auth hub exactly. The `auth_*` tables stay where they are, unused.

### Owner account recovery

If you lose your authenticator:

1. Sign in to the server.
2. Run `npm run auth -- owner:totp --reset`. This ends every owner session.
3. Enrol again with `owner:totp` and `owner:totp:confirm`.

A forgotten password can be reset through `/auth/forgot`, or with `owner:bootstrap` and `AUTH_BOOTSTRAP_PASSWORD`.

### Bulk grants

Until payments exist, an admin activates subscriptions. For a one-off bulk
grant, run this on the tier's main database:

```sql
INSERT INTO auth_subscriptions (user_id, feature_code, status, source, starts_at, created_at, updated_at)
SELECT id, 'MILK_DAIRY', 'active', 'admin', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM auth_users WHERE email IN ('a@example.com', 'b@example.com')
ON DUPLICATE KEY UPDATE status = 'active', updated_at = UTC_TIMESTAMP();
```

A grant made this way bypasses the audit log, so note it in your own records. Grants made in `/auth/admin` are audited.

### Payments, later

A payment provider's verified webhook should call
`service.activateFromPayment({ userId, feature, provider, reference, expiresAt })`
(`portal/auth/service.js`). It is idempotent per reference and audited as
`SUBSCRIPTION_PAID`. Nothing else needs to change.
