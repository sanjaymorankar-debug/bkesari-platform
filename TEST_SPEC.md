# bkesari hub (portal) — test specification

The hub is the Node.js (Express) app behind **bkesari.com**, `test.bkesari.com` and
`dev.bkesari.com`: the hub's own pages (home with the project tiles, about, contact, privacy,
terms, the project chooser at `/auth/sign-in`, branded 404/500), the hub admin at `/admin` with
its own login, the **Kesari** design system (`packages/kesari-ui`, served at `/kesari-ui/1.0.0/`)
and the app shell every project includes (`portal/public/shared/menu.js`), the static Global
Warming and Driving Simulator pages, **TaskList** at `/tasklist/` with its own accounts
(`portal/tasklist.js`, `portal/project-auth.js`), the read-only **ATIP viewer** at `/ATIP/` (and `/atip/`), the
proxy that serves `/edu/` from its own app (`portal/proxy.js`), and **LadWani** at `/ladwani/`,
which the hub serves itself (`portal/ladwani.js`: the static export of `ladwani/apps/web` and
LadWani's NestJS API, in the hub's process). Its
data is in **PostgreSQL on Neon** (database `neondb`, role `bk_portal_app`, one Neon branch per
tier; [docs/NEON.md](docs/NEON.md)). This spec covers the hub and everything else in this
repository outside `edu/` and `database/edu/`: the tests, the smoke and parity scripts, the CI
and deploy workflows and their guard, the hand-run SQL under `database/`, `tools/`, and
`ladwani/` through LadWani's own checks (#6a–#6c, #9a) and the hub's serving of it. What a
deployed tier needs on top (hPanel, SSH, a browser) is [TESTING.md](TESTING.md); this file does
not repeat it.

Testing agent: `.claude/agents/portal-tester.md`. It runs automatically after every code change
(the test gate, `.claude/hooks/test_gate.py`); run it by hand by asking Claude to "run the
portal-tester agent".

## 1. Scope

| Component | Path | Language / framework |
|---|---|---|
| Hub server, routes, security headers | `portal/server.js` | Node 22, Express 4 |
| The hub's pages and admin | `portal/hub.js`, `portal/hub-pages.js`, `portal/i18n/hub.json` | Node 22, Express 4 |
| Per-project sign-in (TaskList, hub admin) | `portal/project-auth.js`, `portal/notify.js` | Node 22, bcryptjs |
| TaskList | `portal/tasklist.js`, `portal/public/tasklist/**` | Node 22; browser JS |
| Kesari design system | `packages/kesari-ui/**` (built to `portal/public/kesari-ui/1.0.0/`) | CSS, browser JS, esbuild |
| The shared-ID migration | `tools/migrate_shared_id.mjs` | Node ESM, pg |
| Mobile shells | `mobile/**` (Capacitor configs; not built here) | JSON, HTML |
| Database layer and schema | `portal/db.js`, `portal/sql/schema.sql`, `database/portal/01_portal_schema.sql` | node-postgres 8, PostgreSQL 16 |
| Proxy to the project tabs | `portal/proxy.js` | http-proxy-middleware 4 |
| LadWani served by the hub (static export, in-process API, gate) | `portal/ladwani.js` | Node 22, Express 4 |
| LadWani itself (subtree of the Ladwani repository) | `ladwani/` (`apps/api`, `apps/web`, `packages/shared-types`) | NestJS 10 + Prisma 5, Next.js 14, npm workspaces |
| App shell, static pages, style guide | `portal/public/**` | browser JS, HTML, CSS |
| Smoke and Neon-parity scripts | `scripts/smoke-dev.sh`, `scripts/neon-parity.sh` | bash, curl, psql |
| CI, dev deploy, deploy guard | `.github/workflows/*.yml`, `.github/deploy/guard.sh` | GitHub Actions, bash |
| Neon provisioning, local setup, Git checker | `tools/neon_provision.mjs`, `tools/setup_local_postgres.sh`, `tools/check_local_git.sh` | Node ESM, bash |
| Hand-run SQL | `database/portal/`, `database/ladwani/`, `database/local/` | PostgreSQL |
| Tests | `tests/*.test.js`, `.github/deploy/guard.test.sh` | `node:test`, bash |

Out of scope, and why:

- `edu/` and `database/edu/` — the `edu-tester` agent and `edu/TEST_SPEC.md`. Do not build,
  install or run anything there. (`deploy-dev-edu.yml` and the `edu` job in `ci.yml` are theirs
  too; this spec only parses their YAML.)
- The app behind `/edu/` — the `edu-tester`. Only the hub's forwarding is tested here, against
  a throwaway upstream (and `/ladwani/` the same way, for the proxy route LadWani still has when
  its export is not built).
- LadWani's behaviour beyond what its own suites check (#6a–#6c, #9a): its integration tests
  (`npm run test:integration`, which need their own database) and its screens. The hub's tests
  use a stand-in export and API (`tests/ladwani.test.js`); S5 runs the real export and API.
- Neon itself. Nothing here connects to it: there are no credentials in the repository, and
  tests must never reach a hosted database. `tools/neon_provision.mjs` is tested against a fake
  Neon API; the app's Neon behaviour is tested against a Neon-like local bed (S7).
- `atip/` (a README pointing at the ATIP-DEV repository) and ATIP itself.
- Hostinger, Passenger and the deploy job of `deploy-dev-portal.yml` (needs SSH secrets). The
  guard that protects it is tested (S2/R2).

## 2. Environment

### 2.1 Tools

| Tool | CI (`ci.yml`) | Mac ([docs/MAC_DEPLOYMENT.md](docs/MAC_DEPLOYMENT.md)) |
|---|---|---|
| Node | 22 (`actions/setup-node`); `package.json` allows >= 20 | `brew install node@22` |
| PostgreSQL | `postgres:16` service container | `brew install postgresql@16` (psql comes with it) |
| bash, curl, git | ubuntu-latest | macOS built-ins (bash 3.2 is enough) |
| PyYAML (S1 only) | preinstalled | `python3 -m pip install --user pyyaml` |
| PgBouncer (S7 only) | not used | `brew install pgbouncer` (section 2.6) |

### 2.2 The scratch databases

Three throwaway PostgreSQL databases, all **owned by one non-superuser login role**. Nothing
else may use them:

