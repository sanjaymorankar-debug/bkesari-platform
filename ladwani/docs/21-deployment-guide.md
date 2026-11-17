# Phase 5 — Deployment Guide

> **Database: PostgreSQL since 2026-10-24.** This document was written for MySQL 8.
> The app now runs on PostgreSQL (Neon in the hosted tiers). Read MySQL-specific
> commands here (mysqldump, phpMyAdmin, InnoDB settings) as their PostgreSQL
> equivalents (pg_dump/pg_restore, the Neon console, Neon branches and restore);
> `docs/26-local-testing.md` describes what changed in the code.

## 1. Target Environment

Deploys onto the existing Hostinger account already running `devmiladwani.agtci.com` — same MySQL 8 instance, same domain, per the migration decisions in `13-development-roadmap.md` §1. Node 20+ runtime, npm workspaces monorepo (`apps/api`, `apps/web`, `packages/shared-types`).

## 2. Required Environment Variables

### `apps/api`

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL (Neon, pooled) connection string, e.g. `postgresql://bk_ladwani_app:pass@ep-…-pooler.ap-southeast-1.aws.neon.tech/bk_ladwani?sslmode=require` |
| `JWT_SECRET` | Yes in production | Bootstrap now refuses to start in production without it (`main.ts`) — no fallback is used outside dev |
| `WEB_ORIGIN` | Yes | Exact origin the API's CORS policy allows, e.g. `https://devmiladwani.agtci.com` |
| `PORT` | No | Defaults to 4000 |
| `NODE_ENV` | Yes | Must be `production` — gates the JWT secret check and the secure cookie flag |
| `APP_ENV` | Yes on a tier | `dev`, `test` or `prod` (the hub's tier setting). Decides whether a one-time code may appear in an answer (`devOtp`): only on `dev`, or locally with `APP_ENV` unset and `NODE_ENV` not `production`, and only with no mail provider. Never on `test` or `prod`. |
| `HUB_PROXY_SECRET` | Yes inside the bkesari hub | The hub's own setting, read from the same process (a `LADWANI_HUB_PROXY_SECRET` would win). LadWani believes the hub's signed `X-Bkesari-*` identity headers only when it is set and matches; unset, they are ignored and only LadWani's own sign-in works (see "The bkesari hub's sign-in" below). |
| `MAIL_HOST` | Yes on test and production | SMTP host, `smtp.hostinger.com`. Unset: no mail; on test and production, sending a code then answers 503. |
| `MAIL_PORT` | No | `465` (TLS from the first byte, the default) or `587` (STARTTLS, then required) |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | Yes with `MAIL_HOST` | The mailbox and its password |
| `MAIL_FROM_ADDRESS` | No | Sender address; defaults to `MAIL_USERNAME` |
| `MAIL_FROM_NAME` | No | Sender name; defaults to `LadWani · bkesari` |
| `MAIL_SCHEME` | No | As Laravel's: `smtps` or `smtp`, to override what the port implies |
| `PAYMENT_GATEWAY_PROVIDER` | Yes for real payments | `RAZORPAY` to activate the live gateway; unset/`DEV` keeps the simulated one |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Yes if `PAYMENT_GATEWAY_PROVIDER=RAZORPAY` | Read lazily — the app won't crash at boot if these are missing, only when a real gateway call is actually made |
| `DEV_GATEWAY_SECRET` / `DEV_GATEWAY_WEBHOOK_SECRET` | No | Dev-only defaults exist; irrelevant once `PAYMENT_GATEWAY_PROVIDER=RAZORPAY` |
| `DEV_UPLOAD_SIGNING_SECRET` | No | Dev-only local-disk upload signing secret (see `18-file-storage-design.md`); irrelevant once a real `FILE_STORAGE` provider replaces `DevFileStorageService` |

### `apps/web`

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Origin the Next.js rewrite proxies `/api/v1/*` to (see `next.config.js`) |

## 3. Build & Start

```bash
npm install
npm run build --workspace=packages/shared-types
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
node apps/api/dist/src/main.js &
npm run start --workspace=apps/web
```

`prisma migrate deploy` (not `migrate dev`) is the production command — it applies pending migrations without generating new ones or touching a shadow database, and fails closed on drift rather than trying to resolve it interactively.

## 4. CI/CD

`.github/workflows/ci.yml` already runs on every push: lint, typecheck, unit tests, a real PostgreSQL-backed integration test (booking concurrency), `prisma migrate deploy` against a service container, and a production build of both apps. A green run on the `rebuild` branch is the gate for promoting to a deploy — there is no separate CD pipeline yet; deployment is the manual steps in §3 run against the target host.

## 5. Health & Observability

- No APM/error-tracking service is wired in yet. At minimum, tail `apps/api`'s stdout/stderr and monitor the process supervisor (pm2, systemd, or Hostinger's equivalent) for restarts.
- The audit log (`GET /audit-logs`, `audit:view` permission) and the reporting module (`GET /reports/*`, `report:view` permission) are the closest things to production visibility this build ships with — both are read via the Admin/Operator UI, not a separate ops dashboard.

