# Running everything on your MacBook

How to run all three repositories on one Mac: **ATIP-DEV**, **bkesari** and **bkesari-platform**.

- ATIP is meant to run on your Mac permanently: it is the trading platform.
- The two websites (bkesari and bkesari-platform) normally live on Hostinger. On the Mac you run them locally to try changes before pushing; for the hosted sites see `bkesari/DEPLOYMENT.md` and `bkesari-platform/DEPLOY.md`.

The feature and merge status of all three repos is in
[`FEATURE_STATUS_2026-10-08.xlsx`](FEATURE_STATUS_2026-10-08.xlsx), next to this file.

**Checked on 2026-10-08** from fresh clones of `master` / `main`. The checks ran on Linux, so the
macOS-only parts (Homebrew, LaunchAgents) are as documented but untested.

| App | Result |
|---|---|
| ATIP | 1,321 tests pass (36 skipped) |
| bkesari | migrates, seeds, typechecks and builds; 279/279 tests pass |
| Education | 375/375 tests pass; the SQLite setup below serves pages |
| Portal | starts and serves `/` and `/tasks/` |

## What runs where

Each app gets its own port, so all four can run at the same time.

| App | Folder | Address on the Mac | Database |
|---|---|---|---|
| ATIP dashboard + scheduler | `ATIP-DEV/` | http://localhost:8000 | SQLite file `atip_data/atip.db` |
| Bkesari shop & milk marketplace | `bkesari/` | http://localhost:3000 | PostgreSQL 16 |
| bkesari.com portal (Task Tracker, ATIP viewer) | `bkesari-platform/` | http://localhost:3001 | SQLite file `portal/data/` |
| Education platform (Laravel) | `bkesari-platform/edu/` | http://127.0.0.1:8001 | SQLite file `edu/database/database.sqlite` |

---

## 1. Install the tools (once)

Open **Terminal** and run these one at a time.

```bash
# Apple's command-line tools (git, compilers)
xcode-select --install

# Homebrew, if you don't have it: https://brew.sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Everything the three repos need
brew install git gh python@3.13 node@22 postgresql@16 php composer

# node@22 and postgresql@16 are "keg-only": put them on your PATH
echo 'export PATH="$(brew --prefix)/opt/node@22/bin:$(brew --prefix)/opt/postgresql@16/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile

# Start PostgreSQL now and at every login
brew services start postgresql@16
```

Check the versions:

```bash
python3.13 --version   # 3.13.x  (ATIP needs 3.11+. macOS's own python3 is 3.9, too old)
node --version         # v22.x   (the portal needs 22.13+)
psql --version         # 16.x
php --version          # 8.3 or newer
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

## 3. ATIP (the trading platform)

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

## 4. Bkesari marketplace (Next.js)

```bash
cd ~/Projects/bkesari

createdb dairy_bakery
createdb dairy_bakery_test
```

`main` has no `.env.example` yet (the README mentions one, but it only exists on the unmerged PR #9).
So create `.env` yourself:

```bash
cat > .env <<EOF
DATABASE_URL=postgresql://$(whoami)@localhost:5432/dairy_bakery
TEST_DATABASE_URL=postgresql://$(whoami)@localhost:5432/dairy_bakery_test
AUTH_SECRET=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 32)
PAN_ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF
```

What each value does:
- Homebrew's PostgreSQL logs you in as your Mac user with no password, which is why the database URLs use `$(whoami)`.
- With no Cashfree keys the app runs in mock payment mode, which is right for local use.
- With no Google OAuth keys, `/signin` shows an email-only form in development.

```bash
npm ci
npm run db:migrate                                   # schema into dairy_bakery
npm run db:seed                                      # 5 demo shops, 18 categories, 40 products
npm run dev                                          # http://localhost:3000
```

Sign in at http://localhost:3000/signin with any email.
- To make yourself admin, add `BOOTSTRAP_ADMIN_EMAILS=you@example.com` to `.env` **before** you first sign in with that address.
- To run the daily subscription orders by hand:

```bash
source .env
curl -X POST http://localhost:3000/api/cron/daily-orders -H "Authorization: Bearer $CRON_SECRET"
```

**Tests.** The test database needs the schema too. The README doesn't mention this, and without it every integration test fails with `relation ... does not exist`:

```bash
DATABASE_URL=postgresql://$(whoami)@localhost:5432/dairy_bakery_test npm run db:migrate
npm test                                             # 279 tests
```

Production-style run: `npm run build && npm start`.

> `npm run dev` may re-add a block to `AGENTS.md`. That's expected, and it's harmless.

---

## 5. bkesari.com portal (Node / Express)

```bash
cd ~/Projects/bkesari-platform
npm install
PORT=3001 npm start                                  # http://localhost:3001
```

It uses SQLite in `portal/data/` by itself, so there's no database to set up. Logins are environment variables:

```bash
PORT=3001 TRACKER_USER=me TRACKER_PASSWORD=secret \
  ATIP_USER=me ATIP_PASSWORD=secret ATIP_PUBLISH_TOKEN=local-token npm start
