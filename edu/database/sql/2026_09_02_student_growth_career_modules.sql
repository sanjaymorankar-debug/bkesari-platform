-- =====================================================================
--  Student Growth, Career & Life-Readiness modules — schema install
--  Spec sections 15, 16, 17 and 40 (DPDP Act 2023 Section 9 consent).
--
--  FOR: running by hand in phpMyAdmin against the Hostinger MySQL/MariaDB
--       database, as an alternative to `php artisan migrate`.
--
--  This DDL was generated from the Laravel migrations themselves using
--  Laravel's own MySQL schema grammar, so it matches exactly what
--  `php artisan migrate` would produce. It was verified to compile
--  identically for MySQL 8 and MariaDB 10.11.
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP. In phpMyAdmin: select the database, Export, Go.
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
create table `consent_records` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `granted_by_user_id` bigint unsigned not null,
  `purpose` enum('capability_growth', 'career_pathway', 'life_skills', 'physical_health', 'mental_wellbeing', 'alumni_outcomes') not null,
  `notice_text` text not null,
  `notice_version` varchar(20) not null,
  `status` enum('granted', 'withdrawn', 'expired') not null default 'granted',
  `verification_method` varchar(60) not null,
  `granted_at` timestamp not null,
  `withdrawn_at` timestamp null,
  `expires_at` timestamp null,
  `ip_address` varchar(45) null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `consent_records` add constraint `consent_records_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `consent_records` add constraint `consent_records_granted_by_user_id_foreign` foreign key (`granted_by_user_id`) references `users` (`id`) on delete cascade;
alter table `consent_records` add index `consent_student_purpose_status_idx`(`student_user_id`, `purpose`, `status`);
alter table `consent_records` add index `consent_records_granted_by_user_id_index`(`granted_by_user_id`);


-- Capability observations (spec section 15, NEP 2020 / PARAKH HPC model).
-- Note there is deliberately NO score, rating, level or band column, and
-- there must never be one — see STUDENT_GROWTH_FRAMEWORK.md.
create table `capability_observations` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `school_id` bigint unsigned not null,
  `observer_user_id` bigint unsigned not null,
  `observer_role` enum('teacher', 'parent', 'self', 'peer') not null,
  `domain` enum('cognitive_scholastic', 'socio_emotional', 'creative_co_scholastic', 'physical_development', 'life_skills') not null,
  `strand` varchar(120) not null,
  `observation_type` enum('strength', 'growth_area') not null,
  `observation` text not null,
  `evidence_context` text null,
  `academic_term` varchar(40) not null,
  `observed_on` date not null,
  `moderation_status` enum('approved', 'pending', 'rejected') not null default 'approved',
  `moderated_by_user_id` bigint unsigned null,
  `moderated_at` timestamp null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `capability_observations` add constraint `capability_observations_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `capability_observations` add constraint `capability_observations_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `capability_observations` add constraint `capability_observations_observer_user_id_foreign` foreign key (`observer_user_id`) references `users` (`id`) on delete cascade;
alter table `capability_observations` add constraint `capability_observations_moderated_by_user_id_foreign` foreign key (`moderated_by_user_id`) references `users` (`id`) on delete set null;
alter table `capability_observations` add index `cap_obs_student_domain_date_idx`(`student_user_id`, `domain`, `observed_on`);
alter table `capability_observations` add index `cap_obs_school_term_idx`(`school_id`, `academic_term`);
alter table `capability_observations` add index `capability_observations_observer_user_id_index`(`observer_user_id`);


-- Growth plans (spec section 16) — one shared plan per child, per school, per term.
create table `growth_plans` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `school_id` bigint unsigned not null,
  `created_by_user_id` bigint unsigned not null,
  `academic_term` varchar(40) not null,
  `status` enum('draft', 'active', 'completed', 'archived') not null default 'draft',
  `summary_for_parent` text null,
  `shared_with_parent_at` timestamp null,
  `parent_acknowledged_at` timestamp null,
  `reviewed_at` timestamp null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `growth_plans` add constraint `growth_plans_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `growth_plans` add constraint `growth_plans_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `growth_plans` add constraint `growth_plans_created_by_user_id_foreign` foreign key (`created_by_user_id`) references `users` (`id`) on delete cascade;
alter table `growth_plans` add unique `growth_plan_student_term_unique`(`student_user_id`, `school_id`, `academic_term`);
alter table `growth_plans` add index `growth_plan_school_status_idx`(`school_id`, `status`);


-- Growth goals (spec section 16). support_at_school and support_at_home are
-- NOT NULL on purpose: every growth area must carry a next step.
create table `growth_goals` (
  `id` bigint unsigned not null auto_increment primary key,
  `growth_plan_id` bigint unsigned not null,
  `domain` enum('cognitive_scholastic', 'socio_emotional', 'creative_co_scholastic', 'physical_development', 'life_skills') not null,
  `goal_statement` text not null,
  `support_at_school` text not null,
  `support_at_home` text not null,
  `student_voice` text null,
  `status` enum('set', 'in_progress', 'achieved', 'continuing') not null default 'set',
  `review_note` text null,
  `reviewed_at` timestamp null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `growth_goals` add constraint `growth_goals_growth_plan_id_foreign` foreign key (`growth_plan_id`) references `growth_plans` (`id`) on delete cascade;
alter table `growth_goals` add index `growth_goals_growth_plan_id_index`(`growth_plan_id`);


-- Career interests (spec section 17) — a dated time series, never overwritten,
-- with no "assigned track" column anywhere.
create table `career_interest_profiles` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `captured_by_user_id` bigint unsigned not null,
  `academic_term` varchar(40) not null,
  `interest_areas` json not null,
  `enjoyed_activities` json null,
  `reflection` text null,
  `captured_on` date not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `career_interest_profiles` add constraint `career_interest_profiles_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `career_interest_profiles` add constraint `career_interest_profiles_captured_by_user_id_foreign` foreign key (`captured_by_user_id`) references `users` (`id`) on delete cascade;
