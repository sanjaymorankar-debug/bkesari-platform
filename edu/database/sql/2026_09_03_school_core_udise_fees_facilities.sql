-- =====================================================================
--  School core — UDISE identifier, fees, facilities & claimed-vs-experienced
--  Spec sections 5, 8, 9, 11 and 12.
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
--  RUN THE PREVIOUS SCRIPT FIRST if you haven't:
--  2026_09_02_student_growth_career_modules.sql
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP: pg_dump -Fc -f before.dump "$EDU_DATABASE_URL"
--     (or your PostgreSQL provider's snapshot/backup feature).
--  2. `users` and `schools` must already exist — the foreign keys need them.
--  3. Part 1 alters the existing `schools` table by ADDING three nullable
--     columns. It does not modify or drop anything already there, and no
--     existing row's data changes.
--  4. Run once. Re-running errors on the CREATE/ALTER statements, which is
--     deliberate — a loud failure beats a silent mismatch.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 — SCHEMA
-- ---------------------------------------------------------------------

-- UDISE+ (spec section 5). The platform consumes the government identifier;
-- it never replaces the internal school_code. The verification columns are
-- separate from the code because holding a code is a claim, and only a
-- confirmation against government data earns the "UDISE Verified" badge.
alter table "schools" add column "udise_code" varchar(20) null;
alter table "schools" add column "udise_verified_at" timestamp(0) without time zone null;
alter table "schools" add column "udise_verified_by_user_id" bigint null;
alter table "schools" add constraint "schools_udise_verified_by_user_id_foreign" foreign key ("udise_verified_by_user_id") references "users" ("id") on delete set null;
alter table "schools" add constraint "schools_udise_code_unique" unique ("udise_code");


-- Fee register (spec section 9). Scoped by academic_year, so a year's fees are
-- that year's rows and are never overwritten by the next year's.
create table "fees" (
  "id" bigserial not null primary key,
  "school_id" bigint not null,
  "academic_year" varchar(9) not null,
  "class_grade" varchar(20) null,
  "stream" varchar(60) null,
  "category" varchar(255) check ("category" in ('admission', 'registration', 'tuition', 'annual', 'development', 'term', 'examination', 'assessment', 'laboratory', 'computer', 'library', 'sports', 'activity', 'transport', 'hostel', 'meals', 'books', 'uniform', 'id_card', 'diary', 'field_trips', 'competitions', 'external_exam', 'certification', 'coaching', 'other')) not null,
  "label" varchar(150) not null,
  "amount" decimal(12, 2) not null,
  "frequency" varchar(255) check ("frequency" in ('one_time', 'monthly', 'quarterly', 'term', 'annual')) not null,
  "is_mandatory" boolean not null default '1',
  "is_refundable" boolean not null default '0',
  "conditions" text null,
  "effective_from" date not null,
  "state_cap_status" varchar(255) check ("state_cap_status" in ('not_applicable', 'within_cap', 'pending_review', 'exceeds_cap')) not null default 'not_applicable',
  "recorded_by_user_id" bigint not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "fees" add constraint "fees_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "fees" add constraint "fees_recorded_by_user_id_foreign" foreign key ("recorded_by_user_id") references "users" ("id") on delete cascade;
create index "fees_school_year_idx" on "fees" ("school_id", "academic_year");
create index "fees_school_year_class_idx" on "fees" ("school_id", "academic_year", "class_grade");


-- In-year fee changes (spec section 9's "never overwrite"). Keeps both the
-- before and after amount plus a required reason, so a fee that moves after
-- admissions close leaves a trail.
create table "fee_revisions" (
  "id" bigserial not null primary key,
  "fee_id" bigint not null,
  "school_id" bigint not null,
  "changed_by_user_id" bigint not null,
  "previous_amount" decimal(12, 2) not null,
  "new_amount" decimal(12, 2) not null,
  "previous_snapshot" json not null,
  "reason" text null,
  "changed_at" timestamp(0) without time zone not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "fee_revisions" add constraint "fee_revisions_fee_id_foreign" foreign key ("fee_id") references "fees" ("id") on delete cascade;
alter table "fee_revisions" add constraint "fee_revisions_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "fee_revisions" add constraint "fee_revisions_changed_by_user_id_foreign" foreign key ("changed_by_user_id") references "users" ("id") on delete cascade;
create index "fee_revisions_school_date_idx" on "fee_revisions" ("school_id", "changed_at");
create index "fee_revisions_fee_id_index" on "fee_revisions" ("fee_id");


-- What a school says it offers (spec section 8), versioned per year.
-- facility_key comes from App\Support\FacilityTaxonomy — the one canonical
-- list shared with facility_ratings, without which section 11's comparison
-- cannot be computed.
create table "facility_claims" (
  "id" bigserial not null primary key,
  "school_id" bigint not null,
  "facility_key" varchar(60) not null,
  "academic_year" varchar(9) not null,
  "is_offered" boolean not null default '1',
  "description" text null,
  "applicable_classes" varchar(100) null,
  "availability" varchar(255) check ("availability" in ('all_students', 'selected_classes', 'optional_enrolment', 'limited')) not null default 'all_students',
  "capacity" integer null,
  "fee_amount" decimal(12, 2) null,
  "is_mandatory" boolean not null default '0',
  "provider" varchar(150) null,
  "evidence_path" varchar(255) null,
  "evidence_note" text null,
  "verification_status" varchar(255) check ("verification_status" in ('unverified', 'pending', 'verified')) not null default 'unverified',
  "verified_by_user_id" bigint null,
  "verified_at" timestamp(0) without time zone null,
  "recorded_by_user_id" bigint not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "facility_claims" add constraint "facility_claims_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "facility_claims" add constraint "facility_claims_verified_by_user_id_foreign" foreign key ("verified_by_user_id") references "users" ("id") on delete set null;
alter table "facility_claims" add constraint "facility_claims_recorded_by_user_id_foreign" foreign key ("recorded_by_user_id") references "users" ("id") on delete cascade;
alter table "facility_claims" add constraint "facility_claim_unique" unique ("school_id", "facility_key", "academic_year");
create index "facility_claims_school_year_idx" on "facility_claims" ("school_id", "academic_year");


-- What families report experiencing (spec sections 11, 12).
-- Note there is NO user_id column and there must never be one: this table
-- stores anonymous_ref only, matching the identity separation in section 26.
create table "facility_ratings" (
  "id" bigserial not null primary key,
  "school_id" bigint not null,
  "facility_key" varchar(60) not null,
  "academic_year" varchar(9) not null,
  "anonymous_ref" varchar(40) not null,
  "rater_role" varchar(255) check ("rater_role" in ('parent', 'student')) not null,
  "availability_report" varchar(255) check ("availability_report" in ('available', 'partially_available', 'not_available')) not null,
  "quality" smallint null,
  "equipment" smallint null,
  "usage_frequency" smallint null,
  "staff_support" smallint null,
  "overall_usefulness" smallint null,
  "comment" text null,
  "submitted_at" timestamp(0) without time zone not null default CURRENT_TIMESTAMP,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "facility_ratings" add constraint "facility_ratings_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "facility_ratings" add constraint "facility_rating_unique" unique ("school_id", "facility_key", "academic_year", "anonymous_ref");
create index "facility_ratings_lookup_idx" on "facility_ratings" ("school_id", "facility_key", "academic_year");


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel these migrations are already applied, so a later
--  `php artisan migrate` skips them instead of failing on "table already
--  exists". Safe to re-run: the NOT EXISTS guard prevents duplicates.
-- ---------------------------------------------------------------------

INSERT INTO migrations (migration, batch)
SELECT v.migration, (SELECT COALESCE(MAX(batch), 0) + 1 FROM migrations)
FROM (VALUES
  ('2026_09_03_100001_add_udise_code_to_schools_table'),
  ('2026_09_03_100002_create_fees_table'),
  ('2026_09_03_100003_create_fee_revisions_table'),
  ('2026_09_03_100004_create_facility_claims_table'),
  ('2026_09_03_100005_create_facility_ratings_table')
) AS v(migration)
WHERE NOT EXISTS (SELECT 1 FROM migrations m WHERE m.migration = v.migration);

-- No new roles or permissions are needed for this batch: fee and facility
-- management reuse the existing school_admin role, and facility ratings reuse
-- the parent/student roles.
--
-- NOTE ON PROVENANCE: Part 1 was generated from the Laravel migrations by
-- Laravel's own PostgreSQL grammar. Part 2 is hand-written. If Part 2 errors,
-- nothing is lost — the schema is already in place — but a later
-- `php artisan migrate` will then fail with "table already exists"; fix that
-- by inserting the five migration names into `migrations` by hand.
