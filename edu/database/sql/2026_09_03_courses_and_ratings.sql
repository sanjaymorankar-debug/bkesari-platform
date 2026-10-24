-- =====================================================================
--  Courses & curriculum ratings — spec sections 8 and 12
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
--    4. 2026_09_03_benchmark_references.sql
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP: pg_dump -Fc -f before.dump "$EDU_DATABASE_URL"
--     (or your PostgreSQL provider's snapshot/backup feature).
--  2. `users` and `schools` must already exist — the foreign keys need them.
--  3. This script only CREATES tables. It alters nothing existing.
--  4. Run once. Re-running errors on the CREATEs, which is deliberate.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 — SCHEMA
-- ---------------------------------------------------------------------

-- The school's course catalogue, versioned per academic year. Kept separate
-- from facility_claims because a school can have an excellent laboratory and
-- a poorly-taught chemistry course, and merging the two hides that.
create table "courses" (
  "id" bigserial not null primary key,
  "school_id" bigint not null,
  "academic_year" varchar(9) not null,
  "name" varchar(150) not null,
  "course_type" varchar(255) check ("course_type" in ('core_subject', 'elective', 'stream', 'vocational', 'language', 'programme', 'other')) not null default 'core_subject',
  "applicable_classes" varchar(100) null,
  "stream" varchar(60) null,
  "description" text null,
  "recorded_by_user_id" bigint not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "courses" add constraint "courses_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "courses" add constraint "courses_recorded_by_user_id_foreign" foreign key ("recorded_by_user_id") references "users" ("id") on delete cascade;
alter table "courses" add constraint "course_unique_per_year" unique ("school_id", "academic_year", "name");
create index "courses_school_year_idx" on "courses" ("school_id", "academic_year");


-- Section 12's ten dimensions as named columns rather than a JSON blob, so a
-- dimension cannot quietly appear or disappear between submissions and
-- "how is practical learning rated across the district" stays a query.
--
-- Note there is NO user_id column and there must never be one: this table
-- stores anonymous_ref only (spec section 26).
--
-- Every dimension is nullable on purpose. Students are asked all ten; parents
-- are asked only the six they can realistically judge, and the rest stay NULL
-- rather than being filled with a guess. A NULL must never be treated as a
-- zero when averaging — it would drag the figure down for no reason.
create table "course_ratings" (
  "id" bigserial not null primary key,
  "course_id" bigint not null,
  "school_id" bigint not null,
  "academic_year" varchar(9) not null,
  "anonymous_ref" varchar(40) not null,
  "rater_role" varchar(255) check ("rater_role" in ('parent', 'student')) not null,
  "curriculum_relevance" smallint null,
  "course_quality" smallint null,
  "conceptual_learning" smallint null,
  "practical_learning" smallint null,
  "project_work" smallint null,
  "learning_resources" smallint null,
  "teaching_quality" smallint null,
  "course_organisation" smallint null,
  "engagement" smallint null,
  "career_relevance" smallint null,
  "comment" text null,
  "submitted_at" timestamp(0) without time zone not null default CURRENT_TIMESTAMP,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "course_ratings" add constraint "course_ratings_course_id_foreign" foreign key ("course_id") references "courses" ("id") on delete cascade;
alter table "course_ratings" add constraint "course_ratings_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "course_ratings" add constraint "course_rating_unique" unique ("course_id", "academic_year", "anonymous_ref");
create index "course_ratings_school_year_idx" on "course_ratings" ("school_id", "academic_year");


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel these migrations are already applied. Safe to re-run: the
--  NOT EXISTS guard prevents duplicates.
-- ---------------------------------------------------------------------

INSERT INTO migrations (migration, batch)
SELECT v.migration, (SELECT COALESCE(MAX(batch), 0) + 1 FROM migrations)
FROM (VALUES
  ('2026_09_03_100016_create_courses_table'),
  ('2026_09_03_100017_create_course_ratings_table')
) AS v(migration)
WHERE NOT EXISTS (SELECT 1 FROM migrations m WHERE m.migration = v.migration);

-- No new roles or permissions are needed: course management reuses
-- school_admin, and rating reuses the parent/student roles.
