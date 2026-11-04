# Education platform — test specification

The Education Accountability Platform is the Laravel 13 / Livewire 3 (Volt) app in `edu/`,
published as the **Education tab at `/edu/`** on bkesari.com, test.bkesari.com and
dev.bkesari.com. The hub forwards `/edu/...` to the app's own site with the prefix removed and
the app writes it back on every URL from `APP_URL` (`AppServiceProvider::serveUnderBasePath()`,
`DEPLOY.md` Part 7). Its data is in **PostgreSQL on Neon**: database `bk_edu`, login `bk_edu_app`, one
Neon branch per tier, reached over the pooled endpoint (`DB_URL`) at runtime and the direct one
(`DB_URL_UNPOOLED`) for schema commands ([docs/NEON.md](../docs/NEON.md),
[DEPLOYMENT.md](DEPLOYMENT.md)). This spec covers `edu/` and the hand-run SQL in
`database/edu/`: the PHPUnit suite on SQLite and PostgreSQL, the migrations and seeders, the SQL
scripts, the committed Vite build, a smoke run through the hub, and the checks that prove the
app behaves on a pooler the way it will on Neon. What the suite covers, test by test, is
[TESTING.md](TESTING.md); what a deployed tier needs (hPanel, SSH, a browser) is the root
[TESTING.md](../TESTING.md). This file does not repeat either.

Testing agent: `.claude/agents/edu-tester.md`. It runs automatically after every code change
(the test gate, `.claude/hooks/test_gate.py`); run it by hand by asking Claude to "run the
edu-tester agent".

## 1. Scope

| Component | Path | Language / framework |
|---|---|---|
| App code: models, services, Livewire/Volt pages | `edu/app/`, `edu/resources/views/` | PHP 8.3, Laravel 13, Livewire 3.6, Volt 1.7 |
| Education's own sign-in, the shell's endpoints, languages | `edu/config/session.php`, `edu/routes/auth.php`, `edu/app/Livewire/Forms/LoginForm.php`, `edu/app/Services/{EmailSignIn,MobileSignIn}.php`, `edu/app/Support/{SignInCodes,BuiltinAdmins}.php`, `edu/app/Rules/NotReservedEmail.php`, `edu/app/Mail/SignInCodeMail.php`, `edu/config/mail.php`, `edu/app/Http/Controllers/{ShellController,Auth/SignOutController}.php`, `edu/app/Http/Middleware/SetLocale.php`, `edu/lang/*.json` | Laravel |
| Serving under `/edu/`, and whose forwarded address counts | `edu/app/Providers/AppServiceProvider.php`, `edu/app/Routing/BasePathRedirector.php`, `edu/bootstrap/app.php`, `edu/app/Http/Middleware/TrustHubProxy.php`, `edu/config/services.php` (`hub`) | Laravel |
| Database settings for Neon | `edu/config/database.php`, `edu/app/Database/PostgresConnector.php`, `edu/app/Providers/DatabaseServiceProvider.php` | Laravel, pdo_pgsql |
| Schema and demo data | `edu/database/migrations/` (70), `edu/database/seeders/` | Laravel migrations, PostgreSQL 16 |
| Hand-run SQL | `database/edu/01`–`04_*.sql`, `edu/database/sql/*.sql` | PostgreSQL |
| PHPUnit suite | `edu/tests/Unit`, `edu/tests/Feature` (`edu/phpunit.xml`) | PHPUnit 12 |
| Smoke and check scripts | `edu/tests/smoke/` | bash, Python 3, Node + Playwright |
| Front-end build (committed) | `edu/resources/{css,js}`, `edu/tailwind.config.js`, `edu/vite.config.js`, `edu/public/build/` | Vite 8, Tailwind 3 |

Out of scope:

- **The hub** (`portal/`), the root `tests/`, `scripts/`, `tools/` and the CI/deploy workflows:
  they are `portal-tester`'s ([../TEST_SPEC.md](../TEST_SPEC.md)). This spec only *runs* the hub,
  read-only, to reach the app through `/edu/`.
- **The standalone copy** of this app (`edu` repository, edutest.agtci.com): its own agent.
- **Neon itself, Hostinger, mail delivery, the cron entry**: external services with no local
  stand-in beyond the Neon-like bed in 2.6. Tests never connect to them.

## 2. Environment

### 2.1 Tools

| Tool | CI (`.github/workflows/ci.yml`, `edu` job) | Mac ([docs/MAC_DEPLOYMENT.md](../docs/MAC_DEPLOYMENT.md)) |
|---|---|---|
| PHP 8.3 with `pdo_pgsql`, `pdo_sqlite`, `mbstring`, `intl`, `gd`, `zip` | `shivammathur/setup-php`, 8.3 | `brew install php@8.3` |
| Composer 2 | preinstalled | `brew install composer` |
| PostgreSQL 16 (`psql`, `pg_dump`) | `postgres:16` service container | `brew install postgresql@16` |
| Node 22 / npm 10 (S4, S5) | not used by the `edu` job | `brew install node@22` |
| Python 3 (S1, S3, S5, S6 scripts) | preinstalled | macOS built-in |
| Playwright + Chromium (S5 browser) | not used | `npm i --no-save playwright && npx playwright install chromium` in a scratch folder, then `export NODE_PATH=<that folder>/node_modules` |
| PgBouncer (S7 only) | not used | `brew install pgbouncer` (2.6) |

### 2.2 The scratch databases

Two throwaway databases, both **owned by one login role that is not a superuser**. Nothing else
may use them:

| Name in this spec | Used by | What happens to it | Mac | This container (example) |
|---|---|---|---|---|
| suite database | S3a, S3b, R1, S5, S7 | **the suite drops and recreates every table**; S3b and S5 re-seed it and write rows | `bk_edu_test` | `t_pedu` |
| SQL database | S3c, S3d | **dropped and recreated** for each load | `bk_edu_sql` | `t_pedu_sql` |
| hub database | S5 (the hub needs one to start) | the hub creates its four tracker tables if missing | `bk_portal_test` | `t_pedu_hub` |

