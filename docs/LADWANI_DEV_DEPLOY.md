# Deploying LadWani (rebuild) to dev, through the Hostinger connector

State on 2026-10-24, and the steps that are left. No secret is written here:
connection strings come from the Neon connector, and `JWT_SECRET` is
generated fresh.

## Already done

| What | Where |
|---|---|
| Neon database, schema and reference data | project `bkesari-ladwani` (`shy-water-73883631`), branch `dev` (`br-rapid-fire-b332ipk2`), database `bk_ladwani`, owner `bk_ladwani_app`. 73 tables plus `_prisma_migrations` (`20261024000000_postgres_baseline` recorded, so later `prisma migrate deploy` runs see it applied), 166 reference rows from the rebuild's own `seed.ts`, checked equal to a local build table by table |
| Hostinger sites | `devladwani.bkesari.com` and `devladwani-api.bkesari.com`, addon websites on order `1007038701`, user `u879099820`, folders `~/domains/<site>/public_html` |
| The code | Ladwani `claude/tender-cori-easrn7` at `edc4a81` (Ladwani#16, CI green) |

## Network access the session needs

Allowed domains: `mcp.hostinger.com`, `developers.hostinger.com`, and
`*.hstgr.io` (the file servers uploads go to, e.g. `srv1497-files.hstgr.io`).
Neon's port 5432 is blocked from cloud sessions; Neon's HTTPS/WebSocket
endpoints on 443 work.

## Build (in a scratch copy of `claude/tender-cori-easrn7`)

```bash
npm ci
export BASE_PATH=/ladwani NEXT_PUBLIC_API_URL=https://devladwani-api.bkesari.com NEXT_OUTPUT=standalone
npm run build --workspace=packages/shared-types
npm run db:generate --workspace=apps/api
npm run build --workspace=apps/api
npm run build --workspace=apps/web
```

Stage, as `.github/workflows/deploy-dev.yml` does, with one difference for the
web site: Hostinger's builder runs `npm install`, which would prune the
standalone server's `node_modules`, so they move next to `server.js`.

- **web** (`devladwani.bkesari.com`): copy `apps/web/.next/standalone/.`, move
  its `node_modules` to `apps/web/node_modules`, copy `apps/web/.next/static`
  to `apps/web/.next/static` (and `apps/web/public` if present), and replace
  `package.json` with one that has no dependencies, a no-op `build` script and
  `"start": "node apps/web/server.js"`. 42 MB; `zip -qr web.zip .`.
- **api** (`devladwani-api.bkesari.com`): root `package.json` and
  `package-lock.json`, `apps/api/{package.json,dist,prisma}`,
  `packages/shared-types/{package.json,dist}`. `zip -qr api.zip .`.

Both were smoke-tested from these stages on 2026-10-24: the web server answers
`/ladwani/login` 200 with its assets; the API, after `npm install --omit=dev`
and `npm run db:generate`, answers `/api/v1/health` with
`{"status":"ok","database":"ok"}`.

## Deploy with the Hostinger connector

1. `hosting_files_generate-upload-url` per site, then upload the zip with the
   two TUS requests in that operation's description.
2. API site `hosting_nodejs_replace-environment-variables`:
   - `DATABASE_URL`: the pooled string (`get_connection_string` on the Neon
     project above, branch `dev`, database `bk_ladwani`, role `bk_ladwani_app`)
   - `DATABASE_URL_UNPOOLED`: the same with `-pooler` removed from the host
   - `JWT_SECRET`: `openssl rand -hex 32`, generated there, never shown
   - `WEB_ORIGIN=https://dev.bkesari.com`, `NODE_ENV=production`,
     `TRUST_PROXY=loopback` (add the server's IPv4 once known; see
     docs/27-dev-deploy.md in Ladwani)
3. API site `hosting_nodejs_start-build`: `source_type` `archive`,
   `archive_path` `api.zip`, `app_type` `nest`, `root_directory` `.`,
   `build_script` `db:generate`, `entry_file` `apps/api/dist/main.js`,
   `node_version` 22, `package_manager` `npm`. Poll `hosting_nodejs_build`.
4. Web site `hosting_nodejs_start-build`: `archive_path` `web.zip`, `app_type`
   `other`, `root_directory` `.`, `build_script` `build`, `entry_file`
   `apps/web/server.js`, `node_version` 22. Environment: `HOSTNAME=0.0.0.0`
   only if the server does not answer on Hostinger's port.
5. Check: `https://devladwani-api.bkesari.com/api/v1/health` is 200 with
   `"database":"ok"`; `https://devladwani.bkesari.com/ladwani/login` renders;
   sign-up, sign-in (email in another case), a directory search and log-out
   work through `https://devladwani.bkesari.com/ladwani/`.

## dev.bkesari.com

Until 2026-10-24 `dev.bkesari.com` was a subdomain whose root was
**production's** `~/domains/bkesari.com/public_html`. The owner removed it, and
it is now its own website (addon, `~/domains/dev.bkesari.com/public_html`,
created 21:43 UTC), empty. To serve LadWani at `dev.bkesari.com/ladwani/`,
deploy the hub (bkesari-platform `portal/`) there as a Node.js app with
`LADWANI_ORIGIN=https://devladwani.bkesari.com` and its own Neon strings
(project `bkesari-hub`, branch `dev`); DEPLOY.md Part 1 has the rest. Until
then, LadWani is checked directly at `https://devladwani.bkesari.com/ladwani/`.
