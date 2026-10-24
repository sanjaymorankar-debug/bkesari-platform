-- =====================================================================
--  Student Growth, Career & Life-Readiness modules — schema install
--  Spec sections 15, 16, 17 and 40 (DPDP Act 2023 Section 9 consent).
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
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP: pg_dump -Fc -f before.dump "$EDU_DATABASE_URL"
--     (or your PostgreSQL provider's snapshot/backup feature).
--     Nothing here drops or alters an existing table, but take one anyway.
--  2. The `users` and `schools` tables must already exist — the foreign
--     keys below reference them.
--  3. Run this ONCE. Re-running will error on the CREATE TABLE statements,
--     which is deliberate: a loud failure is safer than silently skipping
--     a table that already exists in a different shape.
--
--  WHAT IT DOES
--  ------------
--  Part 1  creates the six new tables.
--  Part 2  records the migrations as run, so a later `php artisan migrate`
--          does not try to create these tables a second time.
--  Part 3  adds the new roles and permissions (career_mentor,
--          data_protection_officer, and the growth/consent permissions).
--
--  Parts 2 and 3 are written to be safely re-runnable on their own.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 — TABLES
-- ---------------------------------------------------------------------

-- Consent (DPDP Act 2023 Section 9). Nothing in the modules below may be
-- collected or read without a matching in-force row here.
create table "consent_records" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "granted_by_user_id" bigint not null,
  "purpose" varchar(255) check ("purpose" in ('capability_growth', 'career_pathway', 'life_skills', 'physical_health', 'mental_wellbeing', 'alumni_outcomes')) not null,
  "notice_text" text not null,
  "notice_version" varchar(20) not null,
  "status" varchar(255) check ("status" in ('granted', 'withdrawn', 'expired')) not null default 'granted',
  "verification_method" varchar(60) not null,
  "granted_at" timestamp(0) without time zone not null,
  "withdrawn_at" timestamp(0) without time zone null,
  "expires_at" timestamp(0) without time zone null,
  "ip_address" varchar(45) null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "consent_records" add constraint "consent_records_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "consent_records" add constraint "consent_records_granted_by_user_id_foreign" foreign key ("granted_by_user_id") references "users" ("id") on delete cascade;
create index "consent_student_purpose_status_idx" on "consent_records" ("student_user_id", "purpose", "status");
create index "consent_records_granted_by_user_id_index" on "consent_records" ("granted_by_user_id");


-- Capability observations (spec section 15, NEP 2020 / PARAKH HPC model).
-- Note there is deliberately NO score, rating, level or band column, and
-- there must never be one — see STUDENT_GROWTH_FRAMEWORK.md.
create table "capability_observations" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "school_id" bigint not null,
  "observer_user_id" bigint not null,
  "observer_role" varchar(255) check ("observer_role" in ('teacher', 'parent', 'self', 'peer')) not null,
  "domain" varchar(255) check ("domain" in ('cognitive_scholastic', 'socio_emotional', 'creative_co_scholastic', 'physical_development', 'life_skills')) not null,
  "strand" varchar(120) not null,
  "observation_type" varchar(255) check ("observation_type" in ('strength', 'growth_area')) not null,
  "observation" text not null,
  "evidence_context" text null,
  "academic_term" varchar(40) not null,
  "observed_on" date not null,
  "moderation_status" varchar(255) check ("moderation_status" in ('approved', 'pending', 'rejected')) not null default 'approved',
  "moderated_by_user_id" bigint null,
  "moderated_at" timestamp(0) without time zone null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "capability_observations" add constraint "capability_observations_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "capability_observations" add constraint "capability_observations_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "capability_observations" add constraint "capability_observations_observer_user_id_foreign" foreign key ("observer_user_id") references "users" ("id") on delete cascade;
alter table "capability_observations" add constraint "capability_observations_moderated_by_user_id_foreign" foreign key ("moderated_by_user_id") references "users" ("id") on delete set null;
create index "cap_obs_student_domain_date_idx" on "capability_observations" ("student_user_id", "domain", "observed_on");
create index "cap_obs_school_term_idx" on "capability_observations" ("school_id", "academic_term");
create index "capability_observations_observer_user_id_index" on "capability_observations" ("observer_user_id");


-- Growth plans (spec section 16) — one shared plan per child, per school, per term.
create table "growth_plans" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "school_id" bigint not null,
  "created_by_user_id" bigint not null,
  "academic_term" varchar(40) not null,
  "status" varchar(255) check ("status" in ('draft', 'active', 'completed', 'archived')) not null default 'draft',
  "summary_for_parent" text null,
  "shared_with_parent_at" timestamp(0) without time zone null,
  "parent_acknowledged_at" timestamp(0) without time zone null,
  "reviewed_at" timestamp(0) without time zone null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "growth_plans" add constraint "growth_plans_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "growth_plans" add constraint "growth_plans_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "growth_plans" add constraint "growth_plans_created_by_user_id_foreign" foreign key ("created_by_user_id") references "users" ("id") on delete cascade;
alter table "growth_plans" add constraint "growth_plan_student_term_unique" unique ("student_user_id", "school_id", "academic_term");
create index "growth_plan_school_status_idx" on "growth_plans" ("school_id", "status");


-- Growth goals (spec section 16). support_at_school and support_at_home are
-- NOT NULL on purpose: every growth area must carry a next step.
create table "growth_goals" (
  "id" bigserial not null primary key,
  "growth_plan_id" bigint not null,
  "domain" varchar(255) check ("domain" in ('cognitive_scholastic', 'socio_emotional', 'creative_co_scholastic', 'physical_development', 'life_skills')) not null,
  "goal_statement" text not null,
  "support_at_school" text not null,
  "support_at_home" text not null,
  "student_voice" text null,
  "status" varchar(255) check ("status" in ('set', 'in_progress', 'achieved', 'continuing')) not null default 'set',
  "review_note" text null,
  "reviewed_at" timestamp(0) without time zone null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "growth_goals" add constraint "growth_goals_growth_plan_id_foreign" foreign key ("growth_plan_id") references "growth_plans" ("id") on delete cascade;
create index "growth_goals_growth_plan_id_index" on "growth_goals" ("growth_plan_id");


-- Career interests (spec section 17) — a dated time series, never overwritten,
-- with no "assigned track" column anywhere.
create table "career_interest_profiles" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "captured_by_user_id" bigint not null,
  "academic_term" varchar(40) not null,
  "interest_areas" json not null,
  "enjoyed_activities" json null,
  "reflection" text null,
  "captured_on" date not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "career_interest_profiles" add constraint "career_interest_profiles_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "career_interest_profiles" add constraint "career_interest_profiles_captured_by_user_id_foreign" foreign key ("captured_by_user_id") references "users" ("id") on delete cascade;
create index "career_profile_student_date_idx" on "career_interest_profiles" ("student_user_id", "captured_on");


-- Life-skills participation (spec section 17) — participation, never a score.
create table "life_skills_tracking" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "school_id" bigint not null,
  "recorded_by_user_id" bigint not null,
  "skill_area" varchar(255) check ("skill_area" in ('financial_literacy', 'digital_literacy_safety', 'civic_citizenship', 'communication', 'leadership', 'critical_thinking', 'emotional_intelligence', 'environmental_awareness')) not null,
  "activity_title" varchar(200) not null,
  "activity_description" text null,
  "participation_level" varchar(255) check ("participation_level" in ('participated', 'engaged', 'led')) not null,
  "academic_term" varchar(40) not null,
  "recorded_on" date not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "life_skills_tracking" add constraint "life_skills_tracking_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "life_skills_tracking" add constraint "life_skills_tracking_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "life_skills_tracking" add constraint "life_skills_tracking_recorded_by_user_id_foreign" foreign key ("recorded_by_user_id") references "users" ("id") on delete cascade;
create index "life_skills_student_area_idx" on "life_skills_tracking" ("student_user_id", "skill_area");
create index "life_skills_school_term_idx" on "life_skills_tracking" ("school_id", "academic_term");


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel these migrations have already been applied, so a later
--  `php artisan migrate` skips them instead of failing on "table already
--  exists". Safe to re-run: the WHERE NOT EXISTS guards prevent duplicates.
-- ---------------------------------------------------------------------

INSERT INTO migrations (migration, batch)
SELECT v.migration, (SELECT COALESCE(MAX(batch), 0) + 1 FROM migrations)
FROM (VALUES
  ('2026_09_02_100001_create_consent_records_table'),
  ('2026_09_02_100002_create_capability_observations_table'),
  ('2026_09_02_100003_create_growth_plans_table'),
  ('2026_09_02_100004_create_growth_goals_table'),
  ('2026_09_02_100005_create_career_interest_profiles_table'),
  ('2026_09_02_100006_create_life_skills_tracking_table')
) AS v(migration)
WHERE NOT EXISTS (SELECT 1 FROM migrations m WHERE m.migration = v.migration);


-- ---------------------------------------------------------------------
--  PART 3 — ROLES & PERMISSIONS
--
--  Mirrors database/seeders/RolesAndPermissionsSeeder.php. Safe to re-run.
--  Equivalent to: php artisan db:seed --class=RolesAndPermissionsSeeder
-- ---------------------------------------------------------------------

-- Timestamps are written in UTC, as Laravel writes them (config/app.php).
INSERT INTO permissions (name, guard_name, created_at, updated_at)
SELECT v.name, 'web', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
FROM (VALUES
  ('record-capability-observation'),
  ('manage-growth-plan'),
  ('record-life-skills'),
  ('manage-consent')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM permissions e WHERE e.name = v.name AND e.guard_name = 'web');

INSERT INTO roles (name, guard_name, created_at, updated_at)
SELECT v.name, 'web', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
FROM (VALUES
  ('career_mentor'),
  ('data_protection_officer')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM roles e WHERE e.name = v.name AND e.guard_name = 'web');

-- Grant the new permissions to the roles that hold them.
INSERT INTO role_has_permissions (permission_id, role_id)
SELECT p.id, r.id
FROM (VALUES
  ('parent',                  'record-capability-observation'),
  ('parent',                  'manage-consent'),
  ('student',                 'record-capability-observation'),
  ('teacher',                 'record-capability-observation'),
  ('teacher',                 'manage-growth-plan'),
  ('teacher',                 'record-life-skills'),
  ('career_mentor',           'record-capability-observation'),
  ('career_mentor',           'record-life-skills'),
  ('data_protection_officer', 'manage-consent'),
  ('data_protection_officer', 'view-audit-logs'),
  ('system_admin',            'record-capability-observation'),
  ('system_admin',            'manage-growth-plan'),
  ('system_admin',            'record-life-skills'),
  ('system_admin',            'manage-consent')
) AS v(role, perm)
JOIN roles r       ON r.name = v.role AND r.guard_name = 'web'
JOIN permissions p ON p.name = v.perm AND p.guard_name = 'web'
ON CONFLICT (permission_id, role_id) DO NOTHING;

-- Spatie caches the permission map. After running this, either wait for the
-- cache to expire or run `php artisan permission:cache-reset` over SSH —
-- otherwise the new roles will not take effect until the cache clears.
--
-- NOTE ON PROVENANCE: Part 1 was generated from the Laravel migrations by
-- Laravel's own PostgreSQL grammar and matches `php artisan migrate` exactly.
-- Parts 2 and 3 are hand-written. If either errors, nothing is
-- lost — Part 1's tables are already in place, and the equivalent work can be
-- done over SSH instead:
--
--   php artisan migrate --force        # skips tables that already exist only
--                                      # if Part 2 ran; otherwise see below
--   php artisan db:seed --class=RolesAndPermissionsSeeder --force
--   php artisan permission:cache-reset
--
-- If Part 2 did NOT run and you then run `php artisan migrate`, it will fail
-- with "table already exists". Fix by inserting the six migration names into
-- the `migrations` table by hand, or by dropping the six tables created above
-- (they are empty at that point) and letting artisan create them instead.