Never a Neon database, a database on a server, or a database any app uses (`bk_edu` is the local
app's own). The suite reads `DB_*` and `DB_URL` from the environment only when you export them;
`phpunit.xml` pins `DB_URL` and `DB_URL_UNPOOLED` to blank so an `.env` line can never reach a
test run.

On the Mac, once (as yourself; Homebrew's PostgreSQL makes your user a superuser):

```bash
cd ~/Projects/bkesari-platform
tools/setup_local_postgres.sh                 # role bk_edu, databases bk_edu and bk_edu_test (and bk_portal_test)
createdb -O bk_edu bk_edu_sql
psql -d postgres -c 'REVOKE CONNECT ON DATABASE bk_edu_sql FROM PUBLIC'
. ~/.bkesari_local_postgres.env               # BK_EDU_PASS and BK_PORTAL_PASS, written by the setup script
```

Any other machine: create a login role that is not a superuser, the databases it owns, and use
those names below.

### 2.3 Environment variables

The suite and the commands below read only what is exported in the shell that runs them. There
is no `.env` requirement: export `APP_KEY` instead of writing one (`cp .env.example .env && php
artisan key:generate --force` works too, and is what CI does).

| Variable | Read by | Safe local value |
|---|---|---|
| `APP_KEY` | everything (the encrypter refuses to boot without it) | `base64:` + 32 random bytes: `export APP_KEY="base64:$(openssl rand -base64 32)"` |
| `DB_CONNECTION` | the app, the suite | unset (SQLite, `phpunit.xml`) or `pgsql` |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | the app, the suite | the suite database: `127.0.0.1`, `5432`, `bk_edu_test`, `bk_edu`, `$BK_EDU_PASS` |
| `DB_URL` | the app (pooled endpoint on Neon); wins over the `DB_*` lines | blank, except in S5 and S7 (the pooled URL) |
| `DB_URL_UNPOOLED` | `migrate`, `db:seed`, `db:wipe` and the other schema commands | blank, except in S5 and S7 (the direct URL) |
| `DB_SSLMODE` | the app, when there is no URL | blank is fine (`prefer`) |
| `APP_URL` | the app; a path in it turns on base-path serving | S5: `http://127.0.0.1:3105/edu`. Never set it for the suite (`phpunit.xml` pins it) |
| `APP_ENV`, `APP_DEBUG`, `APP_NAME`, `SESSION_DRIVER`, `CACHE_STORE`, `QUEUE_CONNECTION` | the app (S5) | `production`, `false`, `"Education Accountability Platform"`, `database`, `database`, `database`: what a tier runs |
| `PHP_CLI_SERVER_WORKERS` | `artisan serve` (S5) | `4` |
| `EDU_ORIGIN`, `PORT`, `DATABASE_URL`, `TRACKER_USER`, `TRACKER_PASSWORD`, `ATIP_USER`, `ATIP_PASSWORD`, `ATIP_PUBLISH_TOKEN`, `APP_ENV` | the hub (S5 only) | `http://127.0.0.1:8101`, `3105`, the hub database, `smoke` / `smoke-local-only` for the logins and token, `dev` |
| `HUB_PROXY_SECRET` | the app and the hub (S5) | one random value given to both (`openssl rand -hex 32`). The suite needs none: only `TrustHubProxyTest` sends forwarded headers, and it sets its own |
| `HUB`, `APP`, `KILL_URL`, `DEMO_PASSWORD` | `tests/smoke/http.sh`, `tests/smoke/browser.cjs` | `http://127.0.0.1:3105`, `http://127.0.0.1:8101`, the direct URL (S7), `Password123!` (the demo password, `TEST_ACCOUNTS.md`) |

### 2.4 Ports

`8101` the app (`php artisan serve`), `3105` the hub in front of it, `6432` PgBouncer (S7).
`8001` is the local app of the Mac guide and `8000` is ATIP's: leave them alone. Stop every
process you start; check with `lsof -nP -iTCP:8101 -iTCP:3105 -sTCP:LISTEN` (or `ss -ltn`) at the
end.

### 2.5 One-time setup per run

```bash
cd edu
composer install --no-interaction --no-progress       # vendor/ (gitignored)
npm ci                                                 # edu/node_modules, S4 only
(cd .. && test -d node_modules/pg || npm ci)          # the hub's dependencies, S5 only; never delete them
export APP_KEY="base64:$(openssl rand -base64 32)"
export PG="postgresql://bk_edu:$BK_EDU_PASS@127.0.0.1"   # used by the commands below
```

Set `DB_*` (2.3) only for the commands that say so; leave them unset otherwise.

### 2.6 The Neon-like bed (S7)

S7 needs what makes Neon different from a laptop PostgreSQL: a **direct** endpoint with TLS, a
**pooled** endpoint that is PgBouncer in **transaction** mode with `max_prepared_statements`
set and TLS required, SCRAM authentication, and an app role that is not a superuser, owns its
database and is a member of a `neon_superuser` stand-in:

```sql
-- once, as a superuser
DO $$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='neon_superuser')
THEN CREATE ROLE neon_superuser NOLOGIN CREATEDB CREATEROLE; END IF; END$$;
GRANT neon_superuser TO bk_edu;
```

A bed is `ssl = on` in `postgresql.conf` (any certificate: libpq, and so PHP, does not verify
it on `sslmode=require`), and a `pgbouncer.ini` with `pool_mode = transaction`,
`max_prepared_statements = 1000`, `auth_type = scram-sha-256` (with `auth_user`/`auth_query`
reading `pg_shadow`, or an `auth_file`), `client_tls_sslmode = require` and a certificate. That is
the bed this spec was measured on (Linux, PostgreSQL 16.15, PgBouncer 1.22). On the Mac it is
Homebrew's `postgresql@16` and `pgbouncer`; that combination has not been tried. Then:

```bash
export POOLED="$PG:6432/bk_edu_test?sslmode=require"
export DIRECT="$PG:5432/bk_edu_test?sslmode=require&channel_binding=require"
```

PgBouncer 1.22 does not offer SCRAM channel binding, so the pooled URL here leaves out the
`&channel_binding=require` that Neon's strings carry; S7.5 proves the parameter still reaches
libpq. Without a bed, S7 is **SKIPPED with that reason** and the run cannot be PASS (section 6);
S7.2 and S7.3 need only PostgreSQL and run anyway.

S7.6, which S5's `browser.cjs` runs when given `KILL_URL`, ends **every other session of the
app's role on the suite database** (what Neon's suspend does), and S7.1 wipes that database.
Run neither alongside anything else that uses it.

## 3. Standard suite

Run in order, from `edu/`. Each row's command is literal; the "passes when" column is the gate.

| # | Level | Command | Passes when |
|---|---|---|---|
| 1 | S1 | `composer validate --no-check-publish` | exit 0, `./composer.json is valid` |
| 2 | S1 | `find app bootstrap config database routes tests resources -name '*.php' -print0 \| xargs -0 -n1 php -l \| grep -v '^No syntax errors'` | prints nothing |
| 3 | S1 | `php artisan route:list --json > /tmp/edu-routes.json && php artisan view:cache && php artisan view:clear` | all exit 0 (every route resolves, every Blade view compiles) |
| 4 | S1 | `vendor/bin/pint --test` | **report-only**: every file it lists must be one of the 15 in section 5 (the code was never Pint-clean and CI does not run it); a new file must not appear |
| 5 | S1 | the manifest check from `ci.yml` (`python3 - <<'PY' ... PY`, `edu` job, step "Check the built assets match the manifest") | `N manifest entries, all present` |
| 6 | S2 | `php artisan test --testsuite=Unit` | all pass |
| 7 | S3a | `php artisan test` (SQLite, in memory) | all pass; exactly the 5 skips section 5 names (`vendor/bin/phpunit --display-skipped` lists them) |
| 8 | S3a | `DB_CONNECTION=pgsql DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=bk_edu_test DB_USERNAME=bk_edu DB_PASSWORD=$BK_EDU_PASS php artisan test` | all pass, **0 skipped** |
| 9 | S3b | `DB_CONNECTION=pgsql DB_URL="$PG:5432/bk_edu_test" php artisan migrate:fresh --seed --force`, then `psql "$PG:5432/bk_edu_test" -Atc "select (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'), (select count(*) from migrations), (select count(*) from users), (select count(*) from schools), (select count(*) from complaints), (select extname from pg_extension where extname='citext')"` | exit 0; `74\|70\|289\|20\|100\|citext` |
| 10 | S3c | the SQL load, below | every file exit 0; `compare_schema.py` prints `schemas match` (it refuses a dump with no `CREATE TABLE`, so a failed `pg_dump` cannot pass); re-running 02 and 03 exits 0; `migrate --pretend` says `Nothing to migrate` |
| 11 | S3d | the incremental scripts, below | every file exit 0; `compare_schema.py` prints `schemas match` |
| 12 | S4 | `npm ci && rm -rf /tmp/edu-build && npx vite build --outDir /tmp/edu-build --emptyOutDir && diff -r /tmp/edu-build public/build` | `diff` prints nothing: the committed build is exactly what the sources produce |
| 13 | S5 | the smoke run, below | `http smoke: N passed, 0 failed` and `browser smoke: N passed, 0 failed` (60 and 21 at baseline) |
| 14 | S6 | the hygiene checks, below | each as stated |
| 15 | S7 | the Neon parity checks, below | each as stated |

**S3c, the SQL load.** As the scratch role, in order, then compare with what `migrate` built:

```bash
psql -d postgres -c 'DROP DATABASE IF EXISTS bk_edu_sql' -c 'CREATE DATABASE bk_edu_sql OWNER bk_edu'   # as a superuser
for f in 01_edu_schema 02_edu_reference_data 03_edu_demo_data_TEST_ONLY; do
  psql "$PG:5432/bk_edu_sql?sslmode=require" -q -v ON_ERROR_STOP=1 -1 -f ../database/edu/$f.sql > /dev/null || echo "FAIL $f"
done
for f in 02_edu_reference_data 03_edu_demo_data_TEST_ONLY; do                    # re-runnable
  psql "$PG:5432/bk_edu_sql?sslmode=require" -q -v ON_ERROR_STOP=1 -1 -f ../database/edu/$f.sql > /dev/null || echo "FAIL re-run $f"
done
sed -e "s/'Your Name'/'Spec Admin'/" -e "s/you@example.com/Spec.Admin@Example.test/g" \
    -e "s/\\\$2y\\\$10\\\$REPLACE_WITH_THE_60_CHARACTER_BCRYPT_HASH_FROM_THE_COMMAND_ABOVE/$(php -r 'echo addcslashes(password_hash("local-only", PASSWORD_BCRYPT), "\$/");')/" \
    ../database/edu/04_edu_first_admin.sql > /tmp/edu-04.sql
psql "$PG:5432/bk_edu_sql?sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/edu-04.sql     # twice: one row, role system_admin, both times
psql "$PG:5432/bk_edu_sql?sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/edu-04.sql
DB_CONNECTION=pgsql DB_URL="$PG:5432/bk_edu_sql" php artisan migrate --pretend --force  # INFO Nothing to migrate.
pg_dump --schema-only --no-owner --no-privileges "$PG:5432/bk_edu_test" > /tmp/edu-migrated.sql   # S3b's database
pg_dump --schema-only --no-owner --no-privileges "$PG:5432/bk_edu_sql"  > /tmp/edu-loaded.sql
python3 tests/smoke/compare_schema.py /tmp/edu-migrated.sql /tmp/edu-loaded.sql
```

Run it straight after row 9, before anything re-migrates `bk_edu_test`. The migrations logs
must match too: `psql ... -Atc "select migration||':'||batch from migrations order by id" | md5sum`
gives the same sum on both databases.

**S3d, the incremental scripts** (`edu/database/sql/`, the hand-run upgrade path for a database
that stopped at migration 40):

```bash
psql -d postgres -c 'DROP DATABASE IF EXISTS bk_edu_sql' -c 'CREATE DATABASE bk_edu_sql OWNER bk_edu'   # as a superuser
export DB_CONNECTION=pgsql DB_URL="$PG:5432/bk_edu_sql"
php artisan migrate --force && php artisan migrate:rollback --step=30 --force   # 40 migrations left
# --step is (total migrations - 40): bump it with every migration added, or the first script
# below hits a table the extra migration already created.
for f in 2026_09_02_student_growth_career_modules 2026_09_03_school_core_udise_fees_facilities \
         2026_09_03_safeguarding_exams_health 2026_09_03_benchmark_references \
         2026_09_03_courses_and_ratings 2026_09_03_replies_and_data_rights; do
  psql "$PG:5432/bk_edu_sql?sslmode=require" -q -v ON_ERROR_STOP=1 -1 -f database/sql/$f.sql > /dev/null || echo "FAIL $f"
done
php artisan migrate --force                     # runs only the migrations after the scripts (5: citext,
                                                # hub_user_id, mobile, decision attribution,
                                                # status-history clear)
unset DB_CONNECTION DB_URL
pg_dump --schema-only --no-owner --no-privileges "$PG:5432/bk_edu_sql" > /tmp/edu-incremental.sql
python3 tests/smoke/compare_schema.py /tmp/edu-migrated.sql /tmp/edu-incremental.sql
```

**S5, the smoke run.** Since 3 Nov 2026 the hub puts no sign-in of its own in front of `/edu/`
and forwards no identity: Education keeps its own accounts (`edu_sid` on `/edu`), so the hub
needs no setting for the smoke beyond its own database and `HUB_PROXY_SECRET`, which a tier sets on
both sides (D-038) and the smoke sets the same way. The hub's side of that (its redirect of
`/education/*`, the shell it serves) is `portal-tester`'s; the app's side is `OwnAccountTest`.
Seed the suite database the way a tier is set up (schema commands over
the direct URL, the app on the pooled one), start the app and the hub, run both scripts. Leave
both servers up for S6, then stop them (`kill %1`, or the PIDs from `lsof -nP -iTCP:8101
-iTCP:3105 -sTCP:LISTEN`) before S7. Without a PgBouncer bed, set `POOLED="$DIRECT"`, drop
`KILL_URL`, and say so in the report.

