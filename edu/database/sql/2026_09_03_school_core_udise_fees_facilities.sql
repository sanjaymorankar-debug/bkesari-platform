-- =====================================================================
--  School core — UDISE identifier, fees, facilities & claimed-vs-experienced
--  Spec sections 5, 8, 9, 11 and 12.
--
--  FOR: running by hand in phpMyAdmin against the Hostinger MySQL/MariaDB
--       database, as an alternative to `php artisan migrate`.
--
--  Part 1's DDL was generated from the Laravel migrations using Laravel's own
--  MySQL schema grammar, so it matches what `php artisan migrate` produces.
--  It compiles identically for MySQL 8 and MariaDB 10.11.
--
--  RUN THE PREVIOUS SCRIPT FIRST if you haven't:
--  2026_09_02_student_growth_career_modules.sql
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP. phpMyAdmin: select the database, Export, Go.
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
alter table `schools` add `udise_code` varchar(20) null after `school_code`;
alter table `schools` add `udise_verified_at` timestamp null after `udise_code`;
alter table `schools` add `udise_verified_by_user_id` bigint unsigned null after `udise_verified_at`;
alter table `schools` add constraint `schools_udise_verified_by_user_id_foreign` foreign key (`udise_verified_by_user_id`) references `users` (`id`) on delete set null;
alter table `schools` add unique `schools_udise_code_unique`(`udise_code`);


