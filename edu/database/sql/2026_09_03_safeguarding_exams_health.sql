-- =====================================================================
--  Safeguarding, exams & coaching, and health & wellbeing
--  Spec sections 10, 18-21 and 25.
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
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP: pg_dump -Fc -f before.dump "$EDU_DATABASE_URL"
--     (or your PostgreSQL provider's snapshot/backup feature).
--  2. `users`, `schools`, `districts` and `states` must already exist.
--  3. This script only CREATES tables. It alters nothing existing and
--     touches no existing row.
--  4. Run once. Re-running errors on the CREATE statements, which is
--     deliberate — a loud failure beats a silent mismatch.
--
--  AFTER PART 1 AND PART 2, YOU MUST ALSO RUN (see Part 3):
--      php artisan db:seed --class=RolesAndPermissionsSeeder --force
--  This batch adds three roles and four permissions. Without that step the
--  new screens exist but nobody can reach them.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 — SCHEMA
-- ---------------------------------------------------------------------

-- ---- Safeguarding (spec section 25) ---------------------------------
-- A separate table from `complaints` on purpose, and never joined into
-- general reporting. The external_report_* columns record whether the POCSO
-- section 19 duty was discharged OUTSIDE this platform; filing here never
-- satisfies it, and `external_report_acknowledged_at` records an officer's
-- acknowledgement, not a verified police record.

create table "safeguarding_reports" (
  "id" bigserial not null primary key,
  "reference" varchar(20) not null,
  "school_id" bigint not null,
  "district_id" bigint not null,
  "state_id" bigint not null,
  "anonymous_ref" varchar(40) not null,
  "reporter_role" varchar(255) check ("reporter_role" in ('parent', 'student', 'teacher', 'staff', 'other')) not null,
  "category" varchar(255) check ("category" in ('child_sexual_abuse', 'physical_abuse', 'emotional_abuse', 'neglect', 'serious_violence', 'immediate_danger', 'serious_harassment', 'criminal_allegation', 'other_serious_concern')) not null,
  "description" text not null,
  "immediate_danger" boolean not null default '0',
  "status" varchar(255) check ("status" in ('submitted', 'acknowledged', 'external_report_confirmed', 'under_investigation', 'closed')) not null default 'submitted',
  "legal_duty_shown_at" timestamp(0) without time zone null,
  "external_report_acknowledged_at" timestamp(0) without time zone null,
  "external_report_acknowledged_by" bigint null,
  "external_report_channel" varchar(255) check ("external_report_channel" in ('police', 'sjpu', 'childline_1098', 'cwc', 'other')) null,
  "external_report_reference" varchar(100) null,
  "assigned_officer_user_id" bigint null,
  "acknowledged_at" timestamp(0) without time zone null,
  "closed_at" timestamp(0) without time zone null,
  "closed_by_user_id" bigint null,
  "closure_reason" text null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "safeguarding_reports" add constraint "safeguarding_reports_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete restrict;
alter table "safeguarding_reports" add constraint "safeguarding_reports_district_id_foreign" foreign key ("district_id") references "districts" ("id") on delete restrict;
alter table "safeguarding_reports" add constraint "safeguarding_reports_state_id_foreign" foreign key ("state_id") references "states" ("id") on delete restrict;
alter table "safeguarding_reports" add constraint "safeguarding_reports_external_report_acknowledged_by_foreign" foreign key ("external_report_acknowledged_by") references "users" ("id") on delete set null;
alter table "safeguarding_reports" add constraint "safeguarding_reports_assigned_officer_user_id_foreign" foreign key ("assigned_officer_user_id") references "users" ("id") on delete set null;
alter table "safeguarding_reports" add constraint "safeguarding_reports_closed_by_user_id_foreign" foreign key ("closed_by_user_id") references "users" ("id") on delete set null;
create index "safeguarding_reports_status_index" on "safeguarding_reports" ("status");
create index "safeguarding_reports_anonymous_ref_index" on "safeguarding_reports" ("anonymous_ref");
create index "safeguarding_reports_school_id_status_index" on "safeguarding_reports" ("school_id", "status");
create index "safeguarding_reports_district_id_status_index" on "safeguarding_reports" ("district_id", "status");
alter table "safeguarding_reports" add constraint "safeguarding_reports_reference_unique" unique ("reference");


-- Append-only case trail. Separate from `audit_logs` so a general audit
-- reader cannot learn from the log alone that a named school has a case.
create table "safeguarding_events" (
  "id" bigserial not null primary key,
  "safeguarding_report_id" bigint not null,
  "event_type" varchar(255) check ("event_type" in ('submitted', 'legal_duty_shown', 'acknowledged', 'assigned', 'external_report_recorded', 'investigation_started', 'note_added', 'closed', 'reopened', 'viewed')) not null,
  "actor_user_id" bigint null,
  "actor_role" varchar(60) null,
  "detail" text null,
  "occurred_at" timestamp(0) without time zone not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "safeguarding_events" add constraint "safeguarding_events_safeguarding_report_id_foreign" foreign key ("safeguarding_report_id") references "safeguarding_reports" ("id") on delete cascade;
alter table "safeguarding_events" add constraint "safeguarding_events_actor_user_id_foreign" foreign key ("actor_user_id") references "users" ("id") on delete set null;
create index "safeguarding_events_case_time_idx" on "safeguarding_events" ("safeguarding_report_id", "occurred_at");


-- ---- External exams & coaching (spec section 10) --------------------

create table "external_exams" (
  "id" bigserial not null primary key,
  "school_id" bigint not null,
  "academic_year" varchar(9) not null,
  "exam_name" varchar(150) not null,
  "conducting_body" varchar(150) null,
  "exam_type" varchar(255) check ("exam_type" in ('olympiad', 'scholarship', 'competitive', 'entrance', 'international', 'language', 'skill_certification', 'other')) not null default 'other',
  "applicable_classes" varchar(100) null,
  "eligibility" text null,
  "registration_process" text null,
  "through_school" boolean not null default '1',
  "exam_fee" decimal(12, 2) null,
  "preparation_offered" boolean not null default '0',
  "preparation_fee" decimal(12, 2) null,
  "is_mandatory" boolean not null default '0',
  "frequency" varchar(255) check ("frequency" in ('annual', 'biannual', 'termly', 'one_off')) not null default 'annual',
  "recorded_by_user_id" bigint not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "external_exams" add constraint "external_exams_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "external_exams" add constraint "external_exams_recorded_by_user_id_foreign" foreign key ("recorded_by_user_id") references "users" ("id") on delete cascade;
create index "external_exams_school_year_idx" on "external_exams" ("school_id", "academic_year");


-- `is_mandatory` + `bundled_into_school_fees` are what let the public profile
-- show a compulsory cost sitting outside the published fee register.
create table "coaching_programmes" (
  "id" bigserial not null primary key,
  "school_id" bigint not null,
  "academic_year" varchar(9) not null,
  "programme_name" varchar(150) not null,
  "programme_type" varchar(255) check ("programme_type" in ('jee', 'neet', 'cuet', 'clat', 'nda', 'olympiad', 'scholarship', 'coding', 'robotics', 'languages', 'other')) not null default 'other',
  "provider_type" varchar(255) check ("provider_type" in ('school', 'external_partner')) not null default 'school',
  "provider_name" varchar(150) null,
  "applicable_classes" varchar(100) null,
  "faculty" varchar(200) null,
  "duration" varchar(100) null,
  "timing" varchar(100) null,
  "during_school_hours" boolean not null default '0',
  "fee" decimal(12, 2) null,
  "bundled_into_school_fees" boolean not null default '0',
  "is_mandatory" boolean not null default '0',
  "certification_offered" boolean not null default '0',
  "recorded_by_user_id" bigint not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "coaching_programmes" add constraint "coaching_programmes_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "coaching_programmes" add constraint "coaching_programmes_recorded_by_user_id_foreign" foreign key ("recorded_by_user_id") references "users" ("id") on delete cascade;
create index "coaching_school_year_idx" on "coaching_programmes" ("school_id", "academic_year");


-- ---- Health & wellbeing (spec sections 18-21) -----------------------
-- All of the below is gated behind DPDP Act section 9 verifiable parental
-- consent, enforced in App\Services\HealthAccessService.

-- One row per examination, never overwritten, so the record is a history.
create table "physical_health_records" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "school_id" bigint not null,
  "academic_year" varchar(9) not null,
  "examination_date" date not null,
  "examination_type" varchar(255) check ("examination_type" in ('annual_screening', 'follow_up', 'incident', 'immunisation', 'other')) not null default 'annual_screening',
  "height_cm" decimal(5, 1) null,
  "weight_kg" decimal(5, 1) null,
  "bmi" decimal(4, 1) null,
  "vision_left" varchar(20) null,
  "vision_right" varchar(20) null,
  "hearing" varchar(255) check ("hearing" in ('normal', 'concern_noted', 'not_tested')) null,
  "dental" varchar(255) check ("dental" in ('normal', 'concern_noted', 'not_tested')) null,
  "general_examination" text null,
  "nutrition_observations" text null,
  "health_concerns" text null,
  "recommendations" text null,
  "next_due_date" date null,
  "recorded_by_user_id" bigint not null,
  "recorded_by_designation" varchar(100) null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "physical_health_records" add constraint "physical_health_records_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "physical_health_records" add constraint "physical_health_records_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "physical_health_records" add constraint "physical_health_records_recorded_by_user_id_foreign" foreign key ("recorded_by_user_id") references "users" ("id") on delete cascade;
create index "health_student_date_idx" on "physical_health_records" ("student_user_id", "examination_date");
create index "health_school_year_idx" on "physical_health_records" ("school_id", "academic_year");


-- Spec section 19's hard rule expressed as a table: a TEACHER's input, with
-- no diagnosis, severity, risk or treatment column to put an opinion in.
-- Deliberately separate from counselling_sessions. DO NOT add clinical
-- columns here — a schema test in the application will fail if you do.
create table "wellbeing_concerns" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "school_id" bigint not null,
  "observation" text not null,
  "context" varchar(200) null,
  "observed_on" date not null,
  "raised_by_user_id" bigint not null,
  "raised_by_role" varchar(60) not null,
  "referral_status" varchar(255) check ("referral_status" in ('raised', 'seen_by_counsellor', 'closed_without_referral')) not null default 'raised',
  "seen_at" timestamp(0) without time zone null,
  "seen_by_user_id" bigint null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "wellbeing_concerns" add constraint "wellbeing_concerns_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "wellbeing_concerns" add constraint "wellbeing_concerns_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "wellbeing_concerns" add constraint "wellbeing_concerns_raised_by_user_id_foreign" foreign key ("raised_by_user_id") references "users" ("id") on delete cascade;
alter table "wellbeing_concerns" add constraint "wellbeing_concerns_seen_by_user_id_foreign" foreign key ("seen_by_user_id") references "users" ("id") on delete set null;
create index "wellbeing_student_date_idx" on "wellbeing_concerns" ("student_user_id", "observed_on");
create index "wellbeing_school_status_idx" on "wellbeing_concerns" ("school_id", "referral_status");


-- The stricter confidentiality tier. `session_notes` is counsellor-only;
-- `shareable_summary` is what a guardian sees, and is written deliberately by
-- the counsellor rather than extracted from the notes.
create table "counselling_sessions" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "school_id" bigint not null,
  "wellbeing_concern_id" bigint null,
  "session_date" date not null,
  "session_type" varchar(255) check ("session_type" in ('initial', 'follow_up', 'group', 'parent_meeting', 'crisis', 'other')) not null default 'follow_up',
  "session_notes" text not null,
  "shareable_summary" text null,
  "support_plan" text null,
  "interventions" text null,
  "referred_externally" boolean not null default '0',
  "referral_detail" varchar(255) null,
  "next_session_date" date null,
  "counsellor_user_id" bigint not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "counselling_sessions" add constraint "counselling_sessions_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "counselling_sessions" add constraint "counselling_sessions_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "counselling_sessions" add constraint "counselling_sessions_wellbeing_concern_id_foreign" foreign key ("wellbeing_concern_id") references "wellbeing_concerns" ("id") on delete set null;
alter table "counselling_sessions" add constraint "counselling_sessions_counsellor_user_id_foreign" foreign key ("counsellor_user_id") references "users" ("id") on delete cascade;
create index "counselling_student_date_idx" on "counselling_sessions" ("student_user_id", "session_date");
create index "counselling_counsellor_date_idx" on "counselling_sessions" ("counsellor_user_id", "session_date");


-- Spec section 21's lifecycle: identified -> referred -> follow_up ->
-- completed -> closed. A screening that finds something and loses track of it
-- is worse than no screening.
create table "health_followups" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "school_id" bigint not null,
  "physical_health_record_id" bigint null,
  "area" varchar(255) check ("area" in ('vision', 'hearing', 'dental', 'nutrition', 'general', 'other')) not null default 'general',
  "finding" text not null,
  "recommended_action" text null,
  "status" varchar(255) check ("status" in ('identified', 'referred', 'follow_up', 'completed', 'closed')) not null default 'identified',
  "identified_on" date not null,
  "due_on" date null,
  "completed_on" date null,
  "outcome" text null,
  "opened_by_user_id" bigint not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "health_followups" add constraint "health_followups_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "health_followups" add constraint "health_followups_school_id_foreign" foreign key ("school_id") references "schools" ("id") on delete cascade;
alter table "health_followups" add constraint "health_followups_physical_health_record_id_foreign" foreign key ("physical_health_record_id") references "physical_health_records" ("id") on delete set null;
alter table "health_followups" add constraint "health_followups_opened_by_user_id_foreign" foreign key ("opened_by_user_id") references "users" ("id") on delete cascade;
create index "followups_student_status_idx" on "health_followups" ("student_user_id", "status");
create index "followups_school_status_idx" on "health_followups" ("school_id", "status");
create index "health_followups_due_on_index" on "health_followups" ("due_on");


-- Append-only. Records refused attempts as well as successful ones.
create table "health_access_logs" (
  "id" bigserial not null primary key,
  "student_user_id" bigint not null,
  "actor_user_id" bigint not null,
  "actor_role" varchar(60) null,
  "record_type" varchar(255) check ("record_type" in ('physical_health', 'wellbeing_concern', 'counselling_session', 'followup')) not null,
  "record_id" bigint null,
  "action" varchar(255) check ("action" in ('viewed', 'created', 'updated', 'downloaded', 'denied')) not null,
  "detail" varchar(255) null,
  "occurred_at" timestamp(0) without time zone not null,
  "created_at" timestamp(0) without time zone null,
  "updated_at" timestamp(0) without time zone null
);

alter table "health_access_logs" add constraint "health_access_logs_student_user_id_foreign" foreign key ("student_user_id") references "users" ("id") on delete cascade;
alter table "health_access_logs" add constraint "health_access_logs_actor_user_id_foreign" foreign key ("actor_user_id") references "users" ("id") on delete cascade;
create index "health_logs_student_time_idx" on "health_access_logs" ("student_user_id", "occurred_at");
create index "health_logs_actor_time_idx" on "health_access_logs" ("actor_user_id", "occurred_at");
create index "health_access_logs_action_index" on "health_access_logs" ("action");


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
  ('2026_09_03_100006_create_safeguarding_reports_table'),
  ('2026_09_03_100007_create_safeguarding_events_table'),
  ('2026_09_03_100008_create_external_exams_table'),
  ('2026_09_03_100009_create_coaching_programmes_table'),
  ('2026_09_03_100010_create_physical_health_records_table'),
  ('2026_09_03_100011_create_wellbeing_concerns_table'),
  ('2026_09_03_100012_create_counselling_sessions_table'),
  ('2026_09_03_100013_create_health_followups_table'),
  ('2026_09_03_100014_create_health_access_logs_table')
) AS v(migration)
WHERE NOT EXISTS (SELECT 1 FROM migrations m WHERE m.migration = v.migration);


-- ---------------------------------------------------------------------
--  PART 3 — ROLES AND PERMISSIONS (NOT SQL — run this command)
--
--  This batch adds three roles and four permissions:
--
--    roles:        child_safety_officer, school_nurse, counsellor
--    permissions:  handle-safeguarding-cases, record-physical-health,
--                  raise-wellbeing-concern, record-counselling-session
--
--  These live across spatie/laravel-permission's roles, permissions and
--  pivot tables, so hand-written INSERTs are easy to get subtly wrong. Run
--  the seeder instead — it uses firstOrCreate throughout and is safe to run
--  against a live database with existing roles:
--
--      php artisan db:seed --class=RolesAndPermissionsSeeder --force
--
--  Then clear the permission cache:
--
--      php artisan permission:cache-reset
--
--  Note the seeder deliberately does NOT give school_admin the
--  handle-safeguarding-cases permission. Under POCSO Act section 19 a
--  school's ordinary administration is not the venue for those cases, and
--  granting it would defeat the point of the module.
--
--  NOTE ON PROVENANCE: Part 1 was generated from the Laravel migrations by
--  Laravel's own PostgreSQL grammar. Part 2 is hand-written. If Part 2 errors,
--  nothing is lost — the schema is already in place — but a later
--  `php artisan migrate` will then fail with "table already exists"; fix that
--  by inserting the nine migration names into `migrations` by hand.
-- ---------------------------------------------------------------------