```bash
export APP_ENV=production APP_DEBUG=false APP_NAME="Education Accountability Platform" \
       APP_URL=http://127.0.0.1:3105/edu DB_CONNECTION=pgsql DB_URL="$POOLED" DB_URL_UNPOOLED="$DIRECT" \
       SESSION_DRIVER=database CACHE_STORE=database QUEUE_CONNECTION=database PHP_CLI_SERVER_WORKERS=4 \
       HUB_PROXY_SECRET="$(openssl rand -hex 32)"                     # the same value goes to the hub below
php artisan migrate:fresh --seed --force                                 # over $DIRECT, by itself
php artisan serve --host=127.0.0.1 --port=8101 --no-reload > /tmp/edu-serve.log 2>&1 &   # --no-reload passes the environment on
(cd .. && env -i PATH="$PATH" HOME="$HOME" EDU_ORIGIN=http://127.0.0.1:8101 PORT=3105 APP_ENV=dev \
   DATABASE_URL="postgresql://bk_portal:$BK_PORTAL_PASS@127.0.0.1:5432/bk_portal_test" \
   TRACKER_USER=smoke TRACKER_PASSWORD=smoke-local-only ATIP_USER=smoke ATIP_PASSWORD=smoke-local-only \
   ATIP_PUBLISH_TOKEN=smoke-local-only HUB_PROXY_SECRET="$HUB_PROXY_SECRET" node portal/server.js > /tmp/edu-hub.log 2>&1 &)
APP=http://127.0.0.1:8101 HUB=http://127.0.0.1:3105 bash tests/smoke/http.sh
HUB=http://127.0.0.1:3105 KILL_URL="$DIRECT" node tests/smoke/browser.cjs   # KILL_URL: S7.6
rm -rf storage/app/private/complaint-evidence storage/app/private/livewire-tmp   # the smoke's uploaded file
```