-- Fee register (spec section 9). Scoped by academic_year, so a year's fees are
-- that year's rows and are never overwritten by the next year's.
create table `fees` (
  `id` bigint unsigned not null auto_increment primary key,
  `school_id` bigint unsigned not null,
  `academic_year` varchar(9) not null,
  `class_grade` varchar(20) null,
  `stream` varchar(60) null,
  `category` enum('admission', 'registration', 'tuition', 'annual', 'development', 'term', 'examination', 'assessment', 'laboratory', 'computer', 'library', 'sports', 'activity', 'transport', 'hostel', 'meals', 'books', 'uniform', 'id_card', 'diary', 'field_trips', 'competitions', 'external_exam', 'certification', 'coaching', 'other') not null,
  `label` varchar(150) not null,
  `amount` decimal(12, 2) not null,
  `frequency` enum('one_time', 'monthly', 'quarterly', 'term', 'annual') not null,
  `is_mandatory` tinyint(1) not null default '1',
  `is_refundable` tinyint(1) not null default '0',
  `conditions` text null,
  `effective_from` date not null,
  `state_cap_status` enum('not_applicable', 'within_cap', 'pending_review', 'exceeds_cap') not null default 'not_applicable',
  `recorded_by_user_id` bigint unsigned not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `fees` add constraint `fees_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `fees` add constraint `fees_recorded_by_user_id_foreign` foreign key (`recorded_by_user_id`) references `users` (`id`) on delete cascade;
alter table `fees` add index `fees_school_year_idx`(`school_id`, `academic_year`);
alter table `fees` add index `fees_school_year_class_idx`(`school_id`, `academic_year`, `class_grade`);


-- In-year fee changes (spec section 9's "never overwrite"). Keeps both the
-- before and after amount plus a required reason, so a fee that moves after
-- admissions close leaves a trail.
create table `fee_revisions` (
  `id` bigint unsigned not null auto_increment primary key,
  `fee_id` bigint unsigned not null,
  `school_id` bigint unsigned not null,
  `changed_by_user_id` bigint unsigned not null,
  `previous_amount` decimal(12, 2) not null,
  `new_amount` decimal(12, 2) not null,
  `previous_snapshot` json not null,
  `reason` text null,
  `changed_at` timestamp not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `fee_revisions` add constraint `fee_revisions_fee_id_foreign` foreign key (`fee_id`) references `fees` (`id`) on delete cascade;
alter table `fee_revisions` add constraint `fee_revisions_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `fee_revisions` add constraint `fee_revisions_changed_by_user_id_foreign` foreign key (`changed_by_user_id`) references `users` (`id`) on delete cascade;
alter table `fee_revisions` add index `fee_revisions_school_date_idx`(`school_id`, `changed_at`);
alter table `fee_revisions` add index `fee_revisions_fee_id_index`(`fee_id`);


-- What a school says it offers (spec section 8), versioned per year.
-- facility_key comes from App\Support\FacilityTaxonomy — the one canonical
-- list shared with facility_ratings, without which section 11's comparison
-- cannot be computed.
create table `facility_claims` (
  `id` bigint unsigned not null auto_increment primary key,
  `school_id` bigint unsigned not null,
  `facility_key` varchar(60) not null,
  `academic_year` varchar(9) not null,
  `is_offered` tinyint(1) not null default '1',
  `description` text null,
  `applicable_classes` varchar(100) null,
  `availability` enum('all_students', 'selected_classes', 'optional_enrolment', 'limited') not null default 'all_students',
  `capacity` int unsigned null,
  `fee_amount` decimal(12, 2) null,
  `is_mandatory` tinyint(1) not null default '0',
  `provider` varchar(150) null,
  `evidence_path` varchar(255) null,
  `evidence_note` text null,
  `verification_status` enum('unverified', 'pending', 'verified') not null default 'unverified',
  `verified_by_user_id` bigint unsigned null,
  `verified_at` timestamp null,
  `recorded_by_user_id` bigint unsigned not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `facility_claims` add constraint `facility_claims_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `facility_claims` add constraint `facility_claims_verified_by_user_id_foreign` foreign key (`verified_by_user_id`) references `users` (`id`) on delete set null;
alter table `facility_claims` add constraint `facility_claims_recorded_by_user_id_foreign` foreign key (`recorded_by_user_id`) references `users` (`id`) on delete cascade;
alter table `facility_claims` add unique `facility_claim_unique`(`school_id`, `facility_key`, `academic_year`);
alter table `facility_claims` add index `facility_claims_school_year_idx`(`school_id`, `academic_year`);


-- What families report experiencing (spec sections 11, 12).
-- Note there is NO user_id column and there must never be one: this table
-- stores anonymous_ref only, matching the identity separation in section 26.
create table `facility_ratings` (
  `id` bigint unsigned not null auto_increment primary key,
  `school_id` bigint unsigned not null,
  `facility_key` varchar(60) not null,
  `academic_year` varchar(9) not null,
  `anonymous_ref` varchar(40) not null,
  `rater_role` enum('parent', 'student') not null,
  `availability_report` enum('available', 'partially_available', 'not_available') not null,
  `quality` tinyint unsigned null,
  `equipment` tinyint unsigned null,
  `usage_frequency` tinyint unsigned null,
  `staff_support` tinyint unsigned null,
  `overall_usefulness` tinyint unsigned null,
  `comment` text null,
  `submitted_at` timestamp not null default CURRENT_TIMESTAMP,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `facility_ratings` add constraint `facility_ratings_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `facility_ratings` add unique `facility_rating_unique`(`school_id`, `facility_key`, `academic_year`, `anonymous_ref`);
alter table `facility_ratings` add index `facility_ratings_lookup_idx`(`school_id`, `facility_key`, `academic_year`);


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel these migrations are already applied, so a later
--  `php artisan migrate` skips them instead of failing on "table already
--  exists". Safe to re-run: the NOT IN guards prevent duplicates.
--
--  The inner SELECTs are wrapped in derived tables on purpose — MySQL
--  restricts referencing the table being written to directly in a subquery.
-- ---------------------------------------------------------------------

INSERT INTO `migrations` (`migration`, `batch`)
SELECT v.migration, b.next_batch
FROM (
  SELECT '2026_09_03_100001_add_udise_code_to_schools_table' AS migration
  UNION ALL SELECT '2026_09_03_100002_create_fees_table'
  UNION ALL SELECT '2026_09_03_100003_create_fee_revisions_table'
  UNION ALL SELECT '2026_09_03_100004_create_facility_claims_table'
  UNION ALL SELECT '2026_09_03_100005_create_facility_ratings_table'
) AS v
CROSS JOIN (
  SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM (SELECT `batch` FROM `migrations`) AS mb
) AS b
WHERE v.migration NOT IN (
  SELECT existing.migration FROM (SELECT `migration` FROM `migrations`) AS existing
);

-- No new roles or permissions are needed for this batch: fee and facility
-- management reuse the existing school_admin role, and facility ratings reuse
-- the parent/student roles.
--
-- NOTE ON PROVENANCE: Part 1 was generated from the Laravel migrations by
-- Laravel's own MySQL grammar. Part 2 is hand-written. If Part 2 errors,
-- nothing is lost — the schema is already in place — but a later
-- `php artisan migrate` will then fail with "table already exists"; fix that
-- by inserting the five migration names into `migrations` by hand.