## 6. Known Gaps to Carry Into Later Work

- **No job scheduler.** Late fees, booking-expiry, and payment reconciliation are all computed at read time or manually triggered rather than cron-driven (noted at each point in the M3/M4 code). A real deployment serving traffic around the clock will eventually want a scheduler (cron, BullMQ + Redis) for reconciliation especially, since docs/19 §4 specifies a 15-minute cadence this build only supports via manual trigger.
- **No real object storage or malware scanning.** `apps/api/src/uploads` implements the full validation/activation pipeline against a local-disk dev stand-in — see `18-file-storage-design.md` and the M5 checkpoint report for what's needed to switch on Cloudflare R2 + a real scanner.

## LadWani's own sign-in (2026-11-03)

LadWani signs people in itself, end to end: its own `users` table in its own
database. Since 17 Nov 2026 (D-039) the bkesari hub can also vouch for who a
person is, in signed headers; see "The bkesari hub's sign-in" below. The old
hub token (`X-Bkesari-Token`, `HUB_JWKS_URL`, `HUB_JWKS`) is gone and never
honoured.

- Session cookie `lw_sid`: HttpOnly, SameSite=Lax, Path=`LADWANI_COOKIE_PATH`
  (default `/ladwani`; set `/` when the web app runs at the root), Secure except
  on plain http to localhost. Max-Age 30 days, rotated on every refresh.
- Sign-in: email + a code by email (`/auth/otp/send`, `/auth/otp/login` with
  `{ email }`) first, email or mobile + password (`/auth/login`) second. Five wrong passwords lock password
  sign-in for 15 minutes; a code still works, and a reset clears the lock.
- Forgot password: `/auth/password/forgot` sends a code to the account's email,
  `/auth/password/reset` sets the password and ends every session.
- `GET /auth/session` answers the hub's app shell (`/shared/menu.js`) with who is
  signed in, without rotating the cookie.
- Every `/auth` route refuses cross-site requests (`Origin` must name the host;
  `Sec-Fetch-Site: cross-site` is refused).
- **Codes go by email** (SMTP, the `MAIL_*` settings above; inside the hub each
  may carry a `LADWANI_` prefix to apply to LadWani alone). SMS is on hold: no
  SMS provider is wired in, the `{ mobile }` code paths stay in the API, and
  the web offers them only when `GET /auth/session` says `smsLive: true`.
  Without a mail provider, the dev tier and local runs return the code as
  `devOtp`; test and production answer 503 and never return it.

## The bkesari hub's sign-in (2026-11-17, D-039)

