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
database, nothing shared with the bkesari hub. The hub puts no gate in front of
`/ladwani/` and sends no `X-Bkesari-Token`; `POST /auth/hub`, `HUB_JWKS_URL` and
`HUB_JWKS` are gone (the `users.hub_user_id` column from migration
`20261025000000_hub_user_id` stays, unused, so the migration history holds).

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
