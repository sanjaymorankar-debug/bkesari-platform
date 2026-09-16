-- =====================================================================
--  Safeguarding, exams & coaching, and health & wellbeing
--  Spec sections 10, 18-21 and 25.
--
--  FOR: running by hand in phpMyAdmin against the Hostinger MySQL/MariaDB
--       database, as an alternative to `php artisan migrate`.
--
--  Part 1's DDL was generated from the Laravel migrations using Laravel's own
--  MySQL schema grammar, so it matches what `php artisan migrate` produces.
--  It compiles identically for MySQL 8 and MariaDB 10.11.
--
--  RUN THE PREVIOUS SCRIPTS FIRST if you haven't, in this order:
--    1. 2026_09_02_student_growth_career_modules.sql
--    2. 2026_09_03_school_core_udise_fees_facilities.sql
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP. phpMyAdmin: select the database, Export, Go.
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

create table `safeguarding_reports` (
  `id` bigint unsigned not null auto_increment primary key,
  `reference` varchar(20) not null,
  `school_id` bigint unsigned not null,
  `district_id` bigint unsigned not null,
  `state_id` bigint unsigned not null,
  `anonymous_ref` varchar(40) not null,
  `reporter_role` enum('parent', 'student', 'teacher', 'staff', 'other') not null,
  `category` enum('child_sexual_abuse', 'physical_abuse', 'emotional_abuse', 'neglect', 'serious_violence', 'immediate_danger', 'serious_harassment', 'criminal_allegation', 'other_serious_concern') not null,
  `description` text not null,
  `immediate_danger` tinyint(1) not null default '0',
  `status` enum('submitted', 'acknowledged', 'external_report_confirmed', 'under_investigation', 'closed') not null default 'submitted',
  `legal_duty_shown_at` timestamp null,
  `external_report_acknowledged_at` timestamp null,
  `external_report_acknowledged_by` bigint unsigned null,
  `external_report_channel` enum('police', 'sjpu', 'childline_1098', 'cwc', 'other') null,
  `external_report_reference` varchar(100) null,
  `assigned_officer_user_id` bigint unsigned null,
  `acknowledged_at` timestamp null,
  `closed_at` timestamp null,
  `closed_by_user_id` bigint unsigned null,
  `closure_reason` text null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `safeguarding_reports` add constraint `safeguarding_reports_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete restrict;
alter table `safeguarding_reports` add constraint `safeguarding_reports_district_id_foreign` foreign key (`district_id`) references `districts` (`id`) on delete restrict;
alter table `safeguarding_reports` add constraint `safeguarding_reports_state_id_foreign` foreign key (`state_id`) references `states` (`id`) on delete restrict;
alter table `safeguarding_reports` add constraint `safeguarding_reports_external_report_acknowledged_by_foreign` foreign key (`external_report_acknowledged_by`) references `users` (`id`) on delete set null;
alter table `safeguarding_reports` add constraint `safeguarding_reports_assigned_officer_user_id_foreign` foreign key (`assigned_officer_user_id`) references `users` (`id`) on delete set null;
alter table `safeguarding_reports` add constraint `safeguarding_reports_closed_by_user_id_foreign` foreign key (`closed_by_user_id`) references `users` (`id`) on delete set null;
alter table `safeguarding_reports` add index `safeguarding_reports_status_index`(`status`);
alter table `safeguarding_reports` add index `safeguarding_reports_anonymous_ref_index`(`anonymous_ref`);
alter table `safeguarding_reports` add index `safeguarding_reports_school_id_status_index`(`school_id`, `status`);
alter table `safeguarding_reports` add index `safeguarding_reports_district_id_status_index`(`district_id`, `status`);
alter table `safeguarding_reports` add unique `safeguarding_reports_reference_unique`(`reference`);


-- Append-only case trail. Separate from `audit_logs` so a general audit
-- reader cannot learn from the log alone that a named school has a case.
create table `safeguarding_events` (
  `id` bigint unsigned not null auto_increment primary key,
  `safeguarding_report_id` bigint unsigned not null,
  `event_type` enum('submitted', 'legal_duty_shown', 'acknowledged', 'assigned', 'external_report_recorded', 'investigation_started', 'note_added', 'closed', 'reopened', 'viewed') not null,
  `actor_user_id` bigint unsigned null,
  `actor_role` varchar(60) null,
  `detail` text null,
  `occurred_at` timestamp not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `safeguarding_events` add constraint `safeguarding_events_safeguarding_report_id_foreign` foreign key (`safeguarding_report_id`) references `safeguarding_reports` (`id`) on delete cascade;
alter table `safeguarding_events` add constraint `safeguarding_events_actor_user_id_foreign` foreign key (`actor_user_id`) references `users` (`id`) on delete set null;
alter table `safeguarding_events` add index `safeguarding_events_case_time_idx`(`safeguarding_report_id`, `occurred_at`);


-- ---- External exams & coaching (spec section 10) --------------------

create table `external_exams` (
  `id` bigint unsigned not null auto_increment primary key,
  `school_id` bigint unsigned not null,
  `academic_year` varchar(9) not null,
  `exam_name` varchar(150) not null,
  `conducting_body` varchar(150) null,
  `exam_type` enum('olympiad', 'scholarship', 'competitive', 'entrance', 'international', 'language', 'skill_certification', 'other') not null default 'other',
  `applicable_classes` varchar(100) null,
  `eligibility` text null,
  `registration_process` text null,
  `through_school` tinyint(1) not null default '1',
  `exam_fee` decimal(12, 2) null,
  `preparation_offered` tinyint(1) not null default '0',
  `preparation_fee` decimal(12, 2) null,
  `is_mandatory` tinyint(1) not null default '0',
  `frequency` enum('annual', 'biannual', 'termly', 'one_off') not null default 'annual',
  `recorded_by_user_id` bigint unsigned not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `external_exams` add constraint `external_exams_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `external_exams` add constraint `external_exams_recorded_by_user_id_foreign` foreign key (`recorded_by_user_id`) references `users` (`id`) on delete cascade;
alter table `external_exams` add index `external_exams_school_year_idx`(`school_id`, `academic_year`);


-- `is_mandatory` + `bundled_into_school_fees` are what let the public profile
-- show a compulsory cost sitting outside the published fee register.
create table `coaching_programmes` (
  `id` bigint unsigned not null auto_increment primary key,
  `school_id` bigint unsigned not null,
  `academic_year` varchar(9) not null,
  `programme_name` varchar(150) not null,
  `programme_type` enum('jee', 'neet', 'cuet', 'clat', 'nda', 'olympiad', 'scholarship', 'coding', 'robotics', 'languages', 'other') not null default 'other',
  `provider_type` enum('school', 'external_partner') not null default 'school',
  `provider_name` varchar(150) null,
  `applicable_classes` varchar(100) null,
  `faculty` varchar(200) null,
  `duration` varchar(100) null,
  `timing` varchar(100) null,
  `during_school_hours` tinyint(1) not null default '0',
  `fee` decimal(12, 2) null,
  `bundled_into_school_fees` tinyint(1) not null default '0',
  `is_mandatory` tinyint(1) not null default '0',
  `certification_offered` tinyint(1) not null default '0',
  `recorded_by_user_id` bigint unsigned not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `coaching_programmes` add constraint `coaching_programmes_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `coaching_programmes` add constraint `coaching_programmes_recorded_by_user_id_foreign` foreign key (`recorded_by_user_id`) references `users` (`id`) on delete cascade;
alter table `coaching_programmes` add index `coaching_school_year_idx`(`school_id`, `academic_year`);


-- ---- Health & wellbeing (spec sections 18-21) -----------------------
-- All of the below is gated behind DPDP Act section 9 verifiable parental
-- consent, enforced in App\Services\HealthAccessService.

-- One row per examination, never overwritten, so the record is a history.
create table `physical_health_records` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `school_id` bigint unsigned not null,
  `academic_year` varchar(9) not null,
  `examination_date` date not null,
  `examination_type` enum('annual_screening', 'follow_up', 'incident', 'immunisation', 'other') not null default 'annual_screening',
  `height_cm` decimal(5, 1) null,
  `weight_kg` decimal(5, 1) null,
  `bmi` decimal(4, 1) null,
  `vision_left` varchar(20) null,
  `vision_right` varchar(20) null,
  `hearing` enum('normal', 'concern_noted', 'not_tested') null,
  `dental` enum('normal', 'concern_noted', 'not_tested') null,
  `general_examination` text null,
  `nutrition_observations` text null,
  `health_concerns` text null,
  `recommendations` text null,
  `next_due_date` date null,
  `recorded_by_user_id` bigint unsigned not null,
  `recorded_by_designation` varchar(100) null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `physical_health_records` add constraint `physical_health_records_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `physical_health_records` add constraint `physical_health_records_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `physical_health_records` add constraint `physical_health_records_recorded_by_user_id_foreign` foreign key (`recorded_by_user_id`) references `users` (`id`) on delete cascade;
alter table `physical_health_records` add index `health_student_date_idx`(`student_user_id`, `examination_date`);
alter table `physical_health_records` add index `health_school_year_idx`(`school_id`, `academic_year`);


-- Spec section 19's hard rule expressed as a table: a TEACHER's input, with
-- no diagnosis, severity, risk or treatment column to put an opinion in.
-- Deliberately separate from counselling_sessions. DO NOT add clinical
-- columns here — a schema test in the application will fail if you do.
create table `wellbeing_concerns` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `school_id` bigint unsigned not null,
  `observation` text not null,
  `context` varchar(200) null,
  `observed_on` date not null,
  `raised_by_user_id` bigint unsigned not null,
  `raised_by_role` varchar(60) not null,
  `referral_status` enum('raised', 'seen_by_counsellor', 'closed_without_referral') not null default 'raised',
  `seen_at` timestamp null,
  `seen_by_user_id` bigint unsigned null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `wellbeing_concerns` add constraint `wellbeing_concerns_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `wellbeing_concerns` add constraint `wellbeing_concerns_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `wellbeing_concerns` add constraint `wellbeing_concerns_raised_by_user_id_foreign` foreign key (`raised_by_user_id`) references `users` (`id`) on delete cascade;
alter table `wellbeing_concerns` add constraint `wellbeing_concerns_seen_by_user_id_foreign` foreign key (`seen_by_user_id`) references `users` (`id`) on delete set null;
alter table `wellbeing_concerns` add index `wellbeing_student_date_idx`(`student_user_id`, `observed_on`);
alter table `wellbeing_concerns` add index `wellbeing_school_status_idx`(`school_id`, `referral_status`);


-- The stricter confidentiality tier. `session_notes` is counsellor-only;
-- `shareable_summary` is what a guardian sees, and is written deliberately by
-- the counsellor rather than extracted from the notes.
create table `counselling_sessions` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `school_id` bigint unsigned not null,
  `wellbeing_concern_id` bigint unsigned null,
  `session_date` date not null,
  `session_type` enum('initial', 'follow_up', 'group', 'parent_meeting', 'crisis', 'other') not null default 'follow_up',
  `session_notes` text not null,
  `shareable_summary` text null,
  `support_plan` text null,
  `interventions` text null,
  `referred_externally` tinyint(1) not null default '0',
  `referral_detail` varchar(255) null,
  `next_session_date` date null,
  `counsellor_user_id` bigint unsigned not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `counselling_sessions` add constraint `counselling_sessions_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `counselling_sessions` add constraint `counselling_sessions_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `counselling_sessions` add constraint `counselling_sessions_wellbeing_concern_id_foreign` foreign key (`wellbeing_concern_id`) references `wellbeing_concerns` (`id`) on delete set null;
alter table `counselling_sessions` add constraint `counselling_sessions_counsellor_user_id_foreign` foreign key (`counsellor_user_id`) references `users` (`id`) on delete cascade;
alter table `counselling_sessions` add index `counselling_student_date_idx`(`student_user_id`, `session_date`);
alter table `counselling_sessions` add index `counselling_counsellor_date_idx`(`counsellor_user_id`, `session_date`);


-- Spec section 21's lifecycle: identified -> referred -> follow_up ->
-- completed -> closed. A screening that finds something and loses track of it
-- is worse than no screening.
create table `health_followups` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `school_id` bigint unsigned not null,
  `physical_health_record_id` bigint unsigned null,
  `area` enum('vision', 'hearing', 'dental', 'nutrition', 'general', 'other') not null default 'general',
  `finding` text not null,
  `recommended_action` text null,
  `status` enum('identified', 'referred', 'follow_up', 'completed', 'closed') not null default 'identified',
  `identified_on` date not null,
  `due_on` date null,
  `completed_on` date null,
  `outcome` text null,
  `opened_by_user_id` bigint unsigned not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `health_followups` add constraint `health_followups_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `health_followups` add constraint `health_followups_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `health_followups` add constraint `health_followups_physical_health_record_id_foreign` foreign key (`physical_health_record_id`) references `physical_health_records` (`id`) on delete set null;
alter table `health_followups` add constraint `health_followups_opened_by_user_id_foreign` foreign key (`opened_by_user_id`) references `users` (`id`) on delete cascade;
alter table `health_followups` add index `followups_student_status_idx`(`student_user_id`, `status`);
alter table `health_followups` add index `followups_school_status_idx`(`school_id`, `status`);
alter table `health_followups` add index `health_followups_due_on_index`(`due_on`);


-- Append-only. Records refused attempts as well as successful ones.
create table `health_access_logs` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `actor_user_id` bigint unsigned not null,
  `actor_role` varchar(60) null,
  `record_type` enum('physical_health', 'wellbeing_concern', 'counselling_session', 'followup') not null,
  `record_id` bigint unsigned null,
  `action` enum('viewed', 'created', 'updated', 'downloaded', 'denied') not null,
  `detail` varchar(255) null,
  `occurred_at` timestamp not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `health_access_logs` add constraint `health_access_logs_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `health_access_logs` add constraint `health_access_logs_actor_user_id_foreign` foreign key (`actor_user_id`) references `users` (`id`) on delete cascade;
alter table `health_access_logs` add index `health_logs_student_time_idx`(`student_user_id`, `occurred_at`);
alter table `health_access_logs` add index `health_logs_actor_time_idx`(`actor_user_id`, `occurred_at`);
alter table `health_access_logs` add index `health_access_logs_action_index`(`action`);


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel these migrations are already applied, so a later
--  `php artisan migrate` skips them instead of failing on "table already
--  exists". Safe to re-run: the NOT IN guard prevents duplicates.
--
--  The inner SELECTs are wrapped in derived tables on purpose — MySQL
--  restricts referencing the table being written to directly in a subquery.
-- ---------------------------------------------------------------------

INSERT INTO `migrations` (`migration`, `batch`)
SELECT v.migration, b.next_batch
FROM (
  SELECT '2026_09_03_100006_create_safeguarding_reports_table' AS migration
  UNION ALL SELECT '2026_09_03_100007_create_safeguarding_events_table'
  UNION ALL SELECT '2026_09_03_100008_create_external_exams_table'
  UNION ALL SELECT '2026_09_03_100009_create_coaching_programmes_table'
  UNION ALL SELECT '2026_09_03_100010_create_physical_health_records_table'
  UNION ALL SELECT '2026_09_03_100011_create_wellbeing_concerns_table'
  UNION ALL SELECT '2026_09_03_100012_create_counselling_sessions_table'
  UNION ALL SELECT '2026_09_03_100013_create_health_followups_table'
  UNION ALL SELECT '2026_09_03_100014_create_health_access_logs_table'
) AS v
CROSS JOIN (
  SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM (SELECT `batch` FROM `migrations`) AS mb
) AS b
WHERE v.migration NOT IN (
  SELECT existing.migration FROM (SELECT `migration` FROM `migrations`) AS existing
);


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
--  Laravel's own MySQL grammar. Part 2 is hand-written. If Part 2 errors,
--  nothing is lost — the schema is already in place — but a later
--  `php artisan migrate` will then fail with "table already exists"; fix that
--  by inserting the nine migration names into `migrations` by hand.
-- ---------------------------------------------------------------------
