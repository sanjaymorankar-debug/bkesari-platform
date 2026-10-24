# Running everything on your MacBook

How to run all three repositories on one Mac: **ATIP-DEV**, **bkesari** and **bkesari-platform**.

- ATIP is meant to run on your Mac permanently: it is the trading platform.
- The two websites (bkesari and bkesari-platform) normally live on Hostinger. On the Mac you run them locally to try changes before pushing; for the hosted sites see `bkesari/DEPLOYMENT.md` and `bkesari-platform/DEPLOY.md`.

The feature and merge status of all three repos is in
[`FEATURE_STATUS_2026-10-08.xlsx`](FEATURE_STATUS_2026-10-08.xlsx), next to this file. It is a
snapshot from 2026-10-08, before the move to PostgreSQL, so where it says MySQL (the portal's
database adapter, `setup_local_mysql.sh`, the test results) read PostgreSQL and this guide.

**The databases are PostgreSQL now** (from 2026-10-09; MySQL is no longer used). **Checked on
2026-10-09** for bkesari-platform against a local PostgreSQL 16. The checks ran on Linux, so the
macOS-only parts (Homebrew, LaunchAgents) are as documented but untested.

| App | Result |
|---|---|
| ATIP | not re-checked in this change (its PostgreSQL move is in the ATIP-DEV repo); on 2026-10-08, 1,336 tests passed (42 skipped) |
| bkesari | not re-checked in this change (its PostgreSQL move is in the bkesari repo); on 2026-10-08, against MySQL, 284/284 tests passed |
| Education | `tools/setup_local_postgres.sh` migrates and seeds it; 392/392 tests pass on PostgreSQL; serves pages and logs in from PostgreSQL |
| Portal | 53 tests (7 of them against PostgreSQL) + 32 deploy-guard checks pass; the Task Tracker saves to PostgreSQL |

The portal was checked again on 2026-10-24, made ready for Neon: 80 tests (15 of them against
PostgreSQL) and the 32 deploy-guard checks pass, and so do the smoke and Neon-parity runs. The
current counts and how to run them are in `TEST_SPEC.md`.

## What runs where

Each app gets its own port, so all four can run at the same time.

| App | Folder | Address on the Mac | Database |
|---|---|---|---|
| ATIP dashboard + scheduler | `ATIP-DEV/` | http://localhost:8000 | SQLite file `atip_data/atip.db` |
| Bkesari shop & milk marketplace | `bkesari/` | http://localhost:3000 | PostgreSQL `bk_milk` (tests: `bk_milk_test`) |
| bkesari.com portal (Task Tracker, ATIP viewer) | `bkesari-platform/` | http://localhost:3001 | PostgreSQL `bk_portal` (tests: `bk_portal_test`) |
| Education platform (Laravel) | `bkesari-platform/edu/` | http://127.0.0.1:8001 | PostgreSQL `bk_edu` (tests: in memory, or `bk_edu_test`) |

The script in step 3 also creates `bk_ladwani` (LadWani's tables, ready for when that app runs here)
and `bk_atip` (empty, for if ATIP ever moves off its SQLite file).

---

## 1. Install the tools (once)

Open **Terminal** and run these one at a time.

```bash
# Apple's command-line tools (git, compilers)
xcode-select --install

# Homebrew, if you don't have it: https://brew.sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Everything the three repos need, PostgreSQL included
brew install git gh python@3.13 node@22 php composer postgresql@16

# node@22 and postgresql@16 are "keg-only": put their commands on the PATH
echo 'export PATH="$(brew --prefix)/opt/node@22/bin:$(brew --prefix)/opt/postgresql@16/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile

# Start PostgreSQL now and at every login
brew services start postgresql@16
```

Homebrew's PostgreSQL listens on 127.0.0.1:5432 and makes your macOS user its administrator,
with no password, so nothing else needs setting up. If you had MySQL from mysql.com for these
sites, nothing uses it any more; stop it in System Settings → **MySQL** if you like.

Check the versions:

```bash
python3.13 --version   # 3.13.x  (ATIP needs 3.11+. macOS's own python3 is 3.9, too old)
node --version         # v22.x   (the portal needs 20+; CI uses 22)
psql --version         # 16.x (from Homebrew)
php --version          # 8.3 or newer
php -m | grep pdo_pgsql   # Education needs it; Homebrew's PHP normally has it
```

## 2. Get the code

The repositories are private, so log in to GitHub once:

```bash
gh auth login          # choose GitHub.com, HTTPS, and log in with the browser
```

Then clone all three into one folder. Keep it **outside `~/Documents`**: macOS privacy rules and iCloud
syncing interfere with ATIP's background agents and its database (see ATIP's README, "Mac checks").

