-- =====================================================================
--  International benchmarking references — spec section 3
--
--  FOR: running by hand against the PostgreSQL database, as an
--       alternative to `php artisan migrate`. With psql:
--         psql "$EDU_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
--       (-1 runs the file as ONE transaction: PostgreSQL DDL is
--       transactional, so a failure part-way leaves nothing behind.)
--
--  Part 1's DDL was generated from the Laravel migrations by Laravel's own
--  PostgreSQL schema grammar (`php artisan migrate --pretend` on a pgsql
--  connection), so it matches what `php artisan migrate` produces there:
--  enum() columns are varchar + CHECK constraints, booleans are `boolean`,
--  ids are bigserial, timestamps are timestamp(0) without time zone (UTC).
--
--  RUN THE PREVIOUS SCRIPTS FIRST if you haven't, in this order:
--    1. 2026_09_02_student_growth_career_modules.sql
--    2. 2026_09_03_school_core_udise_fees_facilities.sql
--    3. 2026_09_03_safeguarding_exams_health.sql
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP: pg_dump -Fc -f before.dump "$EDU_DATABASE_URL"
--     (or your PostgreSQL provider's snapshot/backup feature).
--  2. This script only CREATES one table. It alters nothing existing.
--  3. Run once. Re-running errors on the CREATE, which is deliberate.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 — SCHEMA
--
--  Note what this table CANNOT hold: there is no score, rank, value or
--  numeric column of any kind. That is spec rule 44 ("never fabricate an
--  international benchmark score India has not produced") enforced by the
--  schema rather than by policy. A row here describes what a high-performing
--  system DOES, never what it scored, so there is nowhere to put an invented
--  Indian PISA rank even if someone wanted to.
--
--  DO NOT add a numeric column here. An application test asserts none exists
--  and will fail if one is added.
-- ---------------------------------------------------------------------

create table "benchmark_references" (
  "id" bigserial not null primary key,
  "dimension" varchar(60) not null,
  "system_name" varchar(100) not null,
  "system_type" varchar(255) check ("system_type" in ('country', 'framework')) not null default 'country',
  "practice" text not null,
  "relevance" text null,
  "source_name" varchar(200) not null,
  "source_url" varchar(500) null,
  "source_year" smallint not null,
  -- Set to true only when a human has re-checked the citation against the
  -- original published source. The public page says "citation pending
  -- verification" while this is false.
  "source_verified" boolean not null default '0',
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

create index "benchmark_references_dimension_index" on "benchmark_references" ("dimension");
create index "benchmark_references_system_name_index" on "benchmark_references" ("system_name");


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel this migration is already applied. Safe to re-run: the
--  NOT EXISTS guard prevents duplicates.
-- ---------------------------------------------------------------------

INSERT INTO migrations (migration, batch)
SELECT v.migration, (SELECT COALESCE(MAX(batch), 0) + 1 FROM migrations)
FROM (VALUES
  ('2026_09_03_100015_create_benchmark_references_table')
) AS v(migration)
WHERE NOT EXISTS (SELECT 1 FROM migrations m WHERE m.migration = v.migration);


-- ---------------------------------------------------------------------
--  PART 3 — REFERENCE CONTENT (run this command, not SQL)
--
--  The structural-practice rows are seeded from the application so they stay
--  in one reviewable place:
--
--      php artisan db:seed --class=BenchmarkReferenceSeeder --force
--
--  Every seeded row lands with source_verified = false on purpose. Before this
--  page is shown publicly, someone must check each citation against the
--  actual published source and set the flag:
--
--      UPDATE benchmark_references SET source_verified = true WHERE id = <id>;
--
--  Until then the page tells readers the citations are pending verification,
--  which is the honest state — not an omission to be tidied away.
-- ---------------------------------------------------------------------
