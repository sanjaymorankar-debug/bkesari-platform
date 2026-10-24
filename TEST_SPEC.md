# bkesari hub (portal) — test specification

The hub is the Node.js (Express) app behind **bkesari.com**, `test.bkesari.com` and
`dev.bkesari.com`: the welcome page, the shared menu every project includes
(`portal/public/shared/menu.js`), the static Global Warming and Driving Simulator pages, the
**Task Tracker** at `/tasks/`, the read-only **ATIP viewer** at `/ATIP/` (and `/atip/`), and the
proxy that serves `/milk/`, `/edu/` and `/ladwani/` from their own apps (`portal/proxy.js`). Its
data is in **PostgreSQL on Neon** (database `neondb`, role `bk_portal_app`, one Neon branch per
tier; [docs/NEON.md](docs/NEON.md)). This spec covers the hub and everything else in this
repository outside `edu/` and `database/edu/`: the tests, the smoke and parity scripts, the CI
and deploy workflows and their guard, the hand-run SQL under `database/`, and `tools/`. What a
deployed tier needs on top (hPanel, SSH, a browser) is [TESTING.md](TESTING.md); this file does
not repeat it.

Testing agent: `.claude/agents/portal-tester.md`. It runs automatically after every code change
(the test gate, `.claude/hooks/test_gate.py`); run it by hand by asking Claude to "run the
portal-tester agent".

## 1. Scope

| Component | Path | Language / framework |
|---|---|---|
| Hub server, routes, logins | `portal/server.js` | Node 22, Express 4 |
| Database layer and schema | `portal/db.js`, `portal/sql/schema.sql`, `database/portal/01_portal_schema.sql` | node-postgres 8, PostgreSQL 16 |
| Proxy to the project tabs | `portal/proxy.js` | http-proxy-middleware 4 |
| Shared menu, static pages, Task Tracker UI | `portal/public/**` | browser JS, HTML, CSS |
| Smoke and Neon-parity scripts | `scripts/smoke-dev.sh`, `scripts/neon-parity.sh` | bash, curl, psql |
| CI, dev deploy, deploy guard | `.github/workflows/*.yml`, `.github/deploy/guard.sh` | GitHub Actions, bash |
| Neon provisioning, local setup, Git checker | `tools/neon_provision.mjs`, `tools/setup_local_postgres.sh`, `tools/check_local_git.sh` | Node ESM, bash |
| Hand-run SQL | `database/portal/`, `database/ladwani/`, `database/local/` | PostgreSQL |
| Tests | `tests/*.test.js`, `.github/deploy/guard.test.sh` | `node:test`, bash |

Out of scope, and why:

- `edu/` and `database/edu/` — the `edu-tester` agent and `edu/TEST_SPEC.md`. Do not build,
  install or run anything there. (`deploy-dev-edu.yml` and the `edu` job in `ci.yml` are theirs
  too; this spec only parses their YAML.)
- The apps behind `/milk/`, `/edu/` and `/ladwani/` — their own repositories. Only the hub's
  forwarding is tested here, against a throwaway upstream.
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

Two throwaway PostgreSQL databases, both **owned by one non-superuser login role**. Nothing
else may use them:

