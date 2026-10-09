> **For the bkesari.com tiers (devedu / testedu / edu.bkesari.com), `../DEPLOY.md`
> part 2 is authoritative.** This file documents the original single-site deploy to
> `edutest.agtci.com`, which is served by the separate (now superseded) `edu`
> repository. The steps still read correctly — substitute the domain and remember
> that the app lives in this repo's `edu/` folder.

# Deployment (Hostinger)

**Live target:** `https://edutest.agtci.com` (domain root — not a subpath)
**Hosting account:** shared Hostinger hosting, no Node.js available server-side, PHP 8.3 + Composer + git available via SSH.
**Database:** PostgreSQL (13+, 16 recommended — CI tests against 16). MySQL is no longer supported.

## Database: PostgreSQL — read this first

> **Hostinger shared/cloud web hosting does not provide PostgreSQL** — hPanel's database tools are MySQL-only. The PHP app can stay on Hostinger, but the database has to live somewhere else:
>
> - **a managed PostgreSQL service** (any provider that gives you a host, port, database, user and password, with TLS), or
> - **a VPS** (Hostinger VPS or elsewhere) where you install and run PostgreSQL yourself — in that case you also own its updates, backups and firewalling, and could move the PHP app onto the same VPS.

Before switching production over, verify on the PHP host (over SSH), and don't proceed until all three are true:

1. **`pdo_pgsql` is enabled for the PHP version that serves the site** — `php -m | grep -i pdo_pgsql`. The CLI and the web PHP can be configured separately; also check from the web side (e.g. a temporary `phpinfo()` page you delete afterwards). Without `pdo_pgsql` the app cannot connect at all.
2. **The host can reach the database over the network** — shared hosting may restrict outbound connections. Test with `php -r 'new PDO("pgsql:host=<DB_HOST>;port=<DB_PORT>;dbname=<DB_DATABASE>;sslmode=require", "<DB_USERNAME>", "<DB_PASSWORD>"); echo "ok\n";'`. If your provider restricts incoming connections by IP, allow the Hostinger server's outbound IP.
3. **The database user can `CREATE EXTENSION citext`** (one migration needs it; `citext` is a trusted extension, so the database owner normally can). If your provider manages extensions separately, enable `citext` there first.

These checks have not been run against the live account — they're what to confirm, not a record of what's been confirmed.

The `.env` database block for production:

```
DB_CONNECTION=pgsql
DB_HOST=<managed postgres host>
DB_PORT=5432
DB_DATABASE=<database>
DB_USERNAME=<user>
DB_PASSWORD=<password>
DB_SSLMODE=require
```

