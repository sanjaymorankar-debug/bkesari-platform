# 26 — Local Testing

How to run this repo's tests on a developer machine, and why the suite is
split the way it is.

## Two tiers

| | command | suites | needs a database? |
|---|---|---|---|
| Unit | `npm test` | 23 / 198 tests | **no** |
| Integration | `npm run test:local` | 1 / 1 test | yes, a real PostgreSQL |

The split is enforced by Jest config, not convention. `apps/api/package.json`
sets `testPathIgnorePatterns` to exclude `*.integration.spec.ts`, so the
default `npm test` can never pick up a database-backed test by accident. The
integration script inverts that with `--testPathIgnorePatterns=[]` and a
`--testRegex` that matches *only* those files.

### Unit tier

Every service under test takes its collaborators by constructor injection, so
the specs pass in doubles and no `PrismaClient` is ever constructed. These
tests read **no environment variables at all** — `npm test` works on a fresh
clone with nothing configured but `npm install`:

```bash
npm install
npm test
```

### Integration tier

One spec, `apps/api/src/bookings/booking-concurrency.integration.spec.ts`,
exists specifically to exercise behaviour that cannot be mocked: the
`SELECT ... FOR UPDATE` row lock that stops two members booking the same
asset slot (docs/11-booking-architecture.md §2). It fires 10 concurrent
booking attempts at one slot and asserts exactly one wins. Mocking the
database would mock away the only thing under test.

It is self-seeding and self-cleaning: `beforeAll` creates its own category,
asset and users with a random suffix, and `afterAll` deletes them. You do
**not** need to run `db:seed` first. You *do* need the schema migrated.

## Running the integration test

Nothing in this repo loads `.env` at runtime — `PrismaService` is a bare
`PrismaClient`, so it reads `process.env.DATABASE_URL` and nothing else. CI
injects that as a workflow env var. Locally, use the `.env.test` convention:

```bash
cp apps/api/.env.test.example apps/api/.env.test   # edit if your PostgreSQL differs
npm run test:local                                 # from the repo root
```

`test:local` does four things in order: builds `shared-types`, generates the
Prisma client, applies migrations to the test database, then runs the
integration suite. It is safe to re-run.

> **Point `DATABASE_URL` at a throwaway database.** This suite creates and
> deletes real users, assets and bookings. It cleans up after itself, but a
> failed run can leave rows behind, and a bug in the suite would run those
> deletes against whatever you pointed it at.

### The test database

`.env.test.example` points at `ladwani_rebuild_test` on a local PostgreSQL at
`127.0.0.1:5432` (user and password `postgres`). Create it once, and recreate
it to start clean:

```bash
createdb ladwani_rebuild_test      # or: dropdb ladwani_rebuild_test && createdb ...
npm run test:local
```

Never point it at Neon: the hosted databases are for the running sites, and
this suite deletes rows.

This branch gets its own `ladwani_rebuild_dev` / `ladwani_rebuild_test` pair
rather than reusing `ladwani_test`. The `main` branch of this repository is a
**different application** — it shares no git history and no Prisma schema with
this branch — so pointing both at one database would have each branch's
migrations fighting the other's tables.

Any PostgreSQL 16 or later will do. CI uses 16; Neon runs 18.

## Script reference

Root (`package.json`):

| script | what it does |
|---|---|
| `test` | unit tier, via `apps/api` |
| `test:integration` | integration tier, expects `DATABASE_URL` in the environment (what CI uses) |
| `test:local` | build + generate + migrate + integration tier, reading `apps/api/.env.test` |

`apps/api/package.json`:

| script | what it does |
|---|---|
| `test` | `jest --runInBand`, integration specs excluded by config |
| `test:integration` | integration specs only; no env loading, so CI and the wrapper below share it |
| `test:setup:local` | `prisma migrate deploy` with `.env.test` loaded |
| `test:integration:local` | `test:integration` with `.env.test` loaded |
| `db:deploy` | `prisma migrate deploy` (non-interactive; what CI runs) |
| `db:migrate` | `prisma migrate dev` (interactive; creates new migrations) |

`apps/api/scripts/with-env.js` is the loader behind the `:local` scripts. It is
dependency-free on purpose: `VAR=x cmd` is bash-only syntax that breaks on
Windows, and adding `dotenv` would put a runtime dependency in the tree for
something only tests need. The non-`:local` scripts deliberately do no env
loading, so CI's path stays the plain one.

## Moving from MySQL (2026-10-24)

This branch ran on MySQL 8 until 2026-10-24 and now runs on PostgreSQL (Neon
in the hosted tiers). Three things differ in ways the tests do not catch on
their own, and are handled in the code:

- **Searches.** MySQL's default collation made every `contains:` filter
  case-insensitive; PostgreSQL compares exactly. Each filter now says
  `mode: 'insensitive'`, so "patel" still finds "Patel".
- **Emails.** The same collation made `A@x.com` and `a@x.com` one account.
  Emails are now stored and looked up lower-cased (`normalizeEmail` in
  `auth.service.ts`).
- **Migrations.** Prisma cannot carry a migration history across providers, so
  the MySQL history was replaced by one PostgreSQL baseline
  (`20261024000000_postgres_baseline`), generated from the same `schema.prisma`.
  An existing MySQL database is not migrated by it; its data would be moved
  separately (none exists yet on the hosted tiers).

`SELECT ... FOR UPDATE` in the booking lock behaves the same on both; the
integration test above proves it on PostgreSQL.