The contract is `docs/design/bkesari-id.md` at the repository root (§2 and §3).
The hub signs the person in once at bkesari.com, checks their LadWani grant on
every request under `/ladwani/`, removes any `X-Bkesari-*` header the browser
sent, and adds `X-Bkesari-User`, `-Email`, `-Role`, `-Name`, `-Project`, `-Ts`
and `-Sig` (HMAC-SHA256 with `HUB_PROXY_SECRET`).

- **When LadWani believes them** (`apps/api/src/auth/hub-identity.ts`):
  `HUB_PROXY_SECRET` is set, the signature matches (constant-time), the project
  is `ladwani`, the time stamp is less than 60 seconds from now, and every field
  has its form (digits, a lower-case email, one of member, karta, operator,
  admin, base64url UTF-8 name). Otherwise they are ignored entirely and
  LadWani's own sign-in works as above.
- **`POST /auth/hub`** (same-origin only, like every `/auth` route): the web app
  calls it first on every load (`apps/web/src/lib/auth-context.tsx`). With a
  valid identity it signs the person in with no password and answers exactly as
  `/auth/login` does (`lw_sid` cookie, `{ data: { accessToken, user } }`, plus
  `created`). Without one it answers `{ data: null }` and the web app goes on to
  `/auth/session` and the sign-in page.
- **Which account**: the one whose `users.hub_user_id` is the hub id; else the
  one with that email **only if LadWani confirmed it** (`email_verified`), which
  is then joined to the hub id; else a new one (ACTIVE, email confirmed, member
  row named from `X-Bkesari-Name` split at the first space, or the email's local
  part; MEMBER role; random password). An account whose email LadWani never
  confirmed is neither joined nor duplicated: `409 HUB_EMAIL_UNCONFIRMED` (D-035);
  a code sent to that email on LadWani's sign-in page confirms it, and the next
  load joins it. Also refused: an email joined to another hub id (409
  `HUB_EMAIL_TAKEN`), a suspended or blocked account (403 `SUSPENDED`), a
  removed one (403 `REMOVED`), and a reserved address that is not a built-in
  administrator (403 `RESERVED_EMAIL`). The hub's built-in administrators
  (`<name>@builtin.bkesari.com`, role admin) get LadWani's built-in account for
  that username (`builtin-admins.ts`), made on first use.
- **Roles**: member → MEMBER; karta → KARTA + MEMBER; operator → OPERATOR +
  MEMBER; admin → ADMIN + MEMBER. Added at each hub sign-in, never removed, so a
  role changed inside LadWani stays. A hub `karta` holds KARTA without a family;
  a family's own Karta row still comes from LadWani's family approval.
- **One person per browser**: `POST /auth/hub` ends whatever `lw_sid` session
  the browser held before it starts the new one (and after a refusal leaves
  none). On every request with a valid identity, an access token, a refresh
  (`/auth/refresh`) or a `GET /auth/session` that belongs to anyone but the LadWani
  account joined to that hub id is refused (401) or reported as no session.
- **Audit**: `audit_logs` rows `auth.hub.sign_in` (a new session in this
  browser, or an account joined, made or given a role; a renewal of the person's
  own session is not written) and `auth.hub.refused` (with `reason`), entity type
  `hub_user`, entity id the hub id.
- **LadWani's second step**: every API answer to a request with a valid identity
  carries `X-Bkesari-Project-State: verified | pending`
  (`apps/api/src/auth/hub-identity.middleware.ts`). `verified` means the account
  joined to that hub id is ACTIVE and either its newest ID-proof review
  (`member.id_proof.verify`, sign-up step 4) was APPROVED by an Operator or Admin,
  or it holds LadWani's OPERATOR or ADMIN role
  (`apps/api/src/auth/project-state.service.ts`). The hub stores it on the grant and
  removes the header before the answer leaves bkesari.com. For a person whose
  account the hub sign-in just made, the web app records sign-up as under way
  (step 2), so the dashboard asks for their ID proof, as it does for anyone
  part-way through sign-up, and `/sign-up` carries on with profile, place and
  ID proof.
