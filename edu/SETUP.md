# Local Development Setup

> **In bkesari-platform:** `tools/setup_local_postgres.sh` at the repository root creates the
> PostgreSQL databases (`bk_edu`, and `bk_edu_test` for the tests), writes this app's `.env`, and
> runs the migrations and seeders — see `docs/MAC_DEPLOYMENT.md` step 3. The manual steps below
> do the same by hand.

## Requirements

- PHP 8.3+ with `pdo_pgsql`, `mbstring`, `openssl`, `fileinfo`, `curl`, `zip`, `gd`, `intl` (plus `pdo_sqlite` only if you want the zero-setup in-memory test run)
- PostgreSQL 16 (any 13+ should work; CI uses 16). The app's database role needs to be able to `CREATE EXTENSION citext` — the database owner can, since `citext` is a trusted extension.
- Composer 2.x
- Node 18+ / npm (only needed for editing frontend assets — the server does not need Node)

## First-time setup

```bash
composer install
cp .env.example .env
php artisan key:generate
npm install
npm run build
```

Create a database and point `.env` at it (`.env.example` already has PostgreSQL defaults):

```bash
createdb -h 127.0.0.1 -U postgres edu_platform
```

```
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=edu_platform
DB_USERNAME=postgres
DB_PASSWORD=your-local-password
DB_SSLMODE=prefer
```

If you don't have PostgreSQL installed, a throwaway container works:

```bash
docker run -d --name edu-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

## Migrate + seed synthetic data

```bash
php artisan migrate:fresh --seed
```

This creates ~3 states, 5 districts, 20 schools, ~275 synthetic users (parents/students/teachers/officers/admins), ~100 complaints, and school feedback. **All data is fabricated** — see [`TEST_ACCOUNTS.md`](TEST_ACCOUNTS.md) for login credentials.

Most of the seed time is password hashing for ~275 users at `BCRYPT_ROUNDS=12` (over a minute). For a faster local seed, run `BCRYPT_ROUNDS=4 php artisan migrate:fresh --seed`.

## Run locally

```bash
php artisan serve
```

Visit `http://127.0.0.1:8000`. In bkesari-platform on the Mac, port 8000 is ATIP's, so use
`php artisan serve --port=8001` there (`http://127.0.0.1:8001`, which is the `APP_URL`
`tools/setup_local_postgres.sh` writes; `docs/MAC_DEPLOYMENT.md` uses the same port). With no
path in `APP_URL` the port in it does not affect any link, so either works.

## Run tests

```bash
php artisan test
```

By default this uses in-memory SQLite (no setup needed). To run the suite against PostgreSQL, which is what CI does, see [`TESTING.md`](TESTING.md).
