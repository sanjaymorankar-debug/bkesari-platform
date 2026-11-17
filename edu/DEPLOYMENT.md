> **For the bkesari.com tiers (devedu / testedu / edu.bkesari.com), `../DEPLOY.md`
> part 2 is authoritative.** This file documents the original single-site deploy to
> `edutest.agtci.com`, which is served by the separate (now superseded) `edu`
> repository. The steps still read correctly — substitute the domain and remember
> that the app lives in this repo's `edu/` folder.

## The database on Neon (every bkesari.com tier)

Each tier's database is PostgreSQL on Neon ([`../docs/NEON.md`](../docs/NEON.md) has the whole
layout and the script that creates it). On every Neon branch this app has a database **`bk_edu`**,
owned by the login **`bk_edu_app`**:

| Tier | Neon branch |
|---|---|
| dev (`/edu/` on dev.bkesari.com, devedu.bkesari.com) | `dev` |
| test (`/edu/` on test.bkesari.com, testedu.bkesari.com) | `test` |
| production (`/edu/` on bkesari.com, edu.bkesari.com) | `production` |

The server's `.env` takes **that tier's** two connection strings and no other database lines.
Neon console → the tier's branch → **Connect** → database `bk_edu`, role `bk_edu_app`; copy each string
whole, `?sslmode=require&channel_binding=require` included:

```
DB_CONNECTION=pgsql
DB_URL=<the string with "Connection pooling" ON  (host has -pooler in it)>
DB_URL_UNPOOLED=<the same with "Connection pooling" OFF>
```

What the app does with them (`config/database.php`, `App\Providers\DatabaseServiceProvider`):

- **Web requests use `DB_URL`**, the pooled endpoint (PgBouncer in transaction mode). Two
  settings make that safe, and `tests/Feature/Platform/NeonReadinessTest.php` holds both in
  place: queries are sent as unnamed statements, because PHP's way of freeing a named one
  aborted every transaction behind the pooler (and a transaction of one statement was rolled
  back while PHP reported it committed); and no session `SET` is sent on connect,
  because a pooler does not carry one over to the next query.
- **`php artisan migrate`, `db:seed`, `db:wipe` and the other `migrate:*` commands use
  `DB_URL_UNPOOLED`** on their own; `--database=pgsql` overrides that, and the connection is
  also there by name (`pgsql_unpooled`) for anything else that needs a session of its own.
- **`config:cache` holds both strings.** The deploy runs `php artisan optimize`, which caches
  them, so after editing `.env` on a server run `php artisan optimize` again before anything else.
- **`channel_binding=require` is honoured**, which needs the site's PHP to be built against
  libpq 13 or newer; Neon itself needs 14 or newer (for SNI). Check with
  `php -i | grep -i 'libpq'` over SSH.
- **An idle Neon compute is suspended.** The first request after that is slower while it
  wakes. PHP's PostgreSQL driver waits up to 30 seconds for a connection (measured; the app
  does not shorten it), which is well past a cold start. PHP opens a new connection for every
  request, so a connection Neon drops while idle needs no handling either.
- **`citext`** is created by a migration as `bk_edu_app`. Neon makes every role it creates a
  member of `neon_superuser`, which is enough; no superuser is needed.

Order on a fresh tier (`../DEPLOY.md` Part 2 has the commands): `composer install --no-dev
--optimize-autoloader`, fill in `.env`, `php artisan key:generate --force`,
`php artisan migrate --force`, then the starting data: `php artisan db:seed --force` on **dev and
test only** (it creates the demo accounts in `TEST_ACCOUNTS.md`, which all share one published
password, a System Admin among them), and on production `../database/edu/02_edu_reference_data.sql`
and `04_edu_first_admin.sql` instead. The hand-run alternative to `migrate` is
`../database/edu/*.sql`, run with `psql "$DB_URL_UNPOOLED"` in order.

Never point a test run at any of these databases: `php artisan test` drops every table in the
database it is given.

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