`http.sh` checks the public pages on the app and through the hub, the sign-in, sign-up and
forgot-password screens through the hub, that `/edu/shell/me` answers a guest 401 pointing at
`/edu/sign-in`, that `edu_sid` is set on `/edu` HttpOnly and SameSite=Lax, that
`/education/sign-in` redirects to `/edu/sign-in`, that every URL on four pages starts with `/edu`
(or is the hub's shared `/kesari-ui/` or `/shared/` file), that the build assets, Livewire's script,
Kesari and the shell load through the hub, that 12 protected pages send a guest to `/edu/login`,
and that 10 private paths (`.env`, `composer.json`, `storage/logs/...`, `../.env`) are 404 both
ways. `browser.cjs` (Chromium) opens `/edu/admin/rating-weights` signed out, signs in as
`admin@test.agtci.com` and must land back on that page; checks every URL on a signed-in page
(outside the hub's shell), that the stylesheet applies (Mukta) and Kesari's Education accent is
set, and that the shell shows the Education account; signs out through the shell's account menu
and must land on `/edu/sign-in`, after which `/edu/shell/me` is 401; files a complaint as `parent@test.agtci.com` (numbered, inside a
savepoint) with an evidence file, which must upload to `/edu/livewire/upload-file` (Livewire's
signed URL) and download again from the complaint page, and sees the complaint after a
reload; sends an erasure request and carries it out as
`dpo@test.agtci.com` (the app's multi-statement transaction); and fails on any failed request
or script error from the hub's origin.

**S6, hygiene.**

| Check | Command | Passes when |
|---|---|---|
| no tracked secrets | `git ls-files edu database/edu \| grep -E '(^\|/)\.env($\|\.)\|\.pem$\|\.key$\|id_rsa'` and `git grep -nIE 'AKIA[0-9A-Z]{16}\|-----BEGIN [A-Z ]*PRIVATE KEY\|ghp_[A-Za-z0-9]{30}\|npg_[A-Za-z0-9]{8,}' -- edu database/edu` | only `edu/.env.example`, with no value after `DB_PASSWORD=`, `DB_URL=`, `DB_URL_UNPOOLED=`, `APP_KEY=`; the grep prints nothing |
| the suite refuses a hosted database | `DB_URL_UNPOOLED='postgresql://x:y@ep-example.ap-southeast-1.aws.neon.invalid/bk_edu' php artisan test --filter=ExampleTest` and `DB_CONNECTION=pgsql DB_HOST=ep-example.ap-southeast-1.aws.neon.invalid php artisan test --filter=ExampleTest` | both stop with `Refusing to run tests: the [pgsql_unpooled]` / `[pgsql] connection's host [...] is not a local database server`, before any connection (`tests/TestCase.php`) |
| every protected page refuses a guest | with S5's servers up: `python3 tests/smoke/guest_routes.py /tmp/edu-routes.json http://127.0.0.1:3105/edu` | `0 not sent to .../edu/login` (56 routes at baseline) |
| nothing private served | `http.sh`'s last block (S5) | all PASS |
| PHP dependencies | `composer audit` | report-only: list each advisory in the report with whether this app reaches it (`No security vulnerability advisories found.` at baseline, Laravel 13.38.0) |
| JS build dependencies | `npm audit` and `npm audit --omit=dev` | report-only; `--omit=dev` must find 0 (nothing from npm is shipped but the built files) |

**S7, Neon parity.** Against the bed of 2.6, after R1 and with S5's servers stopped. Run 7.8
first, while S5's seed is still there, then 7.1 (which wipes the suite database), 7.2, 7.3 and
7.5. Three of the checks are evidence already collected by S3c and S5; the report records them
here:

| # | Check | Command | Passes when |
|---|---|---|---|
| 7.1 | the whole suite through the pooler, with TLS | `DB_CONNECTION=pgsql DB_URL="$POOLED" php artisan test` | all pass, 0 skipped (before the fix: 391 of 392 errored on SQLSTATE 25P02) |
| 7.2 | schema commands use the direct URL by themselves | `DB_CONNECTION=pgsql DB_URL="$PG:1/bk_edu_test?sslmode=require" DB_URL_UNPOOLED="$DIRECT" php artisan migrate:status`; the same without `DB_URL_UNPOOLED`; the same with `--database=pgsql` | exit 0, then exit 1 (`port 1 failed: Connection refused`), then exit 1: port 1 stands for an unreachable pooler |
| 7.3 | and still do under `config:cache` | `unset DB_CONNECTION DB_URL DB_URL_UNPOOLED; env DB_CONNECTION=pgsql DB_URL="$PG:1/bk_edu_test?sslmode=require" DB_URL_UNPOOLED="$DIRECT" php artisan config:cache && php artisan migrate:status; php artisan config:clear && test ! -f bootstrap/cache/config.php` | `migrate:status` exits 0 with no database variable in the environment. **Always run `config:clear` afterwards**: a cached config makes later test runs ignore `phpunit.xml` |
| 7.4 | migrations and seed from empty, as the non-superuser role, over TLS | S5's `migrate:fresh --seed` (over `$DIRECT` by itself), then `psql "$DIRECT" -Atc "select rolsuper, pg_has_role('neon_superuser','member') from pg_roles where rolname=current_user; select extname, pg_get_userbyid(extowner) from pg_extension where extname='citext'"` | `f\|t` and `citext\|bk_edu` |
| 7.5 | `channel_binding` reaches libpq | `DB_CONNECTION=pgsql DB_URL="$POOLED&channel_binding=require" php artisan migrate:status --database=pgsql` against PgBouncer 1.22; then `DB_CONNECTION=pgsql DB_URL="$DIRECT" php artisan migrate:status --database=pgsql` | the first is refused with `channel binding is required, but server did not offer...` (before the fix it connected: the parameter was dropped); the second exits 0 |
| 7.6 | the app on the pooled URL, through dropped connections | S5 (the app runs on `DB_URL="$POOLED"`, and `browser.cjs` gets `KILL_URL`) | 0 failed, including `terminated N server connection(s)` followed by `the next request succeeds, still signed in` |
| 7.7 | the SQL scripts over the direct URL with TLS, as the non-superuser owner | S3c, which already loads with `sslmode=require` as `bk_edu` | as S3c |
| 7.8 | complaint numbers under real contention, through the pooler | after S5's seed, with S5's servers stopped: `DB_CONNECTION=pgsql DB_URL="$POOLED" PROCS=6 PER=10 bash tests/smoke/concurrent_numbers.sh` | six `process N: ok=10` lines and `created\|distinct numbers: 60\|60`; it deletes its rows again (before the lock: 4 of 6 processes failed, 29 created) |

## 4. Regression suite

### R1 — the full test suite

All of it, on both engines, every run: rows 7 and 8 above (`php artisan test` on SQLite, and the
same with `DB_CONNECTION=pgsql` and the suite database), plus S7.1 when the bed exists. No
`--filter`, no `--testsuite`. The two PostgreSQL runs must show 0 skipped.

### R2 — critical regressions

| ID | Behaviour that must never break | Checked by |
|---|---|---|
| EDU-CR-01 | Every URL the app writes under the hub starts with `/edu` (routes, assets, Livewire's update URI and script), and Livewire's signed upload URL carries one prefix and passes its signature check | `tests/Feature/Platform/BasePathTest.php` (13 tests); `http.sh` URL and asset blocks; `browser.cjs` steps 1 and 3 |
| EDU-CR-02 | A guest sent to sign in from a protected page returns to that page, query string kept | `BasePathTest::test_a_guest_redirect_remembers_the_prefixed_page_it_came_from`, `::test_the_remembered_page_keeps_its_query_string`; `browser.cjs` step 1 |
| EDU-CR-03 | Signing out (through the shell or the app's own form) and every literal link stays inside `/edu/` | `BasePathTest::test_no_view_hardcodes_a_root_relative_link`, `OwnAccountTest::test_the_shell_signs_out_with_a_json_post`; `browser.cjs` step 2 |
| EDU-CR-04 | A complaint, feedback or safeguarding row never carries the submitter's identity, and neither does its status-history row — `recordStatusChange()` drops a submitter id at the chokepoint; a submitter who also holds a staff or officer role cannot act officially on their own complaint, appeal or safeguarding case (respond, reveal, decide, acknowledge, record the external report, close — nor open the case), so no response, audit, identity-access, appeal or safeguarding row names them beside it, and this holds for a `system_admin` (the role the hub's built-in administrators get, which carries every permission): the refusals sit *before* the role branches. Stated once as a query over all ten relations that could carry the link, with a test that plants a leak in each. Those refusals assume the standing was granted by somebody else, so the grant is gated too: a member of staff cannot decide their own request to link the school, nor reach the same standing by inviting their own address or accepting an invitation they sent. Reversing an anonymous ref needs the permission and a reason, and is logged | `AnonymizationTest` (17 tests, mutation-tested), `tests/Feature/Platform/Concerns/AssertsAnonymityInvariants.php`; `SafeguardingTest`'s five two-hats tests; `RegistrationFlowTest`'s five self-grant tests |
| EDU-CR-05 | School, district and state boundaries; government roles never reach an individual child's records | `RbacBoundaryTest`, `GrowthAccessBoundaryTest` (mutation-tested), `HealthAccessMatrixTest` |
| EDU-CR-06 | DPDP consent gates growth, career, life-skills and health data, per purpose, withdrawable at once | `ConsentGateTest`, `HealthPortalTest` |
| EDU-CR-07 | Safeguarding cases are invisible to school admins; a POCSO case cannot close without an external report; and the person who reported a case never handles it (`canView()` refuses the reporter before the `system_admin` branch, `canManage()` inherits it, the queue leaves it out) while a colleague still can | `SafeguardingTest` (35 tests) |
| EDU-CR-08 | Erasure never deletes safeguarding, consent or audit records; it runs as one transaction | `DataSubjectRequestTest`; `browser.cjs` step 4 (through the pooler in S7.6) |
| EDU-CR-09 | Aggregates below 10 are withheld; no row-level path for government | `HealthAggregateTest` |
| EDU-CR-10 | Two-factor sign-in: TOTP and single-use recovery codes, and at most 5 wrong codes per account per minute | `TwoFactorAuthTest` (12 tests, two of them with codes sent together) |
| EDU-CR-11 | Complaint numbers are unique and never fail a submission: not after a gap, not under contention (a transaction-scoped advisory lock per district and year), and a clash leaves the caller's transaction usable | `ComplaintNumberTest` (5 tests, mutation-tested); `ComplaintFlowTest`; `browser.cjs` step 3; S7.8 |
| EDU-CR-12 | Email sign-in, registration and admin lookup are case-insensitive on PostgreSQL; school search is too | `DatabaseCompatibilityTest` (the 3 email tests skip on SQLite and must run on PostgreSQL) |
| EDU-CR-13 | Nothing breaks behind a transaction-mode pooler: no named prepared statements, no session `SET`, transactions commit | `NeonReadinessTest` (its 8 pooler tests, mutation-tested); S7.1, which CI also runs |
| EDU-CR-14 | `migrate` and the other schema commands use `DB_URL_UNPOOLED`, an explicit `--database` wins, other commands stay pooled, also under `config:cache` | `SchemaCommandRoutingTest` (7 tests); S7.2, S7.3 |
| EDU-CR-15 | A Neon URL's `sslmode` and `channel_binding` are honoured | `NeonReadinessTest::test_a_neon_url_keeps_tls_and_channel_binding_all_the_way_to_libpq`; S7.5 |
| EDU-CR-16 | Every migration and seeder runs from empty as a non-superuser, `citext` included | S3b, S7.4 |
| EDU-CR-17 | The hand-run SQL builds exactly the schema the migrations build, and its data scripts re-run cleanly | S3c, S3d |
| EDU-CR-18 | The committed build matches its manifest and is exactly what the sources produce | S1 row 5, S4 |
| EDU-CR-19 | Every protected GET route refuses a guest; no private file is served; complaint evidence downloads only for those the complaint policy allows, and only through its own complaint; the suite refuses a hosted database | S6 `guest_routes.py`, `http.sh`, the S6 refusal check; `ComplaintEvidenceTest` (3); `NeonReadinessTest`'s three `test_the_suite_refuses_*` |
| EDU-CR-20 | No score, rank or label column in the growth or benchmark tables; a school cannot verify itself, and a teacher cannot rate themselves (a teacher who is also a verified parent at their own school satisfies the shared-school check) | `NoLabelingRulesTest`, `BenchmarkHonestyTest`, `UdiseVerificationTest`, `ClaimedVsExperiencedTest`, `TeacherEffectivenessTest::test_a_teacher_who_is_also_a_parent_cannot_rate_themselves` |
| EDU-CR-21 | Education's own accounts: the session cookie is `edu_sid`, on the path of `APP_URL`, Secure with https, HttpOnly, SameSite=Lax; nothing the hub forwards signs anyone in; five wrong passwords lock sign-in for 15 minutes, counted per account and per real client address: a forwarded address (`X-Forwarded-For`, and the forwarded scheme) is believed only from a request carrying the hub's `HUB_PROXY_SECRET` (D-038, `App\Http\Middleware\TrustHubProxy`), which sends the one address it worked out, never a chain a client sent; with no secret configured every proxy is trusted as before and the log says so once a day; a sign-in code, by email or (only where SMS is set up) by text, is hashed, single-use, expires in 10 minutes, dies after 5 wrong tries, is rate-limited, goes to no unknown address, still leaves two-factor to pass, and is shown on screen only on `APP_ENV` `local` or `dev` with nothing set up to deliver it (never on test or production); the first emailed code makes an account nobody had confirmed the inbox owner's (D-035): the email is confirmed, the old password replaced, and every earlier session and open two-factor challenge ends, as after a password reset, including a sign-in that checked the old password a moment before (a session ends at its next request once the account's password has changed); the built-in administrators (D-036) sign in only with their username and the password whose bcrypt hash is `BUILTIN_ADMIN_PASSWORD_BCRYPT`, as system admin, counted 5 per name and address and 50 per name from every address per 15 minutes, their `@builtin.bkesari.com` domain refused wherever an address is typed, however it is typed (a dotted capital I or a Kelvin sign included, which PostgreSQL's citext lowercases to it: `BuiltinAdmins::isReservedEmail()` and `EmailSignIn::normalize()` lowercase as citext does), and a row made on it before is taken over (password, sessions, two-factor and roles its maker set); all of these hold for requests sent together | `OwnAccountTest`, `EmailSignInTest`, `MobileSignInTest`, `AttemptsTest`, `PasswordResetTest`, `BuiltinAdminTest`, `ReservedEmailTest`, `TrustHubProxyTest`, `BasePathTest::test_the_session_cookie_is_sent_only_under_the_prefix_and_only_over_https`; `http.sh` cookie and `shell/me` lines; `browser.cjs` step 2 |
| EDU-CR-22 | Every official decision is logged against the person who took it, and cannot be forged by mass assignment; no audit row ever names a *submitter* (or their IP) alongside their complaint or feedback — staff and officers acting officially are named | `AuditLoggingTest` (14 tests, mutation-tested — including a dual-role actor, the case the blanket invariant test was blind to); `NotificationsTest::test_rejecting_a_relationship_notifies_nobody` |

### R3 — change-area map

| When this changes | Emphasise |
|---|---|
| `config/database.php`, `app/Database/**`, `app/Providers/DatabaseServiceProvider.php`, `phpunit.xml`, `config/queue.php` | R1 on both engines, all of S7, CR-13 to CR-15 |
| `app/Providers/AppServiceProvider.php`, `app/Routing/**`, `bootstrap/app.php`, `app/Http/Middleware/**`, `config/services.php` (`hub`), `routes/**`, `resources/views/layouts/**`, `resources/views/livewire/layout/**`, any `href`/`action`/`redirect` in a view | `BasePathTest`, `TrustHubProxyTest`, S5 (with `HUB_PROXY_SECRET` on both sides), S6 `guest_routes.py`, CR-01 to CR-03, CR-19, CR-21 (the address the limits count) |
| `resources/views/livewire/pages/auth/**`, `app/Livewire/Forms/LoginForm.php`, `app/Support/EndSessions.php`, `bootstrap/app.php` (`authenticateSessions()`), `app/Models/TwoFactorAuthentication.php`, `app/Services/{EmailSignIn,MobileSignIn}.php`, `app/Support/{SignInCodes,Attempts,BuiltinAdmins}.php`, `app/Rules/NotReservedEmail.php`, `config/services.php` (`builtin_admins`), `app/Mail/SignInCodeMail.php`, `resources/views/emails/sign-in-code*.blade.php`, `config/mail.php`, `config/session.php`, `routes/auth.php`, `app/Http/Controllers/{ShellController,Auth/SignOutController}.php` | `Auth/*` (with `OwnAccountTest`, `EmailSignInTest`, `MobileSignInTest`, `BuiltinAdminTest`), `ReservedEmailTest`, `TwoFactorAuthTest`, `LanguageTest` (the strings), `browser.cjs`, CR-02, CR-10, CR-21 |
| `app/Http/Middleware/SetLocale.php`, `lang/*.json`, `bootstrap/app.php` (cookie encryption) | `LanguageTest`, S5 |
| `database/migrations/**` | S3b, S3c (regenerate `database/edu/01_edu_schema.sql` with `pg_dump --schema-only --no-owner --no-privileges` and its migrations log), S7.4, CR-16, CR-17, the schema-level tests in `AnonymizationTest`, `NoLabelingRulesTest`, `BenchmarkHonestyTest`, `HealthAccessMatrixTest` |
| `database/seeders/**` | S3b, `database/edu/02` and `03` if the rows they carry changed, `TEST_ACCOUNTS.md` |
| `database/edu/*.sql`, `edu/database/sql/*.sql` | S3c, S3d, CR-17 |
| `resources/views/livewire/teacher-feedback/**`, `feedback/**`, `facilities/rate.blade.php`, `courses/rate.blade.php` | the rater must not be the subject, and no row may name the rater: `TeacherEffectivenessTest`, `SchoolFeedbackTest`, `CourseRatingTest`, CR-04, CR-20 |
| `app/Services/*Access*`, `ConsentService`, `SafeguardingService`, `DataSubjectRequestService`, `Health*`, `IdentityResolutionService` | CR-04 to CR-09 and their test files; `SafeguardingService`'s `canView`/`canManage` and `safeguarding/queue.blade.php` also → `AnonymizationTest`, `SafeguardingTest`, CR-04 |
| `app/Models/AuditLog.php`, `app/Models/Concerns/RecordsVerificationDecision.php`, `School::markRecognitionVerified`, any new `AuditLog::record*` call site | `AuditLoggingTest`, CR-22, and CR-04 if the call site touches a complaint or feedback |
| `dashboards/school.blade.php`'s `decide()`/`authorizeRelationship()`/`sendInvite()` and `invitations/show.blade.php`'s `accept()` — the grant of verified standing, which every dual-role refusal rests on | `AuditLoggingTest`, `NotificationsTest` (an approval notifies, a rejection notifies nobody), `RegistrationFlowTest` (the cross-school refusal and the five self-grant tests), CR-04, CR-05, CR-22 |
| `app/Models/Complaint.php`, `resources/views/livewire/complaints/**`, `app/Http/Controllers/ComplaintEvidenceController.php`, `app/Policies/ComplaintPolicy.php` | `ComplaintNumberTest`, `ComplaintEvidenceTest`, `ComplaintFlowTest`, `RbacBoundaryTest`, `browser.cjs` step 3, S7.8, CR-11, CR-19; `recordStatusChange()` and `ComplaintPolicy`'s `respond`/`review` also → `AnonymizationTest`, CR-04, CR-22 |
| `tests/Feature/Platform/Concerns/AssertsAnonymityInvariants.php` | CR-04: every relation that pairs an actor column with a submitter's `anonymous_ref` must be listed there, and `AnonymizationTest::test_the_submitter_link_invariant_detects_a_leak_in_every_relation_it_covers` must plant a leak in the new one |
| `tests/TestCase.php`, `phpunit.xml` | the S6 refusal check, R1 on both engines, CR-19 |
| `resources/views/**`, `resources/css/**`, `resources/js/**`, `tailwind.config.js`, `vite.config.js`, `package*.json` | S4: rebuild with `npm run build` and commit `public/build/` with the change (Hostinger has no Node), then S5 |
| `composer.json`, `composer.lock` | S1 rows 1–3, R1, S6 `composer audit` |

### R4 — baseline comparison

Every count in section 5 is a floor: tests, assertions and the guest routes probed may go up,
never down, and a test that skips where the baseline has it passing is a failure even if
nothing is red. On SQLite exactly the baseline's skips are allowed; on PostgreSQL none. Pint's
list may shrink, never grow.

## 5. Baseline

Measured 2026-10-24 on Linux (4 shared CPUs), PHP 8.3.6 (libpq 16.15), Composer 2.8.12,
PostgreSQL 16.15, PgBouncer 1.22 (transaction mode, `max_prepared_statements=1000`, TLS
required), Node 22.22 / npm 10.9, Chromium via Playwright. Role `t_pedu` (not a superuser,
member of `neon_superuser`), suite database `t_pedu`, SQL database `t_pedu_sql`, hub database
`t_pedu_hub`. Branch `claude/fervent-bell-wcmmdu`.

**First run**: commit `af66526` (`edu/` is identical at `4b5eec9`), before any fix in this run.
**Final run**: `4b5eec9` plus this run's working-tree changes (section 8's report lists them),
after a second round of fixes (evidence downloads and uploads, the numbering lock, the
hosted-database guard). **Re-measured at `40a2003`** after the approved security update
(`composer update laravel/framework symfony/http-foundation league/commonmark
--with-dependencies`: Laravel 13.26.1 → 13.38.0, symfony/http-foundation 7.4.17 → 7.4.21,
league/commonmark 2.10.0 → 2.10.4, 46 packages in all): every count below is unchanged except
`composer audit`, now 0. A fresh container (the bed rebuilt from `/etc/neonlike`, the role
`t_pedu` given an `auth_file` entry), same versions otherwise.

| # | Level | First run | Final run |
|---|---|---|---|
| 1 | S1 composer validate | valid | valid |
| 2 | S1 php -l | 345 files, 0 errors | 352 files (7 new), 0 errors |
| 3 | S1 routes, views | 76 routes, views compile | 76 routes, views compile |
| 4 | S1 Pint (report-only) | 15 files listed (below) | the same 15 |
| 5 | S1 manifest | 2 entries, all present | 2 entries, all present |
| 6 | S2 Unit | 1 test, 1 passed | 1 test, 1 passed |
| 7 | S3a SQLite | 392 tests: 389 passed, 3 skipped, 1,088 assertions, 20 s | 423 tests: 418 passed, 5 skipped, 1,233 assertions, 24 s |
| 8 | S3a PostgreSQL | 392 tests: 392 passed, 1,094 assertions, 46 s | 423 tests: 423 passed, 1,241 assertions, 46 s |
| 9 | S3b migrate:fresh --seed | 74 tables, 66 migrations, 289 users, 20 schools, 100 complaints, citext; 80 s | the same counts; 78 s |
| 10 | S3c SQL load | all load and re-run; schemas match (5,546 lines, 70 CHECKs); nothing to migrate | the same, and 04 run twice gives one row, role `system_admin`; 4 s |
| 11 | S3d incremental SQL | all load; schemas match | all load; schemas match; 4 s |
| 12 | S4 rebuild | **FAIL**: rebuilt CSS differs; 3 classes the views use (`border-indigo-200`, `mt-5`, `sm:w-80`) missing from the committed CSS | byte-identical to the committed build (rebuilt in this run: `app-CDqm9BMW.css`); 10 s |
| 13 | S5 smoke | not run before the fixes (a later probe on the earlier fixes: evidence upload through `/edu/` 404 at `/edu/edu/livewire/upload-file`) | http 50 passed, 0 failed (3 s); browser 18 passed, 0 failed (13 s), with `KILL_URL` |
| 14 | S6 | no secrets; 56 guest routes refused (measured after the fixes); no hosted-database guard existed; `composer audit` 6 advisories; `npm audit` 7 (dev tooling), 0 with `--omit=dev` | no secrets; both hosted-database runs refused; 56 guest routes refused; `composer audit` 0 after the security update (6 before: 3 laravel/framework, 2 league/commonmark, 1 symfony/http-foundation); `npm audit` 7 (report-only), 0 with `--omit=dev` |
| 15 | S7.1 suite through the pooler | **FAIL**: 392 tests, 1 passed, 391 errors (SQLSTATE 25P02, from the migrations on), 42 s | 423 tests: 423 passed, 1,241 assertions, 31 s |
| 15 | S7.2 / 7.3 routing | not possible (no direct-endpoint setting existed) | exit 0 / 1 / 1 as specified; 0 under `config:cache`, cache cleared |
| 15 | S7.5 channel_binding | **FAIL**: `channel_binding=require` dropped, connected anyway | refused by PgBouncer 1.22 with `channel binding is required`; the direct endpoint connects |
| 15 | S7.8 contention, 6 × 10 through the pooler | **FAIL** (retry only, measured before the lock): 4 of 6 processes failed, 29 created | 60 created, 60 distinct; 2 s |

**Re-measured 2026-11-03** after Education's own sign-in (no hub token; `edu_sid`; 15-minute
lockout; mobile codes; `users.mobile`, migration 68), the Kesari UI and the three languages. Same
container type and versions (PHP 8.3.6, PostgreSQL 16, PgBouncer 1.22.0, Node 22, Chromium via
Playwright 1.63). These were the floor until 4 Nov 2026:

| # | Level | Result |
|---|---|---|
| 2 | S1 php -l | 364 files, 0 errors (362 + `Support/Attempts.php` and `AttemptsTest.php`, edu-tester 3 Nov 2026) |
| 3 | S1 routes, views | 81 routes (`sign-in`, `sign-up`, `verify`, `logout`, `shell/me` added), views compile |
| 4 | S1 Pint | the same 15 |
| 7 | S3a SQLite | 473 tests: 468 passed, 5 skipped (the same 5), 2,468 assertions, 30 s. `HubSignInTest` (8 tests) was removed with the feature; 40 tests added, then 8 for requests sent together (edu-tester D1–D5) |
| 8 | S3a PostgreSQL | 473 tests: 473 passed, 2,476 assertions, 61 s |
| 9 | S3b | `74\|68\|289\|20\|100\|citext`; 75 s |
| 10–11 | S3c, S3d | schemas match (5,564 lines, 70 CHECKs); migrations logs identical; 04 twice gives one row |
| 12 | S4 | byte-identical (`app-DNyD-VXB.css`) |
| 13 | S5 | http 60 passed (3 s); browser 21 passed (9 s), with `KILL_URL` through PgBouncer |
| 14 | S6 | 57 guest routes refused; both hosted-database runs refused; `composer audit` 1 (symfony/mime CVE-2026-45070, reported 2026-10-28); `npm audit` 5 dev-only, 0 with `--omit=dev` |
| 15 | S7.1 | 473 passed through the pooler, 38 s; 7.2/7.3/7.5/7.8 as specified |

**Re-measured 2026-11-04** (edu-tester, commit `7c0604e`; `edu/` code unchanged at `df661a9`,
whose D-034 mailbox change touched only `.env.example`, `DEPLOYMENT.md`, `ROADMAP.md`) after sign-in codes by email through
Hostinger's SMTP, codes on screen only on `local`/`dev` with nothing to deliver them, SMS on hold
(owner's decisions D-029 to D-032) and `symfony/mime` 7.4.22. Same container type and versions
(PHP 8.3.6 with libpq 16.15, PostgreSQL 16.15, PgBouncer 1.22.0, Node 22.23, Chromium via
Playwright 1.63). These were the floor until the D-035 re-measure below:

| # | Level | Result |
|---|---|---|
| 2 | S1 php -l | 370 files, 0 errors (364 + `Services/EmailSignIn.php`, `Support/SignInCodes.php`, `Mail/SignInCodeMail.php`, the two `emails/sign-in-code*.blade.php` views and `EmailSignInTest.php`) |
| 3 | S1 routes, views | 81 routes, views compile |
| 4 | S1 Pint | the same 15 |
| 7 | S3a SQLite | 501 tests: 496 passed, 5 skipped (the same 5), 2,911 assertions, 20 s. 28 tests added: `EmailSignInTest` 23, `MobileSignInTest` +2, `OwnAccountTest` +2, `LanguageTest` +1 |
| 8 | S3a PostgreSQL | 501 tests: 501 passed, 2,919 assertions, 35 s |
| 9 | S3b | `74\|68\|289\|20\|100\|citext`; 74 s |
| 10–11 | S3c, S3d | schemas match (5,564 lines, 70 CHECKs); migrations logs identical; 04 twice gives one row |
| 12 | S4 | byte-identical (`app-DNyD-VXB.css`) |
| 13 | S5 | http 60 passed (2 s); browser 21 passed (9 s), with `KILL_URL` through PgBouncer |
| 14 | S6 | 57 guest routes refused; both hosted-database runs refused; `composer audit` 0 (`symfony/mime` 7.4.22 clears CVE-2026-45070); `npm audit` 5 dev-only, 0 with `--omit=dev` |
| 15 | S7.1 | 501 passed through the pooler, 28 s; 7.2/7.3/7.5/7.8 as specified |

**Re-measured 2026-11-04, D-035** (edu-tester, commit `78ca2d0` plus its fixes in the working tree)
after an emailed code makes an unconfirmed account the inbox owner's (`Support/EndSessions.php`;
a reset also confirms the email and ends every earlier session), `authenticateSessions()` in
`bootstrap/app.php` (a session ends at its next request once the password has changed) and a
two-factor challenge bound to the password it was opened with. Same container type and versions.
These were the floor until the D-036 re-measure below:

| # | Level | Result |
|---|---|---|
| 2 | S1 php -l | 371 files, 0 errors (370 + `Support/EndSessions.php`) |
| 3 | S1 routes, views | 81 routes, views compile |
| 4 | S1 Pint | the same 15 |
| 7 | S3a SQLite | 508 tests: 503 passed, 5 skipped (the same 5), 2,957 assertions, 20 s. 7 tests added: `EmailSignInTest` +5 (28), `PasswordResetTest` +2 (6) |
| 8 | S3a PostgreSQL | 508 tests: 508 passed, 2,965 assertions, 38 s |
| 9 | S3b | `74\|68\|289\|20\|100\|citext`; 76 s |
| 10–11 | S3c, S3d | schemas match (5,564 lines, 70 CHECKs); migrations logs identical; 04 twice gives one row |
| 12 | S4 | byte-identical (`app-DNyD-VXB.css`) |
| 13 | S5 | http 60 passed (3 s); browser 21 passed (9 s), with `KILL_URL` through PgBouncer |
| 14 | S6 | 57 guest routes refused; both hosted-database runs refused; `composer audit` 0; `npm audit` 5 dev-only, 0 with `--omit=dev` |
| 15 | S7.1 | 508 passed through the pooler, 31 s; 7.2/7.3/7.5/7.8 as specified |

**Re-measured 2026-11-04, D-036** (edu-tester, commit `9977bdd` plus its fixes in the working tree)
after the built-in administrators became an account of Education's own (`Support/BuiltinAdmins.php`,
`Rules/NotReservedEmail.php`; the `@builtin.bkesari.com` domain reserved wherever an address is
typed), with a limit of 50 tries per built-in name from every address per 15 minutes, a take-over
that also removes what a row's maker set up on it, and school registration no longer giving an
existing account a role (edu-tester D1–D4). Same container type and versions (PHP 8.3.6 with libpq
16.15, PostgreSQL 16.15, PgBouncer 1.22.0, Node 22.23, Chromium via Playwright 1.63). These were the
floor until the D-038 re-measure below:

| # | Level | Result |
|---|---|---|
| 2 | S1 php -l | 374 files, 0 errors (371 + `Support/BuiltinAdmins.php`, `Rules/NotReservedEmail.php`, `BuiltinAdminTest.php`) |
| 3 | S1 routes, views | 81 routes, views compile |
| 4 | S1 Pint | the same 15 |
| 7 | S3a SQLite | 531 tests: 526 passed, 5 skipped (the same 5), 3,462 assertions, 30 s. 23 tests added: `BuiltinAdminTest` 21 (18, then 3 for D2–D4), `RegistrationFlowTest` +2 (D1) |
| 8 | S3a PostgreSQL | 531 tests: 531 passed, 3,470 assertions, 54 s |
| 9 | S3b | `74\|68\|289\|20\|100\|citext`; 80 s |
| 10–11 | S3c, S3d | schemas match (5,564 lines, 70 CHECKs); migrations logs identical; 04 twice gives one row |
| 12 | S4 | byte-identical (`app-DNyD-VXB.css`) |
| 13 | S5 | http 60 passed (3 s); browser 21 passed (9 s), with `KILL_URL` through PgBouncer |
| 14 | S6 | 57 guest routes refused; both hosted-database runs refused; `composer audit` 0; `npm audit` 5 dev-only, 0 with `--omit=dev` |
| 15 | S7.1 | 531 passed through the pooler, 40 s; 7.2/7.3/7.5/7.8 as specified |

**Re-measured 2026-11-04, D-038** (edu-tester, commit `b5908df` plus its fix in the working tree; `edu/` is as
at `f619236`, and `43a5997` carries the D-036 block's fixes unchanged). Education believes a forwarded client address only from a
request carrying the hub's `HUB_PROXY_SECRET` (`Http/Middleware/TrustHubProxy.php` in place of the
framework's TrustProxies), and the hub sends the one address it worked out. With no secret the old
rule stays, and the warning that says so is written once a day, not on every request (edu-tester
D1). S5 ran with the secret on both sides, and again with it blank. The hub was `b5908df`'s (`portal-tester`'s
D1: the address and the secret also on a request with an `Expect` header). Same container type and versions (PHP 8.3.6 with libpq
16.15, PostgreSQL 16.15, PgBouncer 1.22.0, Node 22.23, Chromium via Playwright 1.63). These were
the floor until the PR #29 re-measure below:

| # | Level | Result |
|---|---|---|
| 2 | S1 php -l | 376 files, 0 errors (374 + `Http/Middleware/TrustHubProxy.php`, `TrustHubProxyTest.php`) |
| 3 | S1 routes, views | 81 routes, views compile |
| 4 | S1 Pint | the same 15 |
| 7 | S3a SQLite | 536 tests: 531 passed, 5 skipped (the same 5), 3,485 assertions, 29 s. 5 tests added: `TrustHubProxyTest` 4, then 1 for D1 |
| 8 | S3a PostgreSQL | 536 tests: 536 passed, 3,493 assertions, 47 s |
| 9 | S3b | `74\|68\|289\|20\|100\|citext`; 79 s |
| 10–11 | S3c, S3d | schemas match (5,564 lines, 70 CHECKs); migrations logs identical; 04 twice gives one row, `system_admin` |
| 12 | S4 | byte-identical (`app-DNyD-VXB.css`) |
| 13 | S5 | with `HUB_PROXY_SECRET` on both sides: http 60 passed (3 s), browser 21 passed (9 s), with `KILL_URL` through PgBouncer. With it blank: the same, and one warning line for the 163 requests the app handled (before the D1 fix: 164 lines for 164) |
| 14 | S6 | 57 guest routes refused; both hosted-database runs refused; `composer audit` 0; `npm audit` 5 dev-only, 0 with `--omit=dev` |
| 15 | S7.1 | 536 passed through the pooler, 40 s; 7.2/7.3/7.5/7.8 as specified |

**Re-measured 2026-11-04, PR #29** (edu-tester, commit `4458e73` plus its fix in the working tree). The
merge of `dev` brought `ReservedEmailTest` (6 tests) from PR #29. `BuiltinAdmins::isReservedEmail()` now
lowercases with the simple Unicode mapping, as PostgreSQL's citext does: a dotted capital I is a plain i and
a Kelvin sign a plain k there, and so `bu\u{0130}ltin.bkesari.com` is the reserved domain. On this bed (`C.UTF-8`, libc)
that mapping equals `lower()` at every code point; `Str::lower` differs at U+0130 only. `EmailSignIn::normalize()`
lowercases the same way, so the emailed-code form refuses the dotted form too (edu-tester D1). S5 ran with
`HUB_PROXY_SECRET` on both sides. Same container type and versions (PHP 8.3.6 with libpq 16.15, PostgreSQL
16.15, PgBouncer 1.22.0, Node 22.23, Chromium via Playwright 1.63). These are now the floor:

| # | Level | Result |
|---|---|---|
| 2 | S1 php -l | 377 files, 0 errors (376 + `ReservedEmailTest.php`) |
| 3 | S1 routes, views | 81 routes, views compile |
| 4 | S1 Pint | the same 15 |
| 7 | S3a SQLite | 544 tests: 539 passed, 5 skipped (the same 5), 3,557 assertions, 32 s. 8 tests added: `ReservedEmailTest` 6 (PR #29), `BuiltinAdminTest` +2 (23: edu-tester D1, and rows made with a dotted capital I or a Kelvin sign) |
| 8 | S3a PostgreSQL | 544 tests: 544 passed, 3,565 assertions, 56 s |
| 9 | S3b | `74\|68\|289\|20\|100\|citext`; 81 s |
| 10–11 | S3c, S3d | schemas match (5,564 lines, 70 CHECKs); migrations logs identical; 04 twice gives one row, `system_admin` |
| 12 | S4 | byte-identical (`app-DNyD-VXB.css`) |
| 13 | S5 | with `HUB_PROXY_SECRET` on both sides: http 60 passed (3 s), browser 21 passed (9 s), with `KILL_URL` through PgBouncer |
| 14 | S6 | 57 guest routes refused; both hosted-database runs refused; `composer audit` 0; `npm audit` 5 dev-only, 0 with `--omit=dev` |
| 15 | S7.1 | 544 passed through the pooler, 44 s; 7.2/7.3/7.5/7.8 as specified |

Pint's baseline list: `app/Routing/BasePathRedirector.php`, `bootstrap/app.php`,
`bootstrap/providers.php`, `database/seeders/FacilitySeeder.php`,
`database/seeders/TeacherFeedbackSeeder.php`, and in `tests/Feature/Platform/`:
`AIAssistServiceTest`, `AcademicRecordsTest`, `AdminPanelTest`, `AnonymizationTest`,
`BasePathTest`, `ComplaintFlowTest`, `RegistrationFlowTest`, `RetaliationReportTest`,
`TeacherEffectivenessTest`, `TwoFactorAuthTest`.

Expected skips: on SQLite only, `DatabaseCompatibilityTest`'s three `..._on_pgsql` email tests
("Exercises the PostgreSQL citext email column") and `NeonReadinessTest`'s
`test_the_app_leaves_no_named_prepared_statement_on_the_server` and
`test_a_transaction_of_several_statements_commits` ("Needs a PostgreSQL server"). None on
PostgreSQL.

## 6. Pass criteria

- **PASS**: rows 1–3, 5–15 all ran and met their gate, every count is at or above section 5's
  final run, R2's checks all hold, and nothing above S4 is open. S7 must have run against a
  PgBouncer bed; S6's audits and Pint are report-only and cannot fail a run by themselves.
- **FAIL**: any gate missed after the fix loop, a count below baseline, a new skip, or an open
  defect above S4.
- **BLOCKED**: a level could not run for a reason outside the code: no PostgreSQL, no PgBouncer
  bed for S7 (say which checks did run), Chromium unavailable for `browser.cjs`, or a hard rule
  of the agent file (a database variable naming anything but the scratch databases). Never
  PASS with a level that did not run.

## 7. Defect handling

| Severity | Meaning | Example from this project |
|---|---|---|
| S1 | data loss, security, or the app does not start | behind Neon's pooler a one-statement `DB::transaction()` was rolled back while `commit()` returned true; the demo System Admin with a published password seeded onto production by following `DEPLOY.md` |
| S2 | a feature broken | every multi-statement transaction (DPDP erasure, the seeder) failed on the pooled endpoint; every complaint-evidence download was a 500, and no evidence could be uploaded through `/edu/` |
| S3 | degraded, with a workaround | the two-factor challenge took unlimited guesses; `channel_binding=require` silently became `prefer` |
| S4 | cosmetic | the committed CSS lacked three classes the views use, so the school-reply border and two widths did not render |

The agent may fix on its own anything inside `edu/` and `database/edu/` that a failing check
traces to: product code, a test proven wrong by the code's documented behaviour, the SQL
scripts, the committed build (rebuilt, never hand-edited), and the docs in `edu/`. Every
product fix gets a test that fails without it. It reports instead of fixing: anything outside
those folders (the hub, CI and deploy workflows, root docs other than `DEPLOY.md` Part 2 and
the Education rows of `TESTING.md`), dependency upgrades flagged by an audit, and any change to
a Neon or Hostinger setting.

Never: skip, delete or weaken a test or an assertion, or move a count to match wrong output;
point anything at a Neon database, a server, or a database that is not in 2.2; leave
`bootstrap/cache/config.php` behind; edit `.env`; commit, push or deploy.

## 8. Report format

Written to `.claude/test-runs/<UTC yyyymmdd-hhmmss>-edu-tester.md` and copied to
`.claude/test-runs/latest-edu-tester.md`:

```markdown
# edu-tester report — <UTC date and time>

- Commit: <short sha> on <branch>; working tree: <clean | N files changed>
- Changed files under test: <list, each mapped to its R3 row>
- Environment: PHP <v> (libpq <v>), PostgreSQL <v> (direct :5432), PgBouncer <v> (:6432,
  transaction, TLS) | none, Node <v>, Chromium <yes|no>; role <name> (superuser: no,
  neon_superuser: yes), suite database <name>, SQL database <name>

## Results

| # | Level | Command | Result | Counts (tests/pass/fail/skip, or as the gate states) | Duration | vs baseline |
|---|---|---|---|---|---|---|
| 1 | S1 | composer validate --no-check-publish | PASS | – | 1 s | = |
| ... one row per row of section 3, S7 split into 7.1–7.7, plus R1 ... |

## Critical regressions

| ID | Result | Evidence |
|---|---|---|
| EDU-CR-01 | PASS | <test name, or the smoke line> |
| ... all 22 ... |

## Defects

| ID | Severity | Area | Symptom | Root cause | Fix | Files | Test added | Status |
|---|---|---|---|---|---|---|---|---|

## Re-test

<what was re-run after the fixes, and the complete final run's counts>

## Open items

<anything not fixed, with a proposed patch or what would unblock it; audit findings>

TESTER: edu-tester
VERDICT: PASS | FAIL | BLOCKED
```

## 9. Known gaps

- **CI runs part of S7, not all of it.** The `edu` job runs the suite a third time through
  PgBouncer in transaction mode with TLS, as a non-superuser owner (S7.1, and `citext` without
  superuser). It does not drop connections (S7.6), route schema commands against an
  unreachable pooler (S7.2–7.3), run the contention check (S7.8) or the smoke run (S5).
- **Channel binding through a pooler is untested.** PgBouncer 1.22 offers no SCRAM channel
  binding, so the local pooled URL omits it; S7.5 proves the parameter reaches libpq and the
  direct endpoint accepts it. Neon's pooler does offer it.
- **No browser test in CI, and none of the Livewire pages beyond `browser.cjs`'s path.**
  Playwright is not a dependency of this app; S5 installs it by hand.
- **Contention is checked small, and there is no load test.** S7.8 is 6 processes × 10
  complaints in one district; the spec envisions 100k+ schools, the seed has 20. In PHPUnit a
  clash can only be simulated in one process.
- **The host is not tested.** Hostinger's PHP (pdo_pgsql, its libpq version, PHP-FPM rather
  than `artisan serve`), the cron entry, mail delivery and the `public_html` wiring are checked
  only by hand (root `TESTING.md` sections 2 and 4).
- **Two-factor codes can be replayed** inside their 30-second window: `verifyKey()` keeps no
  record of the last time-step used. Rate-limited now, not replay-proof.
- **Mobile codes are never sent to a real SMS provider in a test.** The webhook contract
  (`POST {to, text}`, Bearer token) is checked with `Http::fake()`; the provider's own behaviour,
  delivery and DLT template registration are outside this spec. SMS is on hold (4 Nov 2026).
- **Email codes never reach Hostinger's SMTP in a test.** `EmailSignInTest` sends through the
  app's real mailer to a transport it reads; implicit TLS on port 465, Hostinger's
  authentication, sending limits, spam placement and bounces are checked only on a tier, by
  asking for a code for an address someone reads (root `DEPLOY.md` Part 2).
- **The shell and Kesari are the hub's.** `/shared/menu.js` and `/kesari-ui/` are only loaded here
  (S5 checks they arrive and the account menu works); their own rendering, strings and contrast
  are `portal-tester`'s.
- **The client address rests on one shared secret, set by hand on both sides (D-038).** The edu-tester's D5 (any request
  could choose the address the per-address limits count) is closed where `HUB_PROXY_SECRET` is set on the hub and in
  Education. That was checked end to end on 4 Nov 2026 by hand (the edu-tester's probes, not a committed script: a TLS
  stand-in for the host's front end, the real hub, the app on the pooled URL). At the app's own origin a forged
  `X-Forwarded-For`, with no secret, a wrong one or an empty one, is ignored, and the fifth miss locks. Through the hub only
  the address the hub worked out arrives. Behind TLS `request()->secure()` is true and the cookies are `Secure`. What
  remains:
  - Blank in Education (the default) keeps the old rule: a client reaching Education's own hostname still chooses its
    address. The log says so once a day.
  - A value in Education that the hub does not send (unset there, different, or the hub not restarted) puts every
    visitor through the hub on the hub's one address. One person's five wrong passwords then lock that account for
    everyone. `DEPLOY.md` Part 2 gives the order for setting and changing it, and a check by hand.
  - The hub believes `X-Forwarded-For` from any loopback peer (D-026, `portal-tester`'s), so on a tier who can reach the
    hub's port decides the address it sends.
  - The hub passes on a client's own `X-Forwarded-Host`, and Education believes it with the secret, so
    `request()->getHost()` is the client's. Every link the app writes is pinned to `APP_URL`, and neither the app's code, the framework's
    HTTP and session middleware, nor Livewire reads the host.
  - None of it is verified on a tier, and S5's scripts cannot see the address the app counted.
- **Signed URLs fail under `/edu/` unless handled.** Livewire's upload and preview URLs are
  (`App\Routing\BasePathSignedUploadUrl`); the app signs nothing else today, but email
  verification would need the same (`DEPLOY.md` Part 7).
- **Dependency advisories are reported, not fixed** (S6): upgrading the framework is a change of
  its own, reviewed and tested as one. The six PHP advisories of 2026-10 were cleared that way
  (owner-approved update to Laravel 13.38.0), and `symfony/mime`'s CVE-2026-45070 by the update
  to 7.4.22 (4 Nov 2026); `npm audit`'s 5 dev-tooling advisories remain.
- Everything in `TESTING.md`'s "What's not tested" and `ROADMAP.md`'s deferred list.