| Name in this spec | Used by | What happens to it | Mac | This repo's CI |
|---|---|---|---|---|
| suite database (`TEST_DATABASE_URL`) | S3 / R1 | **the tests DROP and recreate the four tracker tables** | `bk_portal_test` | `bk_portal_test` in the service container |
| smoke database (`SMOKE_DATABASE_URL`) | S4, S5, S7 | **S7 drops the tracker tables**; S5 writes rows | `bk_portal_smoke` | not used (CI's smoke runs on the suite database) |

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
```

Any other machine: create a login role that is not a superuser, two databases it owns, and set
`TEST_DATABASE_URL` (in `.env.test`) and `SMOKE_DATABASE_URL` to them.

### 2.3 Environment variables

| Variable | Read by | Safe local value |
|---|---|---|
| `TEST_DATABASE_URL` | `tests/tracker.pg.test.js` | the suite database. Unset: its two suites (15 tests) skip, which is a failure at S3 |
| `SMOKE_DATABASE_URL` | this spec's S4/S5 commands | the smoke database |
| `DATABASE_URL` | the app | S4/S5: `$SMOKE_DATABASE_URL`. On Neon the pooled string |
| `DATABASE_URL_UNPOOLED` | the app, schema setup only | blank is fine (S5 leaves it unset; S7 sets it) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`, `DB_POOL_MAX` | the app, when there is no `DATABASE_URL` | blank is fine; **unset them** in the shell that starts the hub, so a stray value cannot win |
| `PORT` | the app | `3101` |
| `APP_ENV` | the app (tier) | `dev` |
| `TRACKER_USER`, `TRACKER_PASSWORD` | `/tasks/` login (unset = open: fails open on purpose) | `smoke` / `smoke-local-only` |
| `ATIP_USER`, `ATIP_PASSWORD` | `/ATIP/` login (unset = 503: fails closed) | `smoke` / `smoke-local-only` |
| `ATIP_PUBLISH_TOKEN` | snapshot upload | `smoke-local-token` |
| `MILK_ORIGIN`, `EDU_ORIGIN`, `LADWANI_ORIGIN` | the proxy | blank, except in S5's proxy step (`http://127.0.0.1:3111`) |
| `PARITY_POOLED_URL`, `PARITY_DIRECT_URL`, `PARITY_PORT`, `PARITY_IDLE_SECONDS` | `scripts/neon-parity.sh` | section 2.6 |
| `NODE_EXTRA_CA_CERTS` | Node, S7 only | the local CA that signed the bed's certificate. Never turn verification off instead |

### 2.4 Ports

`3101` the hub (S4, S5, S7). `3111` the throwaway upstream in S5's proxy step. Nothing else.
Stop every process you start; check with `lsof -nP -iTCP:3101 -iTCP:3111 -sTCP:LISTEN` (or
`ss -ltn`) at the end.

### 2.5 One-time setup per run

```bash
npm ci                         # root only; never inside edu/
test -f .env.test || echo "create .env.test (2.2) first"
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
R1, never alongside it.

## 3. Standard suite

Run in order, from the repository root, with `.env.test` and `SMOKE_DATABASE_URL` set (2.2).
Record each command's exit code, counts and duration.

| # | Level | Command | Passes when |
|---|---|---|---|
| 1 | S1 static | `npm run check` | exit 0 |
| 2 | S1 static | `node --check tools/neon_provision.mjs && node tools/neon_provision.mjs --help >/dev/null` | exit 0 |
| 3 | S1 static | `for f in scripts/*.sh .github/deploy/*.sh tools/*.sh; do bash -n "$f" \|\| echo "FAIL $f"; done` | prints nothing |
| 4 | S1 static | `python3 -c "import sys,yaml; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml` | exit 0 |
| 5 | S1 static | the inline-script parse below | `inline scripts parsed: 4`, exit 0 |
| 6 | S2 unit | `set -o pipefail; env -u TEST_DATABASE_URL npm test 2>&1 \| tee /tmp/portal-s2.txt` | exit 0; exactly two `# SKIP` lines, the two PostgreSQL suites (node counts them under `# suites`, not `# skipped`); guard `32 passed, 0 failed` |
| 7 | S3 integration | `set -o pipefail; npm run test:pg 2>&1 \| tee /tmp/portal-r1.txt && grep -c '# SKIP' /tmp/portal-r1.txt` | the tests exit 0, `grep` prints **0** (it then exits 1, which is the good case), guard 32/32 |
| 8 | S3 integration | the hand-run SQL load below | exit 0 |
| 9 | S4 build | the deploy-bundle boot below | `bundle boots: 200` |
| 10 | S5 smoke | the smoke run below | smoke-dev.sh `0 failed` (the 3 tab warnings are expected); every probe `ok`; `S5 failures: 0` |
| 11 | S6 security | the security checks below | `S6 failures: 0` |
| 12 | S6 hygiene | `npm audit --omit=dev` | report only: list advisories in the report; fix only if trivial |
| 13 | S7 Neon parity | `bash scripts/neon-parity.sh` (2.6) | `Neon parity passed.`, exit 0 |

**#5, inline scripts** (the Task Tracker UI is about 350 lines of inline JS nothing else
parses):

```bash
node -e '
const fs=require("fs"),vm=require("vm");let n=0;
for (const f of process.argv.slice(1)) { const html=fs.readFileSync(f,"utf8");
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) { new vm.Script(m[1],{filename:f}); n++; } }
console.log("inline scripts parsed:", n);' portal/public/index.html portal/public/tasks/index.html \
  portal/public/global-warming/index.html portal/public/driving-simulator/index.html
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

**#10, the smoke run.** The hub from the working tree, on the smoke database, on 3101, with
throwaway logins, then `scripts/smoke-dev.sh` (what CI and the dev deploy run), then the probes
it cannot make without credentials, then the proxy with a throwaway upstream:

```bash
export BASE=http://127.0.0.1:3101 U=smoke PW=smoke-local-only TOKEN=smoke-local-token
HUBLOG=$(mktemp); F=0
start_hub() {  # extra VAR=value pairs are passed to the hub
  if curl -s -o /dev/null --max-time 2 "$BASE/"; then echo "FAIL something is already on 3101"; F=$((F+1)); return 1; fi
  env -u DB_HOST -u DB_PORT -u DB_NAME -u DB_USER -u DB_PASSWORD -u DB_SSL -u DATABASE_URL_UNPOOLED \
    DATABASE_URL="$SMOKE_DATABASE_URL" PORT=3101 APP_ENV=dev \
    TRACKER_USER=$U TRACKER_PASSWORD=$PW ATIP_USER=$U ATIP_PASSWORD=$PW ATIP_PUBLISH_TOKEN=$TOKEN \
    "$@" node portal/server.js >"$HUBLOG" 2>&1 & HUB=$!
  for i in $(seq 1 40); do curl -fsS -o /dev/null "$BASE/" 2>/dev/null && return; sleep 0.5; done; echo "FAIL hub did not start"; F=$((F+1))
}
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
want() { local exp=$1; shift; local got; got=$(code "$@")
  if [ "$got" = "$exp" ]; then echo "ok    $exp  $*"; else echo "FAIL  want $exp got $got  $*"; F=$((F+1)); fi; }
has() { if printf '%s' "$1" | grep -qF -- "$2"; then echo "ok    has '$2'"; else echo "FAIL  missing '$2'"; F=$((F+1)); fi; }
J='content-type: application/json'

start_hub
bash scripts/smoke-dev.sh "$BASE" --env dev || F=$((F+1))
has "$(curl -sI "$BASE/" | tr -d '\r')" 'X-Bkesari-Env: dev'
want 200 -u $U:$PW "$BASE/tasks/";   want 401 -u $U:wrong "$BASE/tasks/";   want 401 "$BASE/tasks/api/overview"
want 302 "$BASE/tasks";  want 302 "$BASE/ATIP";  want 401 "$BASE/ATIP/";  want 200 -u $U:$PW "$BASE/ATIP/"
P=$(curl -s -u $U:$PW -H "$J" -d '{"name":"S5 smoke","planned_start":"2026-10-01"}' "$BASE/tasks/api/projects")
PID=$(printf '%s' "$P" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
want 201 -u $U:$PW -H "$J" -d "{\"title\":\"S5 task\",\"project_id\":$PID}" "$BASE/tasks/api/tasks"
want 201 -u $U:$PW -H "$J" -d '{"body":"S5 update"}' "$BASE/tasks/api/projects/$PID/comments"
has "$(curl -s -u $U:$PW "$BASE/tasks/api/overview")" '"latest_comment":"S5 update"'
want 404 -u $U:$PW "$BASE/tasks/api/projects/abc"
want 401 -H 'authorization: Bearer wrong' -H "$J" -d '{"html":"<html><body>x</body></html>"}' "$BASE/ATIP/api/snapshot"
want 200 -H "authorization: Bearer $TOKEN" -H "$J" -d '{"html":"<html><body><p>S5 snapshot</p></body></html>","trade_date":"2026-10-24"}' "$BASE/ATIP/api/snapshot"
V=$(curl -s -D - -u $U:$PW "$BASE/ATIP/" | tr -d '\r')
has "$V" "connect-src 'none'";  has "$V" 'S5 snapshot';  has "$V" 'class="bk-menu"';  has "$V" 'id="bk-readonly"'
kill $HUB; wait $HUB 2>/dev/null

# The proxy, with the real server.js: a throwaway upstream on 3111 that echoes what it got.
node -e 'require("http").createServer((q,r)=>{let b="";q.on("data",c=>b+=c).on("end",()=>{r.setHeader("content-type","application/json");r.end(JSON.stringify({url:q.url,body:b}))})}).listen(3111,"127.0.0.1")' & UP=$!
sleep 0.5
start_hub MILK_ORIGIN=http://127.0.0.1:3111 EDU_ORIGIN=http://127.0.0.1:3111
has "$(curl -s "$BASE/milk/orders?x=1")" '"url":"/milk/orders?x=1"'
has "$(curl -s "$BASE/edu/login")" '"url":"/login"'
has "$(curl -s -H "$J" -d '{"qty":3}' "$BASE/milk/api/orders")" '"body":"{\"qty\":3}"'
kill $UP; wait $UP 2>/dev/null; sleep 0.5
want 502 "$BASE/milk/"
E=$(curl -s "$BASE/edu/login"); has "$E" 'not responding'; has "$E" '<a href="/edu/" aria-current="page">Education</a>'
kill $HUB; wait $HUB 2>/dev/null
echo "S5 failures: $F"
```

**#11, security checks.** In the same shell as #10 (it reuses `start_hub`, `want` and `J`):

```bash
F=0; start_hub
# No tracked secrets.
git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.example$' && { echo "FAIL tracked .env"; F=$((F+1)); }
git log --all --name-only --format= | grep -E '(^|/)\.env$' && { echo "FAIL .env in history"; F=$((F+1)); }
# The Task Tracker's page and API need the login however the path is spelled.
for p in /tasks/ /tasks/index.html /tasks/api/overview '/%74asks/' '/tasks%2findex.html' '//tasks/' \
         '/./tasks/' '/shared/../tasks/' '/shared/%2e%2e/tasks/index.html' '/%54ASKS/'; do
  want 401 --path-as-is "$BASE$p"; done
# A malformed body is a 400 that names no file, line or stack frame.
for p in / /tasks/api/projects /ATIP/api/snapshot; do
  b=$(curl -s -o - -w '\n%{http_code}' -H "$J" -d '{bad' "$BASE$p")
  case "$b" in *node_modules*|*'    at '*|*'&nbsp;at '*) echo "FAIL stack trace from $p"; F=$((F+1));; *) echo "ok    no stack trace from $p";; esac
  [ "${b##*$'\n'}" = 400 ] && echo "ok    400 from $p" || { echo "FAIL want 400 from $p, got ${b##*$'\n'}"; F=$((F+1)); }
done
# No certificate checks switched off, and no local CA baked into the app (Neon uses a public CA).
grep -rnE "rejectUnauthorized: *false|NODE_TLS_REJECT_UNAUTHORIZED|/etc/neonlike|sslmode=no-verify" portal/ \
  | grep -vF "if (v === 'no-verify') return { rejectUnauthorized: false };" && { echo "FAIL TLS weakened"; F=$((F+1)); }
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
| PORTAL-CR-01 | `/tasks/` (page and API) needs the login when `TRACKER_*` are set, however the path is spelled; a wrong password is a 401 | `server.test.js` :: the Task Tracker page needs its login however the path is spelled; S6 path loop; S5 `want 401`/`200` lines; `ci.yml` smoke step |
| PORTAL-CR-02 | `/ATIP/` fails closed: 503 with no `ATIP_*`, 401 without the login | `smoke-dev.sh` *Access control*; `tracker.pg.test.js` :: an ATIP snapshot upload replaces the previous one and is served behind the login |
| PORTAL-CR-03 | The snapshot upload needs the bearer token, and keeps only the newest snapshot | `tracker.pg.test.js` :: an ATIP snapshot upload replaces the previous one…; S5 `want 401`/`200` |
| PORTAL-CR-04 | The ATIP page stays view-only: CSP with `connect-src 'none'`, the read-only stylesheet (also for a page with no `</head>`), the menu rendered server-side | `tracker.pg.test.js` :: a snapshot with no </head> still has its order controls hidden; S5 `has` lines on `$V`; `menu.test.js` :: renderHtml needs no scripts to work |
| PORTAL-CR-05 | Deleting a project keeps its tasks as independent tasks, and removes its comments | `tracker.pg.test.js` :: deleting a project keeps its tasks as independent tasks |
| PORTAL-CR-06 | Bad input and impossible ids are a 400 or 404, never a 500 | `tracker.pg.test.js` :: bad input is a 400 or a 404, never a 500 |
| PORTAL-CR-07 | Dates and times go to the browser as the exact text stored; comments are stamped by the server, newest first | `tracker.pg.test.js` :: dates and timestamps come back as exactly the strings written; status updates are stamped by the server… |
| PORTAL-CR-08 | The app creates its own tables: idempotent, safe for two processes at once, over `DATABASE_URL_UNPOOLED` when set | `tracker.pg.test.js` :: the schema is the PostgreSQL one…; the tables are set up over DATABASE_URL_UNPOOLED…; S7 *Tables created over the direct URL* |
| PORTAL-CR-09 | A connection the server drops (Neon suspending a compute) never ends the process, idle or mid-transaction | `tracker.pg.test.js` :: an idle connection the server drops is replaced…; a connection dropped in the middle of a transaction…; S7 *Connections dropped while idle* |
| PORTAL-CR-10 | A Neon URL works as pasted: TLS on and verified without `DB_SSL` (the URL's `sslmode` wins over db.js's `ssl: undefined`), channel binding honoured, a connect timeout long enough for a cold start | `db-config.test.js` (all 5); S7 |
| PORTAL-CR-11 | The proxy is mounted before the body parsers, so a POST into a proxied app keeps its body | `server.test.js` :: the real server.js mounts the proxy before the body parsers; `proxy.test.js` :: a POST body reaches the app intact; mounting the parsers first makes a POST hang…; S5 proxy `"body"` line |
| PORTAL-CR-12 | `/milk/` and `/ladwani/` keep their prefix; only `/edu/` has it stripped, query string intact | `proxy.test.js` :: only the tab that cannot own its prefix has it stripped; a stripping tab reaches its app at the root…; S5 proxy lines |
| PORTAL-CR-13 | A proxy origin comes only from the environment and must be a bare http(s) origin (no open proxy) | `proxy.test.js` :: anything that is not a plain http origin is refused; an origin with a path is refused |
| PORTAL-CR-14 | A down app gives a 502 page that still carries the menu, with its own tab current | `proxy.test.js` :: an app that is down gives a 502 that still carries the menu; a stripping tab's 502 page still marks that tab as current; S5 `want 502` and the Education line |
| PORTAL-CR-15 | The hub states its tier (`X-Bkesari-Env`) and keeps non-production out of search; an unknown host is production | `smoke-dev.sh` *Tier identity*; `menu.test.js` :: an unknown hostname is treated as production, never as dev |
| PORTAL-CR-16 | The menu: seven tabs in the specified order, a checkbox (not `<details>`) disclosure, the `<noscript>` list matching `TABS`, on every static page | `menu.test.js` :: the seven tabs are present…; the mobile disclosure is a checkbox…; the welcome page's <noscript> list matches the tabs; every static hub page includes the shared bar |
| PORTAL-CR-17 | Nothing private is served: `/.env`, `/.git/config`, the server source, stack traces | `smoke-dev.sh` *Nothing private is served*; `server.test.js` :: a malformed JSON body is a 400 that gives nothing away; S6 malformed-body loop |
| PORTAL-CR-18 | The dev deploy refuses every target but dev (branch, path, host, smoke URL, empty secrets) | `.github/deploy/guard.test.sh` (32 cases) |
| PORTAL-CR-19 | Neon provisioning: one Singapore PostgreSQL 16 project per app with its tier branches, each app's login owning its database, a new password on every branch the run made (and a failed run naming any branch it made that still has the copied one), other projects (another site's) never touched, re-run creates nothing, dry run writes nothing, duplicate names refused, passwords only in 0600 files, an existing database under another owner never taken over | `neon-provision.test.js` (all 11) |
| PORTAL-CR-20 | `database/portal/01_portal_schema.sql` stays the schema the app applies | `schema-copy.test.js` (both); S3 #8 |

### R3 — change-area map

| When this changes | Emphasise |
|---|---|
| `portal/server.js` | all of R1 (`server.test.js` first); S5; S6; CR-01 to CR-07, CR-11, CR-17 |
| `portal/db.js`, `portal/sql/**`, `database/portal/**`, `package.json`, `package-lock.json` | R1; S3 #8; S4; **S7**; CR-07 to CR-10, CR-20 |
| `portal/proxy.js` | `proxy.test.js`; S5 proxy step; CR-11 to CR-14 |
| `portal/public/shared/menu.js`, `portal/public/**/*.html`, `page.css` | `menu.test.js`; S1 #5; S5; CR-04, CR-14 to CR-16 |
| `portal/public/tasks/**` | S1 #5; S5; S6 path loop; CR-01 |
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

Expected, and only these: in S2 the two PostgreSQL suites skip, because S2 runs without
`TEST_DATABASE_URL` on purpose (node lists them as `# SKIP` lines under `# suites`, not
`# skipped`); in S5 `smoke-dev.sh` warns that `/milk/`, `/edu/` and `/ladwani/` are not deployed,
because the smoke run sets no origins. Anything else skipping or warning is a regression (R4).

For reference, the suite as merged (before this spec, the same commit, clean tree): 80 tests,
63 pass, 9 fail, 8 skip, all from the MySQL/SQLite `tests/db-dialects.test.js` that the move to
PostgreSQL left behind; its assertions now live in `tracker.pg.test.js`.

## 6. Pass criteria

- **PASS**: every row of section 3 ran and passed, R1 has no failure and no skip, every R2 row's
  check passed, the counts are at or above section 5, and nothing above S4 is left open.
- **FAIL**: a defect above S4 is still open after the fix loop (three rounds at most).
- **BLOCKED**: something in section 3 could not run: no PostgreSQL, no `.env.test` or
  `SMOKE_DATABASE_URL`, a missing tool, or no Neon-like bed for S7. A level that did not run is
  never reported as passed; name what would unblock it. Also BLOCKED: any database setting that
  names Neon (`*.neon.tech`), a server, or a `_dev`/`_test`/`_prod` database other than the two
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
| ... all 20 ... |

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
- **Unauthenticated bodies are parsed before the login.** The JSON parsers run before the
  `/tasks/` and upload checks, so anyone can make the hub parse up to 1 MB (15 MB on the
  snapshot upload) per request. Not exploitable for data; a hardening item, not fixed here.
- **No browser test.** The menu's look, the hamburger at phone width, dark mode and the Task
  Tracker's screens are TESTING.md section 4, by hand.
- **No load or concurrency testing** beyond two processes creating the tables at once.
- **Not run:** `tools/setup_local_postgres.sh` (it creates roles and databases for every project
  and edits sibling repositories' `.env` files), `database/local/00_local_create_databases.sql`
  (superuser, every project's roles), `tools/check_local_git.sh` (needs the Mac's clones). Only
  their syntax is checked.
- **The dev deploy job** (rsync, `npm ci` on the server, Passenger restart) needs the SSH
  secrets and a server; only its guard and YAML are tested.
- **The proxied apps** are stand-ins: a real Next.js `basePath` or Laravel `APP_URL` is checked
  by `smoke-dev.sh` against a deployed tier and by TESTING.md section 4.
- **Draft PR sanjaymorankar-debug/bkesari-platform#10** (Neon services) is not on this branch.
  If it lands, update sections 2 and 5. Its `neon.ts`, `hello.ts`, `@neon/config` and
  `@neon/env` set up Neon services nobody asked for and are not wanted; its two good ideas
  (impossible ids are a 404, schema over `DATABASE_URL_UNPOOLED`) are already here.