Use `DB_SSLMODE=require` (or `verify-full` if you install the provider's CA certificate) whenever the database is reached over the network. Some providers hand out a single connection URL instead; it can go in `DB_URL` (`postgresql://user:pass@host:5432/db?sslmode=require`), which overrides the individual `DB_*` values. If the provider offers a connection pooler (e.g. PgBouncer in transaction mode), prefer the direct/session connection for `php artisan migrate`.

**Moving off the old MySQL database:** there is no automated data migration in this repo. If the existing `edutest` database holds only seeded synthetic data (check before discarding it), the simplest path is to run the migrations + seeders fresh on the new PostgreSQL database (step 5 below). If real data ever needs to be carried over, take a `mysqldump` of the old database first and plan the copy separately (e.g. evaluate a MySQL→PostgreSQL tool such as pgloader against a staging copy, then reset each table's id sequence) — test that on staging, never directly on production.

## Why this layout

Standard shared-hosting Laravel pattern: the full app lives **outside** the web-servable directory, and only `public/`'s contents (plus an `index.php` with adjusted paths) live in `public_html`. This keeps `.env`, `app/`, `vendor/`, etc. unreachable over HTTP without needing to change the account's document root.

```
~/domains/edutest.agtci.com/
  ├── edu-app/          <- full Laravel app (git clone lives here), NOT web-servable
  │     ├── app/ database/ routes/ vendor/ .env  ...
  │     └── public/      <- source of truth for web assets
  └── public_html/       <- actual web root; contents copied from edu-app/public
        ├── index.php     (paths adjusted to point at ../edu-app/...)
        ├── build/        (compiled Vite assets — committed to git, no Node needed here)
        └── storage -> ../edu-app/storage/app/public   (symlink)
```

## One-time initial deploy

```bash
# 1. SSH in
ssh -p 65002 u879099820@93.127.208.167

# 2. Clone the app (public repo, no auth needed)
cd ~/domains/edutest.agtci.com
git clone https://github.com/sanjaymorankar-debug/edu.git edu-app
cd edu-app

# 3. Install PHP dependencies (production only)
composer install --no-dev --optimize-autoloader

# 4. Configure environment
cp .env.example .env
nano .env   # fill in DB_HOST/DB_PORT/DB_DATABASE/DB_USERNAME/DB_PASSWORD for the PostgreSQL database,
            # set DB_SSLMODE=require, confirm APP_URL=https://edutest.agtci.com
php artisan key:generate --force

# 5. Migrate + seed (first time only — NEVER migrate:fresh after this)
php artisan migrate --force
php artisan db:seed --force

# 6. Wire up public_html to serve the app
rm -f ~/domains/edutest.agtci.com/public_html/default.php
cp -r public/. ~/domains/edutest.agtci.com/public_html/
ln -s ../edu-app/storage/app/public ~/domains/edutest.agtci.com/public_html/storage

# 7. Fix public_html/index.php to point one level up
# Change:
#   require __DIR__.'/../vendor/autoload.php';
#   require_once __DIR__.'/../bootstrap/app.php';
# To:
#   require __DIR__.'/../edu-app/vendor/autoload.php';
#   require_once __DIR__.'/../edu-app/bootstrap/app.php';

# 8. Cache for production
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

## Redeploying after changes

```bash
cd ~/domains/edutest.agtci.com/edu-app
git pull origin main
composer install --no-dev --optimize-autoloader
php artisan migrate --force
cp -r public/. ~/domains/edutest.agtci.com/public_html/
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

If frontend assets changed, rebuild them **locally first** (`npm run build`) and commit `public/build/` before pulling on the server — there's no Node.js on Hostinger to build them there.

## Rollback

```bash
cd ~/domains/edutest.agtci.com/edu-app
git log --oneline -5        # find the last-good commit
git checkout <commit-hash>
composer install --no-dev --optimize-autoloader
cp -r public/. ~/domains/edutest.agtci.com/public_html/
php artisan config:cache
```

Database migrations are additive in this build (no destructive migrations shipped) — a code rollback doesn't require a matching DB rollback unless a specific migration is known to be destructive. Always back up before any migration:

```bash
pg_dump --format=custom --no-owner -h <DB_HOST> -p <DB_PORT> -U <DB_USERNAME> -d <DB_DATABASE> -f backup-$(date +%Y%m%d-%H%M%S).dump
```

`pg_dump` must be the same major version as the server or newer; if the Hostinger shell doesn't have a suitable `pg_dump`, run it from another machine or rely on your provider's snapshots/backups (and know how to restore from them). See [`DATABASE.md`](DATABASE.md#backups) for restore.

## Mail delivery

Production `.env` uses `MAIL_MAILER=sendmail` (Hostinger's local relay — no external SMTP credentials needed) with `MAIL_FROM_ADDRESS=noreply@edutest.agtci.com`. This was chosen over a third-party SMTP provider specifically to avoid managing external credentials, at the cost of no delivery guarantee — shared-hosting sendmail relays are commonly rate-limited or land in spam. Every send is wrapped in try/catch (`App\Livewire\Concerns\SendsMailSafely`), so a mail failure never breaks registration/invite flows, and all three mail-sending flows (school-staff invites, school-to-member invitations, parent-registered child accounts) still show the credential/invite-link on screen as the reliable fallback. If deliverability proves too unreliable in practice, revisit with a transactional provider — see `ROADMAP.md`.

## Scheduled analytics recalculation

`php artisan analytics:recalculate` is scheduled hourly in `routes/console.php`, but Laravel's scheduler only fires when something calls `php artisan schedule:run` — on a real server that means an actual OS cron entry, once per minute:

```bash
* * * * * cd ~/domains/edutest.agtci.com/edu-app && php artisan schedule:run >> /dev/null 2>&1
```

Register this via `crontab -e` over SSH (Hostinger's shared-hosting `disable_functions` doesn't block `crontab` itself, only the process-spawning PHP functions listed below). Confirm it's registered with `crontab -l`. If it can't be confirmed working, the platform still functions correctly without it: the National/Researcher dashboards compute-and-save a snapshot on the spot if none exists, and the National/State dashboards both have a manual "Recalculate now" button.

## Known Hostinger PHP restrictions

This account's PHP has `disable_functions` including `proc_open`, `symlink`, `link`, `exec`, `shell_exec`. Consequences:

- `php artisan storage:link` **fails silently-ish** (uses `symlink()`). Create the symlink from the shell instead: `ln -sfn ../edu-app/storage/app/public public_html/storage`.
- Some Composer post-install scripts that shell out (observed once with `laravel/pail`'s discovery step) can throw a `proc_open` error mid-`composer install`. It's usually non-fatal — verify with `php artisan --version` and check `bootstrap/cache/packages.php` exists; re-run `php artisan package:discover --ansi` directly if needed.
- Don't rely on `Process`/`Symfony\Process`-based artisan features (e.g. `artisan serve`, anything that shells out) in production — they won't work here. The app runs through Apache/PHP-FPM normally, which doesn't need any of this.

## Safety notes

- `edu-app/` is outside `public_html`, so `.env` and `storage/logs` are never web-reachable.
- Give the app its own PostgreSQL role that owns only this database — not a provider superuser/admin role — and keep TLS on (`DB_SSLMODE=require`).
- `APP_DEBUG=false` in production `.env` — never flip this on live, it would leak stack traces (including DB credentials in error contexts) to any visitor.
- The `edutest.agtci.com` subdomain was newly created for this project and had no prior content beyond Hostinger's default placeholder page (`public_html/default.php`) — no existing site was overwritten.
