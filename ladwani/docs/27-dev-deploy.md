# Deploying the dev tier

The rebuild runs as two processes on two Hostinger Node.js sites. The bkesari.com
hub serves the web app to visitors at **https://dev.bkesari.com/ladwani/**.

```
browser ── dev.bkesari.com/ladwani/... ──▶ hub (bkesari-platform, LADWANI_ORIGIN)
                                             │  prefix kept
                                             ▼
                        devladwani.bkesari.com/ladwani/...   apps/web  (Next.js, standalone)
                                             │  /ladwani/api/v1/* rewritten
                                             ▼
                        devladwani-api.bkesari.com/api/v1/*   apps/api  (NestJS)
                                             │
                                             ▼
                        Neon, branch `dev`, database `ladwani`, role `ladwani_app`
```

Pushing to the `dev` branch runs `.github/workflows/deploy-dev.yml`:

1. the whole of CI (`ci.yml`);
2. the dev-only guard, once per site;
3. the build, then rsync to each site, then a restart;
4. a report of any migrations in the push;
5. a smoke check of both sites.

It never applies migrations and never stores a database credential.

## The two sites

| | Web | API |
|---|---|---|
| Domain | `devladwani.bkesari.com` | `devladwani-api.bkesari.com` |
| What is uploaded | `.next/standalone` (its own `node_modules`), plus `.next/static` | `apps/api/{dist,prisma}`, `packages/shared-types`, root `package.json` + lockfile |
| Installed on the server | nothing | `npm ci --omit=dev --workspace=apps/api`, then `prisma generate` |
| Start command | `node apps/web/server.js` | `npm run start:api` |
| Path secret (GitHub `dev` environment) | `DEV_WEB_PATH` | `DEV_API_PATH` |
| Smoke URL (repository variable, optional) | `DEV_SMOKE_URL` = `https://devladwani.bkesari.com/ladwani/login` | `DEV_API_SMOKE_URL` = `https://devladwani-api.bkesari.com/api/v1/health` |

Both sites also use the shared secrets `DEV_SSH_HOST`, `DEV_SSH_USER`,
`DEV_SSH_PORT`, `DEV_SSH_KEY` and `DEV_SSH_KNOWN_HOSTS`. Each path must sit
inside a directory named exactly after its site, e.g.
`/home/<user>/domains/devladwani-api.bkesari.com/app`. The guard refuses
anything else, including one site's path pointing at the other's.

`/api/v1/health` answers 200 only when the API is up **and** its database
answers, and 503 when it cannot reach Neon.

## Environment, set on each site in hPanel

**API**

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon `dev` branch, database `ladwani`, role `ladwani_app`, **pooled** |
| `DATABASE_URL_UNPOOLED` | the same, **direct** (Prisma Migrate uses it) |
| `JWT_SECRET` | a long random value (`openssl rand -hex 32`). The API refuses to start in production without it. |
| `WEB_ORIGIN` | `https://dev.bkesari.com` |
| `NODE_ENV` | `production` (also makes the refresh cookie `Secure`) |
| `TRUST_PROXY` | `loopback, <the server's IP>` (see below) |

**`TRUST_PROXY`**: the API rate-limits per client IP. That means 20 requests a
minute, 5 logins per 15 minutes and 5 sign-ups an hour. Every request reaches
it through Hostinger's front end, and on dev also through the hub and the web
site. So without this setting all visitors share one budget, and one person's
mistyped password locks everyone out of signing in. Set it to our own hops:
`loopback` plus the server's IP. All three sites sit on the same server, so
that IP covers the hub and the web site; hPanel shows it. The API then counts
each visitor by the first address in `X-Forwarded-For` that isn't one of
those, which a caller can't forge. To check it after a deploy, make 6 bad
sign-in attempts from one network, then 1 from another (a phone on mobile
data). The other network should get 401, not 429.

**Database connections**: Neon suspends an idle compute after five minutes. The
API retires pooled connections idle for 30 s and allows 15 s to connect, so
the first request after a quiet spell doesn't fail with P1017. It adds both
to `DATABASE_URL` unless the URL already sets them.

**Web**: nothing. `BASE_PATH=/ladwani` and the API's address are compiled in by
the deploy's build. The host supplies `PORT`.

**Hub** (dev.bkesari.com, bkesari-platform): `LADWANI_ORIGIN=https://devladwani.bkesari.com`.

## Schema and reference data

On a new database, once:

```bash
# From the API site over SSH, with the two DATABASE_URL variables set:
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# Reference data (roles, permissions, lookups). The seed needs ts-node, a dev
# dependency, so run it from a full checkout against the same database:
DATABASE_URL=<direct URL> DATABASE_URL_UNPOOLED=<direct URL> \
  npm run db:seed --workspace=apps/api
```

The seed only upserts, so it is safe to run again. Later deploys report new
migrations in their summary. Apply them with the same `migrate deploy`.

## Known gap

New accounts are verified with a mobile OTP, but no SMS provider is wired in.
Outside production (`NODE_ENV` not `production`) the OTP is returned in the
sign-up response. On the dev site (`NODE_ENV=production`) it is not, so new
accounts stay `PENDING`. They can still sign in: only suspended or blocked
accounts are refused.