```bash
mkdir -p ~/Projects && cd ~/Projects
gh repo clone sanjaymorankar-debug/ATIP-DEV
gh repo clone sanjaymorankar-debug/bkesari
gh repo clone sanjaymorankar-debug/bkesari-platform
```

If you already have clones, update them instead:

```bash
cd ~/Projects/ATIP-DEV        && git checkout master && git pull
cd ~/Projects/bkesari         && git checkout main   && git pull
cd ~/Projects/bkesari-platform && git checkout main  && git pull
```

### Is my Mac's Git in step with GitHub?

```bash
~/Projects/bkesari-platform/tools/check_local_git.sh --csv ~/Desktop/local_git_status.csv
```

For each repo it lists:
- uncommitted files;
- branches with commits you have **not pushed** or not pulled;
- branches that exist **only on your Mac**;
- GitHub branches that are not merged.

The CSV opens in Excel. Run it before and after you work. Anything marked `UNPUSHED` or `LOCAL ONLY`
exists only on this Mac.

---

## 3. Local PostgreSQL databases (once)

One script creates a database and a login for each site in the PostgreSQL on your Mac, and writes
those logins into each app's `.env`:

```bash
cd ~/Projects/bkesari-platform
tools/setup_local_postgres.sh
```

It logs in to PostgreSQL as you (Homebrew's default), so it asks for nothing. Then it:

1. creates `bk_milk`, `bk_milk_test`, `bk_portal`, `bk_portal_test`, `bk_edu`, `bk_edu_test`,
   `bk_ladwani` and `bk_atip`, each owned by its own login role. No other role may connect to a
   site's database;
2. writes the logins into `bkesari/.env`, `bkesari-platform/.env` and `bkesari-platform/edu/.env`.
   An existing `.env` is backed up to `~/.bkesari_env_backups/` first, and only its database lines
   change;
3. creates the tables (installing each app's packages the first time) and loads demo data into a
   database that was empty.

The passwords it generates are saved in `~/.bkesari_local_postgres.env`, which only your user can read.
Running it again is safe: it reuses those passwords and never re-seeds a database that has data.
`--no-migrate` stops after step 2.

ATIP is the exception. It keeps its SQLite file `atip_data/atip.db`, because ATIP's PostgreSQL
runtime is opt-in in its own config (see `ATIP-DEV/docs/POSTGRESQL_MIGRATION.md`). The script
creates `bk_atip` but never changes ATIP's settings.

Using a PostgreSQL that is not Homebrew's (Postgres.app, a password-protected server, another
port)? Set `PG_ADMIN_USER`, `PG_ADMIN_PASSWORD`, `PG_HOST` or `PG_PORT` — `--help` lists them.

---

## 4. ATIP (the trading platform)

Full details: `ATIP-DEV/README.md`, "Quick Setup (macOS)". The short version:

```bash
cd ~/Projects/ATIP-DEV

# Python environment from Homebrew's Python (not macOS's 3.9)
"$(brew --prefix)/bin/python3.13" -m venv .venv
.venv/bin/pip install -r requirements.txt

# Your API keys: at minimum dhan_client_id and dhan_access_token
mkdir -p atip_data
cp config_template.json atip_data/config.json
open -e atip_data/config.json

# Optional: Claude news analysis. Put the key in .env, NOT ~/.zshrc (the auto-start agent never reads ~/.zshrc)
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env

# Create the database and download Dhan's security list
.venv/bin/python main.py --init
.venv/bin/python main.py --dhan-securities
.venv/bin/python main.py --dhan-history        # first data load; skip if you copy atip_data/ from Windows

# Start it (opens http://localhost:8000)
./start_atip.sh
```

**Moving from the Windows PC?**
1. Stop ATIP on Windows and turn off its auto-start first, so the two machines don't both trade, alert and publish.
2. Copy `D:\Projects\ATIP\atip_data\` into `~/Projects/ATIP-DEV/atip_data/`, including `atip.db-wal` / `atip.db-shm` if present.
3. Then run `--init`. It only adds what's missing.

**Run it automatically at login** (and restart it if it crashes):

```bash
deploy/launchd/install.sh            # ATIP + 5-minute snapshot upload + daily 06:30 Dhan token refresh
launchctl list | grep com.atip       # 0 in the 2nd column = running cleanly
tail -f atip_data/launchd.err        # ATIP's output
```

Install the snapshot agent only after `atip_data/publish.json` exists (it holds the bkesari.com upload tokens, see `bkesari-platform/DEPLOY.md` part 3).
To get an expired Dhan token back without you, the token agent needs `dhan_pin` and `dhan_totp_secret` in `config.json`.

**Keep the Mac awake on trading days.** Nothing runs while it sleeps.
- Go to System Settings → Battery → Options and turn on "Prevent automatic sleeping on power adapter when the display is off".
- Keep it plugged in.
- Closing the lid still sleeps it unless an external display is connected.

**Releases with rollback** (optional, once you are running from a tagged release):
`deploy/deploy_release.sh` and `deploy/rollback_release.sh` (see `docs/W39B_DEPLOY_RUNBOOK.md`).

**Docker instead** (optional): `cp deploy/atip.env.example deploy/atip.env`, fill it in, then `docker compose up -d`.

---

## 5. Bkesari marketplace (Next.js)

Step 3 already set this up: `.env`, both databases, the tables and the demo shops.

```bash
cd ~/Projects/bkesari
npm run dev                                          # http://localhost:3000
```

Sign in at http://localhost:3000/signin with any email: the email-only form exists in development.
- To make yourself admin, add `BOOTSTRAP_ADMIN_EMAILS=you@example.com` to `.env` **before** you first sign in with that address.
- To run the daily subscription orders by hand:

```bash
source .env
curl -X POST http://localhost:3000/api/cron/daily-orders -H "Authorization: Bearer $CRON_SECRET"
```

**Tests:** `npm test` (on `bk_milk_test`).

Production-style run: `npm run build && npm start`.

> `npm run dev` may re-add a block to `AGENTS.md`. That's expected, and it's harmless.

---

## 6. bkesari.com portal (Node / Express)

```bash
cd ~/Projects/bkesari-platform
npm install
node --env-file=.env portal/server.js                # http://localhost:3001
```

`--env-file=.env` is what gives it its database: plain `npm start` reads no file, and stops with
"No database configured". The `.env` from step 3 holds the PostgreSQL login, port 3001, and
generated logins for the Task Tracker (`TRACKER_USER` / `TRACKER_PASSWORD`) and the ATIP viewer
(`ATIP_USER` / `ATIP_PASSWORD`). The portal creates any missing tables when it starts.

Tests: `node --env-file=.env --test tests/*.test.js` (the Task Tracker ones use `bk_portal_test`,
named by `TEST_DATABASE_URL` in that `.env`; plain `npm test` skips them), or `npm run test:pg`
once that line is copied into `.env.test`. The whole procedure is `TEST_SPEC.md`.

To see ATIP's read-only dashboard here:
1. Point ATIP's `atip_data/publish.json` at `http://localhost:3001/ATIP/api/snapshot`, using the
   `ATIP_PUBLISH_TOKEN` from this `.env`.
2. Run `./publish_snapshot.sh` in `ATIP-DEV`.

---

## 7. Education platform (Laravel)

Step 3 already wrote `edu/.env` (local URL, `bk_edu` login, app key), ran the migrations, and
seeded ~20 schools and ~275 synthetic users. What is left is the CSS and JavaScript:

```bash
cd ~/Projects/bkesari-platform/edu
npm install && npm run build                         # CSS / JS
php artisan serve --port=8001                        # http://127.0.0.1:8001
```

Demo logins (all use the password `Password123!`) are in `edu/TEST_ACCOUNTS.md`, for example `admin@test.agtci.com`.
Tests: `php artisan test`. These use an in-memory SQLite database, not `bk_edu`. To run them on
PostgreSQL as CI does, give them `bk_edu_test` (password in `~/.bkesari_local_postgres.env`, as
`BK_EDU_PASS`):

```bash
DB_CONNECTION=pgsql DB_DATABASE=bk_edu_test DB_USERNAME=bk_edu DB_PASSWORD=... php artisan test
```

---

## 8. Every day

| To | Run |
|---|---|
| Start ATIP by hand | `cd ~/Projects/ATIP-DEV && ./start_atip.sh` (not needed if the LaunchAgent is installed) |
| Stop the ATIP agent | `launchctl bootout gui/$UID/com.atip.platform` |
| Start the marketplace | `cd ~/Projects/bkesari && npm run dev` |
| Start the portal | `cd ~/Projects/bkesari-platform && node --env-file=.env portal/server.js` |
| Start Education | `cd ~/Projects/bkesari-platform/edu && php artisan serve --port=8001` |
| Pull the latest code | `git pull` in each folder. If dependencies changed, run `npm ci`, `composer install` or `pip install -r requirements.txt`. Then run `tools/setup_local_postgres.sh` again to apply new migrations |
| Check Git vs GitHub | `~/Projects/bkesari-platform/tools/check_local_git.sh` |
| Something already uses a port | `lsof -i :8000`, then stop that process, or pick another port |
| Look inside a database | `psql -h 127.0.0.1 -U bk_edu bk_edu` (password in `~/.bkesari_local_postgres.env`), or as yourself with no password: `psql bk_edu`. Any PostgreSQL GUI works too (pgAdmin, Postico, TablePlus) |

## 9. What changed on 2026-10-08

Every pull request that was open on 2026-10-08 is now merged:

| PR | What it added |
|---|---|
| ATIP-DEV#8 | MySQL runtime fixes for ATIP. SQLite stays the default. |
| bkesari#9 | The marketplace moved from PostgreSQL to **MySQL**, is served under `/milk` on bkesari.com, and gained a dev-only deploy workflow and `.env.example`. |
| bkesari#10 | A README notice that this repo and GoKesari have diverged. |
| bkesari-platform#1 | The dev tier, ATIP at `/ATIP/`, the stale `atip/` copy removed, and the Ladwani SQL fixed. |
| bkesari-platform#2 | A shared menu, Global Warming and Driving Simulator pages, dev deploys and CI, and the app tabs (`/milk/`, `/edu/`, `/ladwani/`) served through the hub. |

Merged on 2026-10-09:

| PR | What it fixed |
|---|---|
| bkesari#12 | `/admin` answered 500 on MySQL; `db:migrate` now reads the `DB_*` settings; the README describes MySQL. |
| bkesari#13 | 11 tests failed when `.env` came from `.env.example`. |

On 2026-10-09 the plan changed to **PostgreSQL for every database**. In bkesari-platform: the
portal uses `pg` with `portal/sql/schema.sql`; Education's default connection is `pgsql`; every
script under `database/` and `edu/database/sql/` is PostgreSQL; `tools/setup_local_mysql.sh` became
`tools/setup_local_postgres.sh`. bkesari, Ladwani and ATIP-DEV make the same move in their own
repositories. Hosted tiers need a PostgreSQL service, since Hostinger's web hosting has none
(`DEPLOY.md`, *Databases*).

Always run ATIP from the `ATIP-DEV` repo. `bkesari-platform/atip/` now only points there.