```

- Without `TRACKER_*`, `/tasks/` is open.
- Without `ATIP_*`, `/atip/` refuses to load.

To see ATIP's read-only dashboard here, point ATIP's `atip_data/publish.json` at
`http://localhost:3001/atip/api/snapshot` with the token `local-token`, then run
`./publish_snapshot.sh` in `ATIP-DEV`.

---

## 6. Education platform (Laravel)

```bash
cd ~/Projects/bkesari-platform/edu
composer install
cp .env.example .env
php artisan key:generate
open -e .env
```

`.env.example` is set up for Hostinger. For the Mac, change these lines in `.env`:

```
APP_ENV=local
APP_DEBUG=true
APP_URL=http://127.0.0.1:8001
DB_CONNECTION=sqlite
```

Then delete the `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD` lines. An empty `DB_DATABASE=` would stop Laravel using its default SQLite file.

If `migrate` asks whether to create the SQLite database, answer **yes**.

```bash
php artisan migrate:fresh --seed                     # ~20 schools, ~275 synthetic users
npm install && npm run build                         # CSS / JS
php artisan serve --port=8001                        # http://127.0.0.1:8001
```

Demo logins (all use the password `Password123!`) are in `edu/TEST_ACCOUNTS.md`, for example `admin@test.agtci.com`.
Tests: `php artisan test`.

---

## 7. Every day

| To | Run |
|---|---|
| Start ATIP by hand | `cd ~/Projects/ATIP-DEV && ./start_atip.sh` (not needed if the LaunchAgent is installed) |
| Stop the ATIP agent | `launchctl bootout gui/$UID/com.atip.platform` |
| Start the marketplace | `cd ~/Projects/bkesari && npm run dev` |
| Start the portal | `cd ~/Projects/bkesari-platform && PORT=3001 npm start` |
| Start Education | `cd ~/Projects/bkesari-platform/edu && php artisan serve --port=8001` |
| Pull the latest code | `git pull` in each folder. Then re-run `pip install -r requirements.txt` (ATIP) or `npm ci` / `composer install` if dependencies changed, and the migrations |
| Check Git vs GitHub | `~/Projects/bkesari-platform/tools/check_local_git.sh` |
| Something already uses a port | `lsof -i :8000`, then stop that process, or pick another port |

## 8. Not merged yet

These open pull requests are **not** in the code you get from `main` / `master`:

| PR | What it adds |
|---|---|
| ATIP-DEV#8 (open) | MySQL runtime fixes. Only needed if you run ATIP on MySQL; SQLite is the default. |
| bkesari#9 (draft) | MySQL port, a `/milk` base path, a dev deploy workflow, and `.env.example`. |
| bkesari#10 (draft) | A README notice about GoKesari. |
| bkesari-platform#1 (draft) | dev tier, ATIP at `/ATIP/`, drops the stale `atip/` copy, edu Mac launcher, and fixed Ladwani SQL. |
| bkesari-platform#2 (draft) | Shared menu, new pages, dev deploys and CI, and app tabs through the hub. |

Note: the `atip/` folder inside `bkesari-platform` is an old copy of ATIP from 2026-09-10. Always run ATIP from the `ATIP-DEV` repo.