| Name in this spec | Used by | What happens to it | Mac | This repo's CI |
|---|---|---|---|---|
| suite database (`TEST_DATABASE_URL`) | S3 / R1 | **each PostgreSQL test file drops and recreates a schema of its own (`t_db`, `t_hub`, `t_tasklist`, `t_migrate`)** | `bk_portal_test` | `bk_portal_test` in the service container |
| smoke database (`SMOKE_DATABASE_URL`) | S4, S5, S7 | **S7 drops the tracker tables**; S5 writes rows | `bk_portal_smoke` | not used (CI's smoke runs on the suite database) |
| LadWani smoke database (`LADWANI_SMOKE_DATABASE_URL`) | S5's LadWani step | LadWani's schema (`prisma migrate deploy`) and reference data (its seed); S5 signs in through the hub, which adds a LadWani user, and stores a webhook event | `bk_ladwani_smoke` | not used |

Never a Neon database, a `_dev`/`_test`/`_prod` database on a server, or anything an app
uses. The tests read only `TEST_DATABASE_URL`, never `DATABASE_URL` or `DB_*`, so a developer's
`.env` cannot point them at real data by accident.

On the Mac, once (as yourself; Homebrew's PostgreSQL makes your user a superuser):

```bash
cd ~/Projects/bkesari-platform
tools/setup_local_postgres.sh                      # creates role bk_portal, bk_portal and bk_portal_test,
                                                   # and writes TEST_DATABASE_URL into .env
grep '^TEST_DATABASE_URL=' .env > .env.test        # what `npm run test:pg` reads (.env.test is gitignored)
createdb -O bk_portal bk_portal_smoke
psql -d postgres -c 'REVOKE CONNECT ON DATABASE bk_portal_smoke FROM PUBLIC'
. ~/.bkesari_local_postgres.env                    # BK_PORTAL_PASS, written by the setup script
export SMOKE_DATABASE_URL="postgresql://bk_portal:$BK_PORTAL_PASS@127.0.0.1:5432/bk_portal_smoke"
createdb -O bk_portal bk_ladwani_smoke
psql -d postgres -c 'REVOKE CONNECT ON DATABASE bk_ladwani_smoke FROM PUBLIC'
export LADWANI_SMOKE_DATABASE_URL="postgresql://bk_portal:$BK_PORTAL_PASS@127.0.0.1:5432/bk_ladwani_smoke"
```

Any other machine: create a login role that is not a superuser, three databases it owns, and set
`TEST_DATABASE_URL` (in `.env.test`), `SMOKE_DATABASE_URL` and `LADWANI_SMOKE_DATABASE_URL` to
them. LadWani's schema goes into its database once per run (2.5).

### 2.3 Environment variables

| Variable | Read by | Safe local value |
|---|---|---|
| `TEST_DATABASE_URL` | `tests/db.pg.test.js`, `tests/hub.pg.test.js`, `tests/tasklist.pg.test.js`, `tests/migrate.pg.test.js` | the suite database. Unset: their five PostgreSQL suites skip, which is a failure at S3 |
| `SMOKE_DATABASE_URL` | this spec's S4/S5 commands | the smoke database |
| `DATABASE_URL` | the app | S4/S5: `$SMOKE_DATABASE_URL`. On Neon the pooled string |
| `DATABASE_URL_UNPOOLED` | the app, schema setup only | blank is fine (S5 leaves it unset; S7 sets it) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`, `DB_POOL_MAX` | the app, when there is no `DATABASE_URL` | blank is fine; **unset them** in the shell that starts the hub, so a stray value cannot win |
| `PORT` | the app | `3101` |
| `APP_ENV` | the app (tier) | `dev` |
| `HUB_ADMIN_EMAIL`, `HUB_ADMIN_PASSWORD` | the first hub admin, created at start when there is none (the owner role when the address is on `HUB_OWNER_EMAILS`) | `smoke@example.com` / `smoke-local-only` |
| `HUB_AUTH_SECRET` | the hub's and (derived) TaskList's and LadWani's secrets | any 32+ characters, e.g. `smoke-local-only-secret-0123456789abcdef` |
| `TRUST_PROXY` | Express `trust proxy` (rate limits, LadWani's visitor) | unset (= `loopback`) |
| `SMS_WEBHOOK_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_WEBHOOK_URL` (each also with a `TASKLIST_`/`HUB_` prefix) | where one-time codes and reset links go (`portal/notify.js`) | **unset**: dev and test then show the code on screen; production refuses |
| `ATIP_USER`, `ATIP_PASSWORD` | `/ATIP/` login (unset = 503: fails closed) | `smoke` / `smoke-local-only` |
| `ATIP_PUBLISH_TOKEN` | snapshot upload | `smoke-local-token` |
| `EDU_ORIGIN`, `LADWANI_ORIGIN` | the proxy | blank, except in S5's proxy step (`EDU_ORIGIN=http://127.0.0.1:3111`). Blank `EDU_ORIGIN` while `APP_ENV` names a tier means that tier's live Education site (`TIER_ORIGINS` in `portal/proxy.js`), so a hub that must stay local sets it to a local upstream or leaves `APP_ENV` blank (`server.test.js`, `ladwani.test.js` do). LadWani has no tier default, and `LADWANI_ORIGIN` is ignored while its export is built (server.js serves it itself) |
| `LADWANI_DATABASE_URL` | LadWani's API in the hub (`portal/ladwani.js`) | unset (the pages are served and the API answers 503), except in S5's LadWani step: `$LADWANI_SMOKE_DATABASE_URL`. Never a Neon branch |
| `LADWANI_JWT_SECRET`, `LADWANI_TRUST_PROXY` | LadWani's API in the hub | unset (the secret is then derived from the hub's key; the rate limits count per signed-in person, not per address, so no trust-proxy setting is needed for them) |
| `LADWANI_VISITOR_HEADER` | LadWani's rate limits (`VisitorThrottlerGuard`) | never set by hand: `portal/ladwani.js` sets it in the hub's process. Standalone LadWani without it counts per IP and ignores the header |
| `TOKIO_WORKER_THREADS` | LadWani's database engine (Prisma's, a tokio runtime) in the hub's process | unset: `portal/ladwani.js` sets it to `ENGINE_THREADS` (2) before the engine loads, and the startup log says `LadWani API: ready (database engine: 2 worker threads; the server shows N CPUs)`. A site value wins only if it is a whole number above 0; anything else stops LadWani's API (the engine would abort the whole process) |
| `LADWANI_SMOKE_DATABASE_URL` | this spec's 2.5 and S5 commands | the LadWani smoke database |
| `PARITY_POOLED_URL`, `PARITY_DIRECT_URL`, `PARITY_PORT`, `PARITY_IDLE_SECONDS` | `scripts/neon-parity.sh` | section 2.6 |
| `NODE_EXTRA_CA_CERTS` | Node, S7 only | the local CA that signed the bed's certificate. Never turn verification off instead |

### 2.4 Ports

`3101` the hub (S4, S5, S7). `3111` the throwaway upstream in S5's proxy step. Nothing else.
Stop every process you start; check with `lsof -nP -iTCP:3101 -iTCP:3111 -sTCP:LISTEN` (or
`ss -ltn`) at the end.

### 2.5 One-time setup per run

```bash
npm ci                         # the hub; never inside edu/
npm --prefix ladwani ci --include=dev    # LadWani's workspaces (its own lockfile)
test -f .env.test || echo "create .env.test (2.2) first"
# LadWani's shared types and Prisma client (#6a-#6c need them), then its schema and reference
# data into its smoke database (idempotent):
npm --prefix ladwani run build --workspace=packages/shared-types >/dev/null
( cd ladwani/apps/api && npm run db:generate >/dev/null && \
  DATABASE_URL="$LADWANI_SMOKE_DATABASE_URL" DATABASE_URL_UNPOOLED="$LADWANI_SMOKE_DATABASE_URL" npx prisma migrate deploy && \
  DATABASE_URL="$LADWANI_SMOKE_DATABASE_URL" npm run db:seed )
```

### 2.6 The Neon-like bed (S7)

S7 needs what makes Neon different from a laptop PostgreSQL: a **direct** endpoint with TLS, a
**pooled** endpoint that is PgBouncer in **transaction** mode and refuses connections without
TLS, SCRAM authentication, and an app role that is not a superuser, owns its database and is a
member of a `neon_superuser` stand-in. Use the smoke database:

```bash
export PARITY_DIRECT_URL="postgresql://ROLE:PW@127.0.0.1:5432/SMOKE_DB?sslmode=require&channel_binding=require"
export PARITY_POOLED_URL="postgresql://ROLE:PW@127.0.0.1:6432/SMOKE_DB?sslmode=require&channel_binding=require"
export NODE_EXTRA_CA_CERTS=/path/to/the/ca.crt   # node-postgres verifies on sslmode=require
```

The `neon_superuser` stand-in, once, as a superuser:

```sql
DO $$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='neon_superuser')
THEN CREATE ROLE neon_superuser NOLOGIN CREATEDB CREATEROLE; END IF; END$$;
GRANT neon_superuser TO bk_portal;
```

A bed is: `ssl = on` in `postgresql.conf` with a certificate for `localhost`/`127.0.0.1` signed
by a CA you hold, and a `pgbouncer.ini` with `pool_mode = transaction`,
`max_prepared_statements = 1000`, `auth_type = scram-sha-256` (with `auth_user`/`auth_query`
reading `pg_shadow`, or an `auth_file`), `client_tls_sslmode = require` and the same
certificate. That is the bed this spec was measured on (Linux, PgBouncer 1.22). On the Mac it is
Homebrew's `postgresql@16` and `pgbouncer`; that combination has not been tried. Without a bed,
S7 cannot run (section 6).

