# Local Development Setup

## Requirements

- PHP 8.3+ with `pdo_mysql`, `pdo_sqlite`, `mbstring`, `openssl`, `fileinfo`, `curl`, `zip`, `gd`, `intl`
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

Local dev defaults to SQLite (`database/database.sqlite`, auto-created). To use MySQL instead, edit `.env`:

```
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=edu_platform
DB_USERNAME=root
DB_PASSWORD=
```

## Migrate + seed synthetic data

```bash
php artisan migrate:fresh --seed
```

This creates ~3 states, 5 districts, 20 schools, ~275 synthetic users (parents/students/teachers/officers/admins), ~100 complaints, and school feedback. **All data is fabricated** — see [`TEST_ACCOUNTS.md`](TEST_ACCOUNTS.md) for login credentials.

Note: on some Windows/SQLite setups, per-statement fsync makes a fresh seed slow (minutes, not seconds). `DatabaseSeeder` wraps everything in one transaction to keep this reasonable; if it's still slow, seeding against MySQL locally is faster than SQLite on Windows.

## Run locally

```bash
php artisan serve
```

Visit `http://127.0.0.1:8000`.

## Run tests

```bash
php artisan test
```

See [`TESTING.md`](TESTING.md) for what's covered.