alter table `career_interest_profiles` add index `career_profile_student_date_idx`(`student_user_id`, `captured_on`);


-- Life-skills participation (spec section 17) — participation, never a score.
create table `life_skills_tracking` (
  `id` bigint unsigned not null auto_increment primary key,
  `student_user_id` bigint unsigned not null,
  `school_id` bigint unsigned not null,
  `recorded_by_user_id` bigint unsigned not null,
  `skill_area` enum('financial_literacy', 'digital_literacy_safety', 'civic_citizenship', 'communication', 'leadership', 'critical_thinking', 'emotional_intelligence', 'environmental_awareness') not null,
  `activity_title` varchar(200) not null,
  `activity_description` text null,
  `participation_level` enum('participated', 'engaged', 'led') not null,
  `academic_term` varchar(40) not null,
  `recorded_on` date not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `life_skills_tracking` add constraint `life_skills_tracking_student_user_id_foreign` foreign key (`student_user_id`) references `users` (`id`) on delete cascade;
alter table `life_skills_tracking` add constraint `life_skills_tracking_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `life_skills_tracking` add constraint `life_skills_tracking_recorded_by_user_id_foreign` foreign key (`recorded_by_user_id`) references `users` (`id`) on delete cascade;
alter table `life_skills_tracking` add index `life_skills_student_area_idx`(`student_user_id`, `skill_area`);
alter table `life_skills_tracking` add index `life_skills_school_term_idx`(`school_id`, `academic_term`);


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel these migrations have already been applied, so a later
--  `php artisan migrate` skips them instead of failing on "table already
--  exists". Safe to re-run: the WHERE NOT EXISTS guards prevent duplicates.
-- ---------------------------------------------------------------------

-- The inner SELECTs are wrapped in derived tables (`AS existing`, `AS b`) on
-- purpose: MySQL restricts referencing the table being written to directly in
-- a subquery, and the extra wrapper forces it to materialise first.
INSERT INTO `migrations` (`migration`, `batch`)
SELECT v.migration, b.next_batch
FROM (
  SELECT '2026_09_02_100001_create_consent_records_table' AS migration
  UNION ALL SELECT '2026_09_02_100002_create_capability_observations_table'
  UNION ALL SELECT '2026_09_02_100003_create_growth_plans_table'
  UNION ALL SELECT '2026_09_02_100004_create_growth_goals_table'
  UNION ALL SELECT '2026_09_02_100005_create_career_interest_profiles_table'
  UNION ALL SELECT '2026_09_02_100006_create_life_skills_tracking_table'
) AS v
CROSS JOIN (
  SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM (SELECT `batch` FROM `migrations`) AS mb
) AS b
WHERE v.migration NOT IN (
  SELECT existing.migration FROM (SELECT `migration` FROM `migrations`) AS existing
);


-- ---------------------------------------------------------------------
--  PART 3 — ROLES & PERMISSIONS
--
--  Mirrors database/seeders/RolesAndPermissionsSeeder.php. Safe to re-run.
--  Equivalent to: php artisan db:seed --class=RolesAndPermissionsSeeder
-- ---------------------------------------------------------------------

INSERT INTO `permissions` (`name`, `guard_name`, `created_at`, `updated_at`)
SELECT v.name, 'web', NOW(), NOW()
FROM (
  SELECT 'record-capability-observation' AS name
  UNION ALL SELECT 'manage-growth-plan'
  UNION ALL SELECT 'record-life-skills'
  UNION ALL SELECT 'manage-consent'
) AS v
WHERE v.name NOT IN (
  SELECT existing.name FROM (SELECT `name` FROM `permissions` WHERE `guard_name` = 'web') AS existing
);

INSERT INTO `roles` (`name`, `guard_name`, `created_at`, `updated_at`)
SELECT v.name, 'web', NOW(), NOW()
FROM (
  SELECT 'career_mentor' AS name
  UNION ALL SELECT 'data_protection_officer'
) AS v
WHERE v.name NOT IN (
  SELECT existing.name FROM (SELECT `name` FROM `roles` WHERE `guard_name` = 'web') AS existing
);

-- Grant the new permissions to the roles that hold them.
INSERT INTO `role_has_permissions` (`permission_id`, `role_id`)
SELECT p.id, r.id
FROM (
  SELECT 'parent'                  AS role, 'record-capability-observation' AS perm
  UNION ALL SELECT 'parent',                'manage-consent'
  UNION ALL SELECT 'student',               'record-capability-observation'
  UNION ALL SELECT 'teacher',               'record-capability-observation'
  UNION ALL SELECT 'teacher',               'manage-growth-plan'
  UNION ALL SELECT 'teacher',               'record-life-skills'
  UNION ALL SELECT 'career_mentor',         'record-capability-observation'
  UNION ALL SELECT 'career_mentor',         'record-life-skills'
  UNION ALL SELECT 'data_protection_officer','manage-consent'
  UNION ALL SELECT 'data_protection_officer','view-audit-logs'
  UNION ALL SELECT 'system_admin',          'record-capability-observation'
  UNION ALL SELECT 'system_admin',          'manage-growth-plan'
  UNION ALL SELECT 'system_admin',          'record-life-skills'
  UNION ALL SELECT 'system_admin',          'manage-consent'
) AS v
JOIN `roles` r       ON r.name = v.role AND r.guard_name = 'web'
JOIN `permissions` p ON p.name = v.perm AND p.guard_name = 'web'
WHERE CONCAT(p.id, '-', r.id) NOT IN (
  SELECT CONCAT(existing.permission_id, '-', existing.role_id)
  FROM (SELECT `permission_id`, `role_id` FROM `role_has_permissions`) AS existing
);

-- Spatie caches the permission map. After running this, either wait for the
-- cache to expire or run `php artisan permission:cache-reset` over SSH —
-- otherwise the new roles will not take effect until the cache clears.
--
-- NOTE ON PROVENANCE: Part 1 was generated from the Laravel migrations by
-- Laravel's own MySQL grammar and matches `php artisan migrate` exactly.
-- Parts 2 and 3 are hand-written. If either errors in phpMyAdmin, nothing is
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