Use `DB_SSLMODE=require` (or `verify-full` if you install the provider's CA certificate) whenever the database is reached over the network. Some providers hand out a single connection URL instead; it can go in `DB_URL` (`postgresql://user:pass@host:5432/db?sslmode=require`), which overrides the individual `DB_*` values. If the provider offers a connection pooler (e.g. PgBouncer in transaction mode), put the pooled URL in `DB_URL` and the direct one in `DB_URL_UNPOOLED`, as on Neon above: the schema commands then use the direct one by themselves.

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

Every bkesari.com tier sends mail through **Hostinger's SMTP** with Laravel's own `smtp` mailer (since 4 Nov 2026; before that, `MAIL_MAILER=sendmail`, Hostinger's local relay). The settings are the same mailbox settings the other bkesari apps use, under Laravel's names (`.env.example`, and the root `DEPLOY.md` Part 2):

```
MAIL_MAILER=smtp
MAIL_SCHEME=smtps                      # port 465 is implicit TLS
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_USERNAME=code@agtci.com           # the whole mailbox address
MAIL_PASSWORD=<the mailbox password, from hPanel -> Emails>
MAIL_FROM_ADDRESS="code@agtci.com"         # the same mailbox
MAIL_FROM_NAME="Education · bkesari"
MAIL_TIMEOUT=15                        # seconds; codes are sent while the person waits
```

Mail now carries the one-time sign-in codes (below), so it is no longer only a convenience. Invitations and child accounts still go through `App\Livewire\Concerns\SendsMailSafely` (a failure is logged and the flow carries on, with the credential or invite link on screen as before). A sign-in code is sent at once, not queued: if the mail server refuses it, the person is told and the code is thrown away. Spam placement and bounces are still unmeasured — see `ROADMAP.md`.

## Accounts, sign-in and the shared look (since 3 Nov 2026)

Education keeps its own accounts and its own sign-in. The old hub token is gone (`HUB_JWKS` and `HUB_JWKS_URL`; delete them from a server's `.env`); since D-039 (17 Nov 2026) the hub instead vouches for the person in signed identity headers, below. Check:

- **Session cookie.** `edu_sid`, HttpOnly, SameSite=Lax, sent only to the path of `APP_URL` (`/edu` behind bkesari.com) and Secure when `APP_URL` is https (`config/session.php`). Leave `SESSION_COOKIE`, `SESSION_PATH` and `SESSION_SECURE_COOKIE` out of `.env` so they follow `APP_URL`; an old `SESSION_PATH=/` line widens the cookie to every project on the domain. Changing the cookie name signs everyone out once.
- **Sign-in lockout.** Five wrong passwords for one email from one address lock sign-in for 15 minutes (`App\Livewire\Forms\LoginForm`). The counter lives in the cache store (`CACHE_STORE=database` on every tier).
- **Sign-in codes by email.** "Email me a code" sits next to the password: an account with that address gets a six-digit code by email, in the page's language (`App\Services\EmailSignIn`, `App\Mail\SignInCodeMail`). Codes are stored hashed in the cache, valid 10 minutes, used once, thrown away after 5 wrong tries, 3 per email address per 10 minutes and 10 per IP address per hour; an unknown address gets the same answer and no mail; an account with two-factor still has to pass it. Every account has an email (the column is required), but not every address is an inbox someone reads: a child's account a parent set up with a made-up address, or the demo accounts on dev and test (`@test.agtci.com`, `TEST_ACCOUNTS.md`). Those can sign in only with a password while SMS is on hold.
- **Mobile sign-in: on hold** (owner's decision, 4 Nov 2026). The sign-in screen offers a code by text message only when `SMS_WEBHOOK_URL` is set; leave it and `SMS_WEBHOOK_TOKEN` unset. With them, the provider's webhook receives `POST {"to":"+91XXXXXXXXXX","text":"..."}` with `Authorization: Bearer <token>`; the code rules are the same as for email, per number (`App\Services\MobileSignIn`). People can still add a number at sign-up or on their profile (`users.mobile`, migration `2026_11_03_000000_add_mobile_to_users`; a database loaded from `database/edu/01_edu_schema.sql` already has it).
- **When a code is shown on screen.** Only when `APP_ENV` is `local` or `dev` **and** nothing is set up to deliver it (for email, `MAIL_MAILER=log` or `array`; for mobile, no `SMS_WEBHOOK_URL`). On `test`, `production` or any other `APP_ENV` it never is: with no mailer there, the screen says the code could not be sent and to use the password, and no code is kept. The tiers' `APP_ENV` is `dev` on devedu.bkesari.com, `test` on testedu.bkesari.com and `production` on edu.bkesari.com (`DEPLOY.md` Part 2).
- **Kesari and the shell.** The pages load `/kesari-ui/1.1.0/kesari.css`, `/kesari-ui/1.1.0/kesari.js` and `/shared/menu.js` from the hub. Behind bkesari.com leave `HUB_ASSET_ORIGIN` empty (same origin); a copy reached directly sets `HUB_ASSET_ORIGIN=https://bkesari.com`. The shell asks `/edu/shell/me` who is signed in and signs out with `POST /edu/logout`.
- **Language.** English, Marathi or Hindi from the shell's `k_lang` cookie (`App\Http\Middleware\SetLocale`, strings in `lang/*.json`); the cookie is read unencrypted because the browser writes it.

## Signed in by the hub (D-039, since 17 Nov 2026)

Under D-039 a person signs in once at bkesari.com (Google first, the emailed code as fallback, the built-in administrators by username) and the bkesari admin approves them for Education with a role. On every request to `/edu/` the hub removes any `X-Bkesari-*` header the browser sent and, for a person with an active grant, adds signed identity headers (`docs/design/bkesari-id.md` section 3): `X-Bkesari-User` (hub user id), `-Email`, `-Role`, `-Name` (base64url UTF-8), `-Project` (`edu`), `-Ts` and `-Sig` (base64url HMAC-SHA256 with `HUB_PROXY_SECRET`). `App\Http\Middleware\HubIdentitySignIn` (in the web group, after the session starts and before `auth`/`guest`) checks them and signs that person in to their Education account.

- **`HUB_PROXY_SECRET` must be the same value as the hub's on that tier** (the one D-038's `TrustHubProxy` already reads; `openssl rand -hex 32`). Set it on the hub first, then here, then `php artisan optimize` (the config is cached).
- **Blank, or not the hub's value:** the identity headers are ignored completely. Nobody is signed in by the hub; Education's own sign-in (password, emailed code, built-in username) works exactly as before, and the log says once a day that the secret is not set (D-038). A wrong value looks the same from Education's side: hub users reach the sign-in page. Nothing is logged for a header set that does not verify (a client could send any), so check the value on both sides if hub users are not being signed in.
- **What is believed:** only a set whose signature matches, whose project is `edu` and whose time is less than 60 seconds from the server's clock either way. Keep the server clock on NTP: a hub and an Education server more than a minute apart sign nobody in. The headers are removed from the request either way, so nothing in the app reads them.
- **Which account:** the one whose `users.hub_user_id` is the hub id; else the one with that email **only if its email is confirmed** (the hub id is then stored on it); else a new account (confirmed, named from the header or the email, with a random password nobody knows; "Forgot password" sets one). An account whose email nobody has confirmed is never adopted (D-035): that person stays a guest, nothing is made, and the log says `Hub identity not used: an Education account whose email nobody has confirmed holds this address (D-039)` with the hub id (never the address), at most once an hour. The inbox owner confirms it with an emailed code or a password reset on Education's own sign-in page, or an admin removes the stray account. The same happens, with its own log line, for an account already linked to another hub user and for a role Education does not know. A hub id that is not digits is from the retired Neon Auth sign-in and is replaced.
- **Sessions:** a signed-in session that belongs to anyone else ends first; a session already signed in as that hub user is kept (no new sign-in on every request).
- **Roles:** the hub role is the one the bkesari admin approved: `parent`, `student`, `teacher`, `school_admin`, and `admin` = Education's `system_admin`. `users.hub_role` (migration `2026_11_17_000000_add_hub_role_to_users`) remembers the role the hub gave; when the hub's role changes, that role is removed and the new one given, while roles given inside Education are never touched (a role the account already held from Education is not recorded as the hub's, so it stays when the hub's role changes). Removing the hub's role inside Education does not stick: it comes back on the next request; change it at the hub. A `parent`, `student` or `teacher` gets the profile sign-up would make; a `school_admin` from the hub still has to be linked to a school inside Education, as before. Each change is written to the audit log as `hub-role-applied`.
- **The built-in administrators** (`smorankar`, `sonalimorankar`) arrive with role `admin` and their reserved `@builtin.bkesari.com` addresses and are signed in to their own rows, as system admin (D-036, `App\Support\BuiltinAdmins`; the row is made if it is not there yet). Any other reserved address, or a built-in address with another role, signs nobody in.
- **Database:** `php artisan migrate --force` adds `users.hub_role` (nullable, no index). A database loaded from `../database/edu/01_edu_schema.sql` already has it. A tier upgraded by hand instead runs, as the app's own database user: `ALTER TABLE public.users ADD COLUMN hub_role character varying(64); INSERT INTO public.migrations (migration, batch) SELECT '2026_11_17_000000_add_hub_role_to_users', coalesce(max(batch), 0) + 1 FROM public.migrations;`
- **For the owner to decide:**
  - *Two-factor.* A person who turned on Education's two-factor is signed in by the hub without the challenge: the hub's Google or emailed-code sign-in is taken as the sign-in, and two-factor is optional for every Education role (offered to school, district, state and national admins and system admins, required of none). The alternative is to ask for the code once per Education session for accounts that have it turned on.
  - *Signing out.* Education's own "Sign out" ends only the Education session; the next request through the hub signs the person in again. To leave, a person signs out at the hub (the shell's sign-out should point there under D-039).
  - *An account linked to another hub user.* If a confirmed email's Education account is already linked to a different hub user, the newcomer is not signed in (logged); relinking it is left to an admin.

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