S7 ends **every other session of that role** (that is the point: it is what Neon's suspend does),
including a local hub you have running on the same role, which then reconnects. Run it after
R1, never alongside it. Like S5's first hub, the parity hub runs `APP_ENV=dev`, so its smoke step
sends `/edu/` to the Education dev site unless `EDU_ORIGIN` is exported to a local upstream.

## 3. Standard suite

Run in order, from the repository root, with `.env.test` and `SMOKE_DATABASE_URL` set (2.2).
Record each command's exit code, counts and duration.

| # | Level | Command | Passes when |
|---|---|---|---|
| 1 | S1 static | `npm run check` | exit 0 |
| 2 | S1 static | `node --check tools/neon_provision.mjs && node tools/neon_provision.mjs --help >/dev/null` | exit 0 |
| 3 | S1 static | `for f in scripts/*.sh .github/deploy/*.sh tools/*.sh; do bash -n "$f" \|\| echo "FAIL $f"; done` | prints nothing |
| 4 | S1 static | `python3 -c "import sys,yaml; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml` | exit 0 |
| 5 | S1 static | the no-inline-script check below | `inline scripts: 0`, exit 0 |
| 6 | S2 unit | `set -o pipefail; env -u TEST_DATABASE_URL npm test 2>&1 \| tee /tmp/portal-s2.txt` | exit 0; exactly five `# SKIP` lines, the five PostgreSQL suites (node counts them under `# suites`, not `# skipped`); guard `32 passed, 0 failed` |
| 6a | S2 LadWani unit | `npm --prefix ladwani test` (Jest, `ladwani/apps/api`; no database) | exit 0; `Tests:` 0 failed, 0 skipped, count at or above section 5 |
| 6b | S2 LadWani types | `npm --prefix ladwani run typecheck` (api, then web) | exit 0 |
| 6c | S2 LadWani lint | `npm --prefix ladwani run lint --workspace=apps/web` | exit 0, no `Error:` line; list the warnings in the report (section 5 has the expected ones) |
| 7 | S3 integration | `set -o pipefail; npm run test:pg 2>&1 \| tee /tmp/portal-r1.txt && grep -c '# SKIP' /tmp/portal-r1.txt` | the tests exit 0, `grep` prints **0** (it then exits 1, which is the good case), guard 32/32 |
| 8 | S3 integration | the hand-run SQL load below | exit 0 |
| 9 | S4 build | the deploy-bundle boot below | `bundle boots: 200` |
| 9a | S4 LadWani build | the LadWani build below (`build:embedded` without its `npm install`) | exit 0; `ladwani/apps/web/out/index.html` and `ladwani/apps/api/dist/main.js` exist; the route list shows the ten `[param]` pages each built once, as `/…/_` |
| 10 | S5 smoke | the smoke run below (needs #9a's export) | smoke-dev.sh `0 failed, 0 warnings` (`APP_ENV=dev` fills in the Education dev site, whose own sign-in page now answers `/edu/`, so its Livewire checks run; the hub serves LadWani); every probe `ok`; `S5 failures: 0` |
| 11 | S6 security | the security checks below | `S6 failures: 0` |
| 12 | S6 hygiene | `npm audit --omit=dev`; `npm --prefix ladwani audit --omit=dev` | report only: list advisories in the report; fix only if trivial. LadWani's run in the hub's process (Nest, Prisma); its Next.js only builds the export |
| 13 | S7 Neon parity | `bash scripts/neon-parity.sh` (2.6) | `Neon parity passed.`, exit 0 |

**#5, no inline scripts.** The hub and TaskList send `Content-Security-Policy: script-src 'self'`,
so a page with an inline script or an inline event handler breaks there. Every page script is a
file; this proves none crept back:

```bash
node -e '
const fs=require("fs"),path=require("path");let bad=0,n=0;
const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
for (const f of walk("portal/public").filter((f)=>f.endsWith(".html"))) { n++; const h=fs.readFileSync(f,"utf8");
  if (/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(h) || /\son[a-z]+="/i.test(h)) { console.log("inline script in",f); bad++; } }
console.log("pages checked:", n, "inline scripts:", bad); process.exit(bad?1:0);'
```

**#8, hand-run SQL**, as the non-superuser owner, inside a transaction that is rolled back, so
nothing is left behind. Proves the files DEPLOY.md and NEON.md tell people to run with `psql`
load on PostgreSQL without superuser, and that the portal copy is re-runnable:

```bash
psql "$SMOKE_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
SET client_min_messages = warning;
BEGIN;
\i database/portal/01_portal_schema.sql
\i database/portal/01_portal_schema.sql
CREATE SCHEMA parity_ladwani; SET LOCAL search_path = parity_ladwani;
\i database/ladwani/01_ladwani_schema.sql
\i database/ladwani/02_ladwani_reference_data.sql
\i database/ladwani/02_ladwani_reference_data.sql
\i database/ladwani/03_ladwani_first_admin.sql
ROLLBACK;
SQL
```

(`database/local/00_local_create_databases.sql` creates roles for every project and needs a
superuser, so it is not run; see Known gaps.)

**#9, the deploy bundle.** The dev deploy uploads only `package.json`, `package-lock.json` and
`portal/`, then runs `npm ci --omit=dev`. Prove that set starts on its own:

```bash
curl -s -o /dev/null --max-time 2 http://127.0.0.1:3101/ && echo "FAIL something is already on 3101"
B=$(mktemp -d); cp package.json package-lock.json "$B"/ && cp -R portal "$B"/
( cd "$B" && npm ci --omit=dev --no-audit --no-fund --prefer-offline >/dev/null ) || echo "FAIL npm ci"
cd "$B"   # node itself in the background, so $! is node's pid and the kill below stops it
env -u DB_HOST -u DB_NAME -u DB_USER -u DB_PASSWORD -u DATABASE_URL_UNPOOLED \
  DATABASE_URL="$SMOKE_DATABASE_URL" PORT=3101 node portal/server.js >"$B/hub.log" 2>&1 & BUNDLE=$!
cd - >/dev/null
for i in $(seq 1 40); do curl -fsS -o /dev/null http://127.0.0.1:3101/ 2>/dev/null && break; sleep 0.5; done
echo "bundle boots: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/)"
kill $BUNDLE; wait $BUNDLE 2>/dev/null; rm -rf "$B"
```

(The bundle has no `ladwani/`, so its `/ladwani/` is the "not on this tier yet" page: the dev
deploy does not ship LadWani; `build:hostinger` on the hub site does.)

**#9a, the LadWani build**, what `npm run build:hostinger` builds after `check`, minus its
`npm install` (2.5 did that). S5 serves this export:

```bash
npm --prefix ladwani run build --workspace=packages/shared-types && \
npm --prefix ladwani run db:generate --workspace=apps/api && \
npm --prefix ladwani run build --workspace=apps/api && \
( cd ladwani/apps/web && BASE_PATH=/ladwani NEXT_OUTPUT=export NEXT_BUILD_CPUS=1 npx next build ) && \
test -f ladwani/apps/web/out/index.html && test -f ladwani/apps/api/dist/main.js && echo "LadWani built"
```

**#10, the smoke run.** The hub from the working tree, on the smoke database, on 3101, with
throwaway settings, then `scripts/smoke-dev.sh` (what CI and the dev deploy run), then the probes
it cannot make without an account, then the proxy with a throwaway upstream, then LadWani in the
hub's process with its real API on the LadWani smoke database. Since 3 Nov 2026 nothing sits in
front of LadWani or Education: each signs its own people in, so the hub's own `server.js` is
started every time (there is no signed-in stand-in any more).

```bash
export BASE=http://127.0.0.1:3101 U=smoke PW=smoke-local-only TOKEN=smoke-local-token
HUBLOG=$(mktemp); F=0
start_hub() {  # extra VAR=value pairs are passed to the hub
  if curl -s -o /dev/null --max-time 2 "$BASE/"; then echo "FAIL something is already on 3101"; F=$((F+1)); return 1; fi
  env -u DB_HOST -u DB_PORT -u DB_NAME -u DB_USER -u DB_PASSWORD -u DB_SSL -u DATABASE_URL_UNPOOLED \
    DATABASE_URL="$SMOKE_DATABASE_URL" PORT=3101 APP_ENV=dev HUB_AUTH_SECRET=smoke-local-only-secret-0123456789abcdef \
    HUB_ADMIN_EMAIL=smoke@example.com HUB_ADMIN_PASSWORD=$PW HUB_OWNER_EMAILS=smoke@example.com ATIP_PUBLISH_TOKEN=$TOKEN \
    "$@" node portal/server.js >"$HUBLOG" 2>&1 & HUB=$!
  for i in $(seq 1 40); do curl -fsS -o /dev/null "$BASE/" 2>/dev/null && return; sleep 0.5; done; echo "FAIL hub did not start"; F=$((F+1))
}
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
want() { local exp=$1; shift; local got; got=$(code "$@")
  if [ "$got" = "$exp" ]; then echo "ok    $exp  $*"; else echo "FAIL  want $exp got $got  $*"; F=$((F+1)); fi; }
has() { if printf '%s' "$1" | grep -qF -- "$2"; then echo "ok    has '$2'"; else echo "FAIL  missing '$2'"; F=$((F+1)); fi; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(process.argv[1].split(".").reduce((a,k)=>a&&a[k],o))})' "$1"; }
J='content-type: application/json'

start_hub
bash scripts/smoke-dev.sh "$BASE" --env dev || F=$((F+1))
has "$(curl -sI "$BASE/" | tr -d '\r')" 'X-Bkesari-Env: dev'
has "$(curl -s "$BASE/")" 'Driving Simulator';  has "$(curl -s -H 'cookie: k_lang=mr' "$BASE/")" 'lang="mr"'
# TaskList: its own account, made with mobile + OTP (the dev tier shows the code), its own cookie.
TL=$(mktemp); C=$(curl -s -c $TL "$BASE/tasklist/api/auth/session" | json csrf)
OTP=$(curl -s -b $TL -c $TL -H "$J" -H "x-csrf-token: $C" -d '{"mobile":"9876500999","purpose":"sign-up"}' "$BASE/tasklist/api/auth/otp/send" | json devCode)
C=$(curl -s -b $TL -c $TL -H "$J" -H "x-csrf-token: $C" -d "{\"mobile\":\"9876500999\",\"code\":\"$OTP\",\"name\":\"S5\"}" "$BASE/tasklist/api/auth/otp/verify" | json csrf)
has "$(grep tl_sid $TL)" '/tasklist'
want 201 -b $TL -H "$J" -H "x-csrf-token: $C" -d '{"text":"S5 smoke tomorrow 5pm #s5"}' "$BASE/tasklist/api/quick-add"
has "$(curl -s -b $TL "$BASE/tasklist/api/tasks")" '"due_time":"17:00"'
want 403 -b $TL -H "$J" -d '{"title":"no token"}' "$BASE/tasklist/api/tasks"
want 401 -b $TL "$BASE/admin/api/state"          # TaskList's session is no one at the hub
want 404 -b $TL "$BASE/ATIP/"
want 410 "$BASE/tasks/api/overview";  has "$(curl -sI "$BASE/tasks/" | tr -d '\r')" 'Location: /tasklist/'
# The hub admin: its own login, Path=/ cookie, and the owner's ATIP.
AD=$(mktemp); C=$(curl -s -c $AD "$BASE/admin/api/auth/session" | json csrf)
want 401 -b $AD -H "$J" -H "x-csrf-token: $C" -d '{"identifier":"smoke@example.com","password":"wrong-one-1"}' "$BASE/admin/api/auth/sign-in"
want 200 -b $AD -c $AD -H "$J" -H "x-csrf-token: $C" -d "{\"identifier\":\"smoke@example.com\",\"password\":\"$PW\"}" "$BASE/admin/api/auth/sign-in"
want 401 -b $AD "$BASE/tasklist/api/tasks"       # the hub admin is no one in TaskList
want 401 -H 'authorization: Bearer wrong' -H "$J" -d '{"html":"<html><body>x</body></html>"}' "$BASE/ATIP/api/snapshot"
want 200 -H "authorization: Bearer $TOKEN" -H "$J" -d '{"html":"<html><body><p>S5 snapshot</p></body></html>","trade_date":"2026-10-24"}' "$BASE/ATIP/api/snapshot"
want 404 "$BASE/ATIP/";  want 404 "$BASE/ATIP"
V=$(curl -s -D - -b $AD "$BASE/ATIP/" | tr -d '\r')
has "$V" "connect-src 'none'";  has "$V" 'S5 snapshot';  has "$V" 'class="ks-bar';  has "$V" 'id="bk-readonly"'
kill $HUB; wait $HUB 2>/dev/null

# The proxy, with the real server.js: a throwaway upstream on 3111 that echoes what it got.
# Nothing gates the tabs any more, and no hub token is ever forwarded, forged or not.
# With #9a's export built, server.js serves /ladwani/ itself and ignores LADWANI_ORIGIN; the
# Education lines are the proxy's.
node -e 'require("http").createServer((q,r)=>{let b="";q.on("data",c=>b+=c).on("end",()=>{r.setHeader("content-type","application/json");r.end(JSON.stringify({url:q.url,body:b,token:q.headers["x-bkesari-token"]||null}))})}).listen(3111,"127.0.0.1")' & UP=$!
sleep 0.5
start_hub EDU_ORIGIN=http://127.0.0.1:3111
has "$(curl -s "$BASE/edu/login")" '"url":"/login"'
has "$(curl -s -H 'x-bkesari-token: forged' "$BASE/edu/login")" '"token":null'
has "$(curl -s -H "$J" -d '{"qty":3}' "$BASE/edu/api/orders")" '"body":"{\"qty\":3}"'
has "$(curl -sI "$BASE/education/sign-in" | tr -d '\r')" 'Location: /edu/sign-in'
kill $UP; wait $UP 2>/dev/null; sleep 0.5
E=$(curl -s "$BASE/edu/login"); has "$E" 'not responding'; has "$E" 'data-project="education"'
kill $HUB; wait $HUB 2>/dev/null

# LadWani served by the hub itself (portal/ladwani.js), from #9a's export, with its real API in
# the hub's process on the LadWani smoke database; its startup line names the engine's thread cap.
# The webhook line is the one that needs the API mounted before the hub's body parsers: it checks
# its signature over the raw body, which only its own parser keeps.
# (A new event id each run: LadWani answers 500 to an unsigned event id it already holds.)
A=$(cd ladwani/apps/web/out && ls _next/static/chunks/*.js | head -1)
start_hub LADWANI_DATABASE_URL="$LADWANI_SMOKE_DATABASE_URL"
# The hub answers before LadWani's API has started (it is a 503 until then), so wait for its line.
for i in $(seq 1 40); do grep -q 'LadWani API:' "$HUBLOG" && break; sleep 0.25; done
has "$(cat "$HUBLOG")" 'LadWani API: ready (database engine: 2 worker threads; the server shows '
has "$(curl -sI "$BASE/ladwani/$A" | tr -d '\r')" 'Cache-Control: public, max-age=31536000, immutable'
has "$(curl -sI "$BASE/ladwani?x=1" | tr -d '\r')" 'Location: /ladwani/?x=1'
has "$(curl -s "$BASE/ladwani/")" 'app/page-'
has "$(curl -s "$BASE/ladwani/sign-in/")" 'This is a separate account for LadWani.'
has "$(curl -s "$BASE/ladwani/family/cmv7x2/")" 'app/family/%5Bid%5D/page-'
has "$(curl -s "$BASE/ladwani/api/v1/health")" '"database":"ok"'
has "$(curl -s "$BASE/ladwani/api/v1/auth/session")" '"user":null'
want 404 -X POST "$BASE/ladwani/api/v1/auth/hub"          # the hub login is gone
has "$(curl -s -H "$J" -H 'x-webhook-signature: s5' -d "{\"id\":\"evt_s5_$(date +%s%N)\",\"event\":\"payment.captured\"}" "$BASE/ladwani/api/v1/webhooks/payments")" '"received":true'
want 404 --path-as-is "$BASE/ladwani/%2e%2e/%2e%2e/%2e%2e/package.json"
kill $HUB; wait $HUB 2>/dev/null
echo "S5 failures: $F"
```

**#11, security checks.** In the same shell as #10 (it reuses `start_hub`, `want` and `J`):

```bash
F=0; start_hub
# No tracked secrets.
git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.example$' && { echo "FAIL tracked .env"; F=$((F+1)); }
git log --all --name-only --format= | grep -E '(^|/)\.env$' && { echo "FAIL .env in history"; F=$((F+1)); }
# TaskList's app pages and API need TaskList's own session however the path is spelled.
for p in /tasklist/ /tasklist/board /tasklist/api/tasks /tasklist/api/bootstrap '/%74asklist/api/tasks' '//tasklist/api/tasks' \
         '/./tasklist/api/tasks' '/shared/../tasklist/api/tasks' '/TASKLIST/api/tasks'; do
  c=$(code --path-as-is -H 'cookie: tl_sid=forged-forged-forged-forged; hub_admin_sid=x' "$BASE$p")
  case "$c" in 301|302|401|404) echo "ok    $c  $p";; *) echo "FAIL  $p answered $c"; F=$((F+1));; esac; done
# A malformed body is a 400 that names no file, line or stack frame.
for p in /tasklist/api/tasks /tasklist/api/auth/sign-in /admin/api/auth/sign-in /ATIP/api/snapshot; do
  b=$(curl -s -o - -w '\n%{http_code}' -H "$J" -d '{bad' "$BASE$p")
  case "$b" in *node_modules*|*'    at '*|*'&nbsp;at '*) echo "FAIL stack trace from $p"; F=$((F+1));; *) echo "ok    no stack trace from $p";; esac
  [ "${b##*$'\n'}" = 400 ] && echo "ok    400 from $p" || { echo "FAIL want 400 from $p, got ${b##*$'\n'}"; F=$((F+1)); }
done
# Security headers: the hub's strict CSP, nosniff, frame denial; ATIP keeps its own policy.
H=$(curl -sI "$BASE/" | tr -d '\r')
has "$H" "script-src 'self';";  has "$H" 'X-Content-Type-Options: nosniff';  has "$H" 'X-Frame-Options: DENY'
# Cross-site sign-in attempts are refused before any password is checked.
C=$(curl -s "$BASE/tasklist/api/auth/session" | json csrf)
want 403 -H "$J" -H 'origin: https://evil.example' -H "x-csrf-token: $C" -d '{"identifier":"a@b.co","password":"x"}' "$BASE/tasklist/api/auth/sign-in"
# No certificate checks switched off, and no local CA baked into the app (Neon uses a public CA).
grep -rnE "rejectUnauthorized: *false|NODE_TLS_REJECT_UNAUTHORIZED|/etc/neonlike|sslmode=no-verify" portal/ \
  | grep -vF "if (v === 'no-verify') return { rejectUnauthorized: false };" && { echo "FAIL TLS weakened"; F=$((F+1)); }
# LadWani (portal/ladwani.js, #9a's export): no spelling reaches a file outside the export, and a
# build-asset miss is a bare 404. (package.json has "name"; the export's 404 page has a <p>.)
for p in '/ladwani/%2e%2e/%2e%2e/package.json' '/ladwani/_next/static/missing.js' '/ladwani/_next/static/%2e%2e/%2e%2e/index.html' \
         '/ladwani/_next/static/../../login/' '/ladwani/_next/static/chunks/..%2f..%2f..%2findex.html' '/LADWANI/..%2f..%2fpackage.json'; do
  b=$(curl -s --path-as-is -w '\n%{http_code}' --max-time 10 "$BASE$p")
  case "$b" in *'"name":'*) echo "FAIL  $p reached a file outside the export"; F=$((F+1));;
    *) echo "ok    $p stays inside the export (${b##*$'\n'})";; esac; done
kill $HUB; wait $HUB 2>/dev/null
echo "S6 failures: $F"
```

(The one allowed match is `DB_SSL=no-verify`, an explicit, documented opt-out for the `DB_*`
settings.)

## 4. Regression suite

### R1 — the full test suite

`npm run test:pg` — every file in `tests/` against the suite database, plus the 32 deploy-guard
cases. Nothing may skip. CI runs the same tests (`npm test` with `TEST_DATABASE_URL` set) and
fails on a skip.

### R2 — critical regressions

| ID | Behaviour that must never break | Checked by |
|---|---|---|
| PORTAL-CR-01 | TaskList's app pages and API need TaskList's own session however the path is spelled; a forged or another project's cookie opens nothing | `server.test.js` :: TaskList's pages and API need TaskList's own sign-in…; S6 path loop |
| PORTAL-CR-02 | `/ATIP/` is the owner's alone: the hub admin with the owner role (or `ATIP_USER`/`ATIP_PASSWORD`); everyone else, an editor admin included, gets a plain 404 | `hub.pg.test.js` :: ATIP is the owner's alone…; `smoke-dev.sh` *Access control*; S5 ATIP lines |
| PORTAL-CR-03 | The snapshot upload needs the bearer token, and keeps only the newest snapshot | `hub.pg.test.js` :: ATIP is the owner's alone… (upload part); S5 `want 401`/`200` |
| PORTAL-CR-04 | The ATIP page stays view-only: CSP with `connect-src 'none'`, the read-only stylesheet (also for a page with no `</head>`), the shell rendered server-side with no script | `hub.pg.test.js` :: ATIP is the owner's alone…; `menu.test.js` :: server-rendered, the header adds no script…; S5 `has` lines on `$V` |
| PORTAL-CR-05 | Every TaskList list, task and update belongs to one person: another account reads, edits, files into and deletes none of it; rows of the old shared tracker belong to no one until migrated | `tasklist.pg.test.js` :: tasks belong to their person… |
| PORTAL-CR-06 | Bad input and impossible ids are a 400 or 404, never a 500 | `tasklist.pg.test.js` :: a repeating task… (the bad-input loop); `server.test.js` :: a malformed JSON body… |
| PORTAL-CR-07 | Dates and times go to the browser as the exact text stored; due dates are IST calendar days; updates are stamped by the server | `db.pg.test.js` :: dates and timestamps come back as exactly the strings written; `tasklist.pg.test.js` :: quick add parses the line in IST…; `quickadd.test.js`; `kesari-ui.test.js` :: dates read "3 Nov 2026"… |
| PORTAL-CR-08 | The app creates its own tables: idempotent, safe for two processes at once, over `DATABASE_URL_UNPOOLED` when set | `db.pg.test.js` :: the schema is the PostgreSQL one…; the tables are set up over DATABASE_URL_UNPOOLED…; S7 *Tables created over the direct URL* |
| PORTAL-CR-09 | A connection the server drops (Neon suspending a compute) never ends the process, idle or mid-transaction | `db.pg.test.js` :: an idle connection the server drops is replaced…; a connection dropped in the middle of a transaction…; S7 |
| PORTAL-CR-10 | A Neon URL works as pasted: TLS on and verified without `DB_SSL`, channel binding honoured, a connect timeout long enough for a cold start | `db-config.test.js` (all 5); S7 |
| PORTAL-CR-11 | The proxy is mounted before the body parsers, so a POST into a proxied app keeps its body; so is LadWani's in-process API, which reads the raw body itself (its payment webhook checks a signature over it) | `server.test.js` :: the real server.js mounts the proxy before the body parsers; `proxy.test.js` :: a POST body reaches the app intact…; `ladwani.test.js` :: the API is mounted before the hub's body parsers…; S5 proxy `"body"` line; S5 LadWani `"received":true` line |
| PORTAL-CR-12 | `/ladwani/` keeps its prefix; only `/edu/` has it stripped, query string intact; `/education/*` redirects to `/edu/*` | `proxy.test.js` :: only the tab that cannot own its prefix has it stripped…; `hub.pg.test.js` :: the old shared sign-in's addresses…; S5 proxy lines |
| PORTAL-CR-13 | A proxy origin comes only from the environment, never from the request, and must be a bare http(s) origin (no open proxy); a tier default meets the same gate | `proxy.test.js` (the origin tests) |
| PORTAL-CR-14 | A down app gives a 502 page that still carries the shell, with its own project current | `proxy.test.js` :: an app that is down gives a 502…; a stripping tab's 502 page…; S5 Education lines |
| PORTAL-CR-15 | The hub states its tier (`X-Bkesari-Env`) and keeps non-production out of search; an unknown host is production; the style guide exists on dev and test only | `smoke-dev.sh` *Tier identity*; `menu.test.js` :: the tier comes from the hostname…; `hub.pg.test.js` :: error pages, the style guide and security headers |
| PORTAL-CR-16 | The shell: six projects in order (ATIP to the owner only, and only as a link out), the project's name in its accent, no script needed for what it shows, scoped styles, 48 px targets, a 3 px focus ring, the account menu of the current project only, every string in EN / MR / HI, on every page | `menu.test.js` (all 14) |
| PORTAL-CR-17 | Nothing private is served: `/.env`, `/.git/config`, the server source, stack traces | `smoke-dev.sh` *Nothing private is served*; `server.test.js` :: a malformed JSON body…; S6 malformed-body loop |
| PORTAL-CR-18 | The dev deploy refuses every target but dev (branch, path, host, smoke URL, empty secrets) | `.github/deploy/guard.test.sh` (32 cases) |
| PORTAL-CR-19 | Neon provisioning: one Singapore PostgreSQL 16 project per app with its tier branches… (unchanged) | `neon-provision.test.js` (all 11) |
| PORTAL-CR-20 | `database/portal/01_portal_schema.sql` and `02_hub_schema.sql` stay the schemas the app applies; each project's sign-in tables are in its own schema file under its own prefix | `schema-copy.test.js` (all 4); `hub.test.js` :: each project's sign-in tables are in its own schema file…; S3 #8 |
| PORTAL-CR-21 | LadWani served by the hub (`portal/ladwani.js`): no hub gate and no hub token; no path, however encoded, reaches a file outside the export; a build-asset miss is a bare 404; any id is answered by its `_` page; the hub names the visitor to LadWani's rate limits by address (`ip:<req.ip>`, trust-proxy aware) and drops any visitor header or token a client sent; the API off or failing to start is a 503 while the hub and the pages stay up; the engine's worker-thread cap is set before it loads; `lw_sid` is scoped to `/ladwani` | `ladwani.test.js` (all 16); S5 LadWani step; S6 LadWani loop |
| PORTAL-CR-22 | **Per-project sign-in.** Each project's session cookie is its own (`tl_sid` Path=/tasklist, `hub_admin_sid` Path=/), HttpOnly, SameSite=Lax, Secure except plain http to localhost; signing in or out of one never affects another; one project's session grants nothing in another | `tasklist.pg.test.js` :: mobile + OTP…; accounts are isolated…; `hub.pg.test.js` :: the hub admin has its own login…; `ladwani.test.js` :: LadWani's own session cookie…; S5 TaskList and admin lines |
| PORTAL-CR-23 | **Sign-in protections.** 5 wrong passwords lock for 15 minutes (even against the right password); unknown accounts answer like a wrong password; OTP codes are single use, 5 tries, rate-limited, hashed; a code is never shown on production and is refused there without a provider; resets are single use and end every session; session tokens are stored hashed | `tasklist.pg.test.js` (sign-in tests); `hub.pg.test.js` (admin lockout); `hub.test.js` (helpers) |
| PORTAL-CR-24 | **CSRF and cross-site.** Every state-changing request carries the session's (or, signed out, the double-submit) token; JSON only; a foreign `Origin` is refused; the contact form's token, signed time stamp, honeypot and rate limit hold | `tasklist.pg.test.js` :: cross-site and non-JSON requests are refused; `hub.pg.test.js` :: the contact form…; S6 cross-site line |
| PORTAL-CR-25 | **Kesari.** The committed build matches the source; ≤ 30 KB gzipped with the shell; every text pair AA in light and dark; system and pinned dark identical; fonts swap and include Devanagari; the hub and TaskList pages carry no inline script | `kesari-ui.test.js` (all 11); `menu.test.js` :: every hub page carries the shell…; S1 #5 |
| PORTAL-CR-26 | **The migration** (`tools/migrate_shared_id.mjs`): a dry run changes nothing; `--apply` creates TaskList accounts (no password invented, the owner as owner), gives the old tracker's rows to the owner, and is safe to re-run; `--notify` only with `--apply` | `migrate.pg.test.js` (all 3) |

### R3 — change-area map

| When this changes | Emphasise |
|---|---|
| `portal/server.js` | all of R1 (`server.test.js` first); S5; S6; CR-01 to CR-04, CR-11, CR-15, CR-17, CR-21, CR-22 |
| `portal/project-auth.js`, `portal/notify.js` | `tasklist.pg.test.js`, `hub.pg.test.js`, `hub.test.js`; S5 TaskList and admin lines; S6; CR-22 to CR-24 |
| `portal/tasklist.js`, `portal/public/tasklist/**` | `tasklist.pg.test.js`, `quickadd.test.js`, `server.test.js`, `sw.test.js`; S5; S6 path loop; CR-01, CR-05 to CR-07, CR-22 to CR-24 |
| `portal/hub.js`, `portal/hub-pages.js`, `portal/i18n/**` | `hub.pg.test.js`, `hub.test.js`; S5; CR-02, CR-12, CR-15, CR-24 |
| `packages/kesari-ui/**`, `portal/public/kesari-ui/**` | `kesari-ui.test.js` (run `npm run build:kesari` first); S1 #5; CR-25 |
| `tools/migrate_shared_id.mjs` | `migrate.pg.test.js`; CR-26 |
| `mobile/**` | `mobile.test.js` |
| `portal/db.js`, `portal/sql/**`, `database/portal/**`, `package.json`, `package-lock.json` | R1; S3 #8; S4; **S7**; CR-07 to CR-10, CR-20 |
| `portal/proxy.js` | `proxy.test.js`; S5 proxy step; CR-11 to CR-14 |
| `portal/ladwani.js` | `ladwani.test.js`; S5 LadWani step; S6 LadWani loop; CR-11, CR-21. A change to a setting it gives LadWani (`ENGINE_THREADS`, `LADWANI_*`) also: DEPLOY.md Part 7 and section 2.3 read against it |
| `ladwani/**` | #6a–#6c, #9a; S5 LadWani step; CR-21. A change to its settings (`apps/api/src/common/env.ts`, `next.config.js`) also: DEPLOY.md Part 7 read against it. A change to its fonts (`apps/web/src/app/fonts/`, `layout.tsx`, the `font-family` and `font-weight` rules in `globals.css`) also: `ladwani-fonts.test.js` |
| `portal/public/shared/menu.js`, `portal/public/**/*.html`, `page.css`, `hub.css` | `menu.test.js`; `kesari-ui.test.js`; S1 #5; S5; CR-04, CR-14 to CR-16, CR-25 |
| `scripts/smoke-dev.sh` | S5 (it is the smoke); CR-15, CR-17 |
| `scripts/neon-parity.sh` | S7 |
| `.github/workflows/**`, `.github/deploy/**` | S1 #4; `guard.test.sh`; CR-18; read the diff against DEPLOY.md Part 6 |
| `tools/neon_provision.mjs` | `neon-provision.test.js`; S1 #2; CR-19 |
| `tools/*.sh` | S1 #3 (they are not run: see Known gaps) |
| `database/ladwani/**`, `database/local/**` | S3 #8 |
| `tests/**` | R1, and R4: a count that went down needs a reason |

### R4 — baseline comparison

Compare with section 5. The number of tests, and of passes, must not go down; a test that
skipped nowhere before and skips now is a failure; a new warning in `smoke-dev.sh` needs a
reason in the report. A count that goes down because a test was deliberately removed or merged
needs the commit and the reason in the report.

## 5. Baseline

Measured **2026-10-24** on commit `9358d74` plus the working tree that introduced this spec
(branch `claude/fervent-bell-wcmmdu`), in a Linux container: Node 22.22.0, PostgreSQL 16.15
(direct, `:5432`), PgBouncer 1.22.0 (`:6432`, transaction mode, TLS required), role `t_portal`
(not a superuser, member of `neon_superuser`) owning the suite database `t_portal` and the smoke
database `t_portal_app`. "First run" is before the fix loop (the defects are in the run's report); "final"
is after it.

| # | Level | First run | Final run | Final duration |
|---|---|---|---|---|
| 1–5 | S1 | all pass (6 scripts, 3 workflows, 4 inline scripts) | all pass | 0.9 s together |
| 6 | S2 `npm test`, no database | 61 pass, 0 fail; 2 suites (14 tests) skipped; guard 32/32 | **65 pass, 0 fail; 2 suites (15 tests) skipped; guard 32/32** | 3.1 s |
| 7 | S3 / R1 `npm run test:pg` | 75 pass, 0 fail, 0 skip; guard 32/32 | **80 pass, 0 fail, 0 skip; guard 32/32** | 4.5 s |
| 8 | S3 hand-run SQL | pass | pass | 1.0 s |
| 9 | S4 deploy bundle | `bundle boots: 200` | `bundle boots: 200` | 2.1 s |
| 10 | S5 smoke | smoke-dev.sh 22 passed, 0 failed, 3 warnings; probes 22 ok, 2 FAIL | **smoke-dev.sh 22 / 0 / 3; probes 24 ok** | 5.1 s with #11 |
| 11 | S6 security | 6 ok, 10 FAIL | **16 ok** | (with #10) |
| 12 | S6 audit | 1 high (body-parser < 1.20.9) | **0 vulnerabilities** | 0.7 s |
| 13 | S7 Neon parity | 17 passed, 0 failed | **17 passed, 0 failed** | 10.8 s |

The final counts were the baseline, then:

- raised by two `neon-provision` tests (on `4b5eec9` plus the `neondb` / `bk_*` naming change:
  S2 67 pass, R1 82, `neon-provision` 12);
- lowered by one (on `40a2003` plus the one-Neon-project-per-app rewrite of
  `tools/neon_provision.mjs`, 2026-10-24): the tool no longer writes the per-tier isolation SQL,
  so its tests were rewritten from 12 to 11. Current: S2 **66** pass, R1 **81**.

R1 by file: `menu` 19, `proxy` 26, `server` 3, `db-config` 5, `tracker.pg` 15 (8 tracker + 7
db.js), `schema-copy` 2, `neon-provision` 11 = **81**, plus **32** guard cases.

Hub v1 (branch `claude/hub-v1`, measured 2026-10-25 on `10e99d5` plus the portal-tester fixes):
S2 **89** pass with **three** suites skipped (`hub.pg` joined the two PostgreSQL suites); R1 **116**:
`menu` 19, `proxy` 27, `server` 6, `db-config` 5, `tracker.pg` 15, `hub.pg` 12, `hub` 5, `neon` 11,
`schema-copy` 4, `neon-provision` 12, plus **32** guard cases. S5: smoke-dev.sh 23 / 0 / **2**
warnings (Milk & Dairy is gone), 31 probes ok; S6 16 ok; S7 17 passed.

Installable PWA (branch `claude/hub-v1-fixes`, measured 2026-10-25 on `1d31a4a` plus the portal-tester
fixes): S2 **93** pass, three suites skipped; R1 **120**: `menu` 19, `proxy` 27, `server` 7 (+1, the PWA
test), `sw` 4 (new: what the service worker may store), `db-config` 5, `tracker.pg` 15, `hub.pg` 12,
`hub` 5, `neon` 11, `schema-copy` 4, `neon-provision` **11** (12 to 11 by the one-project-per-app rewrite
`159b505`, merged in `cb04992`; see above), plus **32** guard cases. S5: smoke-dev.sh 23 / 0 / 2, 32 probes
ok (`/ATIP` without the slash is now gated like `/ATIP/`, `9e63a60`: 401 anonymous, 302 signed in); S6 16
ok; S7 17 passed.

Tier default origins (branch `claude/bkesari-hostinger-hub-deploy-vwn6yr`, measured 2026-10-25 on
`8ab95cf` plus the working tree: `TIER_ORIGINS` in `portal/proxy.js`, and the portal-tester fixes): S2
**98** pass, three suites skipped; R1 **125**: `proxy` **32** (+3 from the change, +2 from portal-tester:
tier agreement with the hub, the gate on a tier default), every other file as above, plus **32** guard
cases. S5: smoke-dev.sh **25 / 0 / 1** (S5's first hub runs `APP_ENV=dev` with no origins, which now means
gated routes to the dev sites: both tabs pass as "deployed" at the sign-in page, the two "not deployed"
warnings and the tier-badge bonus check go, and `/edu/ Livewire checks skipped` is the one warning), 32
probes ok; S6 16 ok; S7 17 passed. `smoke-dev.sh` counts a 404 from `/atip/` as the viewer hidden (owner
only, under Neon Auth): `https://bkesari.com --env prod` went from 22 / 0 / 3 to 23 / 0 / 2.

LadWani in the hub (same branch, measured 2026-10-25 on `b17fee0` plus the portal-tester fixes:
`ladwani/` imported, `portal/ladwani.js` serving it, LadWani's tier origins gone from `TIER_ORIGINS`).
S2 **111** pass, three suites skipped; R1 **138**: `ladwani` **13** (new: 12 from `b17fee0`, +1 from
portal-tester, the API's place before the body parsers), every other file as above, plus **32** guard
cases. New rows: #6a LadWani Jest **222** pass in **28** suites; #6b clean; #6c 0 errors, **2** warnings
(both `react-hooks/exhaustive-deps`, `assets/[id]/view.tsx` and `assets/page.tsx`, imported with the
code); #9a 41 static pages, the ten `[param]` pages each once as `_`. S5: smoke-dev.sh **25 / 0 / 1**
(unchanged count, but `/ladwani/` now answers with the sign-in from the hub's own gate rather than a
tier-default route to devladwani.bkesari.com), **42** probes ok (32 + the 10 of the new LadWani step;
the LadWani proxy lines stay, run through `signed-in-hub.js`'s proxy mode); S6 **31** ok (16 + the 15 of
the LadWani loop); #12 root 0 vulnerabilities, LadWani 11 (4 moderate, 5 high, 2 critical; report only);
S7 17 passed. Measured with the LadWani smoke database on the same local cluster as the other two, and
the S7 bed's direct endpoint on `:5433` (a PostgreSQL already held `:5432`).
Then per-person rate limits (`115b07b`: `VisitorThrottlerGuard`, `X-Bkesari-Visitor` set by the hub):
S2 **113**; R1 **140** (`ladwani` **15**: +1 the API is told who the visitor is, +1 from portal-tester, a
browser's visitor header never reaches the API even when the gate names no one); #6a **225** in **29**
suites (+3, the guard's spec); #6b, #6c, #9a, S5 (42) and S6 (31) unchanged.
Then the engine's thread cap (`49a10fb`, measured 2026-10-26 plus the portal-tester fix: `ENGINE_THREADS`,
the `ready (database engine: …)` startup line): S2 **115**; R1 **142** (`ladwani` **17**: +1 the cap is in
place before the engine loads, +1 from portal-tester, a value the engine cannot use stops only the API);
S5 **43** probes ok (+1, the startup line); #6a–#6c, #9a, S6 (31) unchanged.
Then LadWani's fonts shipped with the app (`71dd769`, `next/font/local`, measured 2026-10-26 plus the
portal-tester fix: the latin-ext faces, where ₹ is, and IBM Plex Mono 600): S2 **118**; R1 **145**
(`ladwani-fonts` **3**, new: what the bundled font files draw, read from the files themselves); #9a builds
with no network at all; #6a–#6c, S5 (43), S6 (31) and S7 unchanged.

**Kesari redesign, per-project sign-in** (branch `claude/confident-goldberg-i9xe8m`, measured
3 Nov 2026 in a Linux container: Node 22.23.4, PostgreSQL 16 on `:5433`, role `bk` not a superuser).
The shared bkesari ID, the Task Tracker and their tests are gone (`tracker.pg` 15, `hub.pg` 12,
`hub` 5, the Neon Auth half of `neon`; `signed-in-hub.js`); in their place R1 **159**:
`menu` **14** (rewritten for the shell), `proxy` 32, `server` **6**, `sw` 4, `db-config` 5,
`db.pg` **8** (new: the schema test and db.js's 7 from the old `tracker.pg`), `hub.pg` **7**
(rewritten), `hub` **9** (rewritten), `tasklist.pg` **12** (new), `migrate.pg` **3** (new),
`kesari-ui` **11** (new), `quickadd` **7** (new), `mobile` **1** (new), `neon` **4**, `ladwani` **16**,
`ladwani-fonts` 5, `schema-copy` 4, `neon-provision` 11, plus **32** guard cases. S2 skips **five**
PostgreSQL suites. #6a LadWani Jest **252** in **31** suites (its own auth: +27). S5 and S6 were
rewritten for the new routes; their probe counts are the new baseline once first run (R4 compares
from then).

Expected, and only these: in S2 the five PostgreSQL suites skip, because S2 runs without
`TEST_DATABASE_URL` on purpose (node lists them as `# SKIP` lines under `# suites`, not
`# skipped`); #6c (and #9a's build) print LadWani's two lint warnings named
above. Anything else skipping or warning is a regression (R4). (`smoke-dev.sh`'s old warning,
`/edu/ Livewire checks skipped`, came from the hub's own sign-in page in front of `/edu/`; with that
gone it cannot appear.)
(A hub with no `APP_ENV` and no origins gives 31 / 0 / 1 with #9a's export built, the warning being
`/edu/` not deployed; without the export `/ladwani/` is a second.)

First run on this branch (portal-tester, 3 Nov 2026, with its fixes; `/edu/` sent to a local
Education stand-in, as no real tier was to be contacted): S5 **39** probes ok, smoke-dev.sh 33 / 0 / 0;
S6 **27** ok; S7 **18** passed (the 17 plus TaskList's own sign-in through the pooler); R1 **161**
(`tasklist.pg` **14**: +2, OTP codes and passwords sent together stay within 5 tries).

For reference, the suite as merged (before this spec, the same commit, clean tree): 80 tests,
63 pass, 9 fail, 8 skip, all from the MySQL/SQLite `tests/db-dialects.test.js` that the move to
PostgreSQL left behind; its assertions now live in `tracker.pg.test.js`.

## 6. Pass criteria

- **PASS**: every row of section 3 ran and passed, R1 has no failure and no skip, every R2 row's
  check passed, the counts are at or above section 5, and nothing above S4 is left open.
- **FAIL**: a defect above S4 is still open after the fix loop (three rounds at most).
- **BLOCKED**: something in section 3 could not run: no PostgreSQL, no `.env.test`,
  `SMOKE_DATABASE_URL` or `LADWANI_SMOKE_DATABASE_URL`, a missing tool, or no Neon-like bed for S7. A level that did not run is
  never reported as passed; name what would unblock it. Also BLOCKED: any database setting that
  names Neon (`*.neon.tech`), a server, or a `_dev`/`_test`/`_prod` database other than the
  scratch databases of section 2.2.

## 7. Defect handling

| Severity | Meaning here | Example from this project |
|---|---|---|
| S1 | data lost or exposed, a login or token bypassed for data, a deploy that could reach test or production, or the hub does not start or dies | a connection dropped inside a transaction ended the process (found and fixed 2026-10-24) |
| S2 | a feature broken, or a protection that does not hold although no data is exposed | the Task Tracker page served without its login at `/%74asks/` (found and fixed 2026-10-24) |
| S3 | degraded, with a workaround | a malformed JSON body answered with a stack trace naming the server's paths (found and fixed 2026-10-24) |
| S4 | cosmetic | the 502 page for `/edu/` highlighting no tab (found and fixed 2026-10-24) |

The agent may fix on its own: anything inside this spec's scope (section 1) whose root cause is
clear, with the smallest change that removes it and a test that fails without it. It must
report instead of fixing: anything in `edu/` or `database/edu/`, another repository, a change to
the documented behaviour (a route's contract, a login rule, the menu's tabs), a fix that needs a
new dependency, and anything needing Neon, Hostinger or a secret.

Never: skip, delete or loosen a test, or change an expected value to match wrong output; point
anything at Neon, a server or a database other than section 2.2's; print a password or a
connection string with its password; turn certificate checks off to get past TLS; commit, push,
deploy, or touch `.claude/settings.json`, `.claude/hooks/`, `.claude/test-gate.json`, `.env`
files or `.claude/state/`.

## 8. Report format

Written to `.claude/test-runs/<UTC yyyymmdd-hhmmss>-portal-tester.md` and copied to
`.claude/test-runs/latest-portal-tester.md`:

```markdown
# portal-tester report — <UTC date and time>

- Commit: <short sha> on <branch>; working tree: <clean | N files changed>
- Changed files under test: <list, each mapped to its R3 row>
- Environment: Node <v>, PostgreSQL <v> (direct :5432), PgBouncer <v> (:6432, transaction, TLS) | none,
  suite database <name>, smoke database <name>, role <name> (superuser: no)

## Results

| # | Level | Command | Result | Counts (tests/pass/fail/skip) | Duration | vs baseline |
|---|---|---|---|---|---|---|
| 1 | S1 | npm run check | PASS | – | 0.4 s | = |
| ... one row per row of section 3, plus R1 ... |

## Critical regressions

| ID | Result | Evidence |
|---|---|---|
| PORTAL-CR-01 | PASS | <test name or probe line> |
| ... all 26 ... |

## Defects

| ID | Severity | Area | Symptom | Root cause | Fix | Files | Test added | Status |
|---|---|---|---|---|---|---|---|---|

## Re-test

<what was re-run after the fixes, and the complete final run's counts>

## Open items

<anything not fixed, with a proposed patch or what would unblock it>

TESTER: portal-tester
VERDICT: PASS | FAIL | BLOCKED
```

## 9. Known gaps

- **Neon is never contacted.** S7 proves the app's side against a Neon-like bed: PgBouncer in
  transaction mode, TLS, SCRAM, a non-superuser owner, dropped connections. It cannot prove
  Neon's own proxy (SNI routing, its error messages), a real compute waking from suspend (only
  the connect timeout is checked), or Neon's console and API (`tools/neon_provision.mjs` is
  tested against a fake).
- **Channel binding through a pooler is not exercised.** PgBouncer 1.22 offers only
  SCRAM-SHA-256, so through it pg falls back; the direct bed connection does use
  SCRAM-SHA-256-PLUS. Neon's pooler offers it.
- **node-postgres 8 prints a one-off "SECURITY WARNING" for `sslmode=require`** and treats it as
  `verify-full` (certificate checked). pg 9 is due to give `require` libpq's weaker meaning; the
  `^8` range in `package.json` keeps that from arriving unannounced. Revisit TLS on that upgrade.
- **Unauthenticated bodies are parsed before the sign-in check.** TaskList's and the admin's
  routers parse JSON (200 KB / 100 KB) before deciding the request is signed out, and the
  snapshot upload 15 MB before its token. Not exploitable for data; a hardening item.
- **No browser test in this suite.** The shell at phone width, dark mode and TaskList's screens are
  checked by the redesign's Playwright + axe runs (`docs/testing-report-2026-11-03.md`) and
  TESTING.md section 4, by hand; none of that is in `npm test`.
- **No SMS or mail provider anywhere.** The provider adapters (`portal/notify.js`) are tested only
  through stand-ins; a real gateway is checked on the tier.
- **No load or concurrency testing** beyond two processes creating the tables at once.
- **Not run:** `tools/setup_local_postgres.sh` (it creates roles and databases for every project
  and edits sibling repositories' `.env` files), `database/local/00_local_create_databases.sql`
  (superuser, every project's roles), `tools/check_local_git.sh` (needs the Mac's clones). Only
  their syntax is checked.
- **The dev deploy job** (rsync, `npm ci` on the server, Passenger restart) needs the SSH
  secrets and a server; only its guard and YAML are tested.
- **The proxied apps** are stand-ins: a real Next.js `basePath` or Laravel `APP_URL` is checked
  by `smoke-dev.sh` against a deployed tier and by TESTING.md section 4.
- **LadWani on a real tier.** Inside the hub, LadWani's rate limits count per signed-in person
  (`X-Bkesari-Visitor`), whatever proxies stand in front. Without `LADWANI_TRUST_PROXY` its audit log
  records the front end's address for everyone, and without `NODE_ENV=production` its sign-up answer
  carries the one-time code and its cookie is not `Secure` (DEPLOY.md Part 7). No suite here sees
  the tier's settings; the checks in DEPLOY.md, on the tier, do. Two people's separate budgets are
  proven only by `ladwani.test.js` (the header) and the guard's spec (the count); S5 signs in one person.
- **LadWani's engine threads are not counted by any suite.** `ladwani.test.js` proves the cap is set
  before the API loads (a stand-in API), and S5's startup line that the real API started with it. That the
  engine obeys it was measured by hand on Linux (`taskset`, `/proc/<pid>/task/*/comm`): the engine's
  `tokio-runtime-w` threads are the cap plus one (CPUs plus one uncapped). Not capped: tokio's blocking
  threads, one per connection opening at once to a host name (a DNS lookup; Neon's URL is one), which
  Prisma's pool bounds: LadWani sets `connection_limit=5` (`CONNECTION_DEFAULTS` in
  `ladwani/apps/api/src/prisma/prisma.service.ts`; Prisma's own default is physical cores × 2 + 1,
  whatever the affinity or the cap). Its spec checks the parameter; no suite counts the threads.
- **LadWani's own depth.** Its integration tests (`npm run test:integration` in `ladwani/apps/api`,
  a database of their own) and its screens in a browser are not part of this suite.
- **Draft PR sanjaymorankar-debug/bkesari-platform#10** (Neon services) is not on this branch.
  If it lands, update sections 2 and 5. Its `neon.ts`, `hello.ts`, `@neon/config` and
  `@neon/env` set up Neon services nobody asked for and are not wanted; its two good ideas
  (impossible ids are a 404, schema over `DATABASE_URL_UNPOOLED`) are already here.
