-- =====================================================================
--  School right of reply, and DPDP data-subject requests
--  Spec sections 21, 29 and 40.
--
--  FOR: running by hand in phpMyAdmin against the Hostinger MySQL/MariaDB
--       database, as an alternative to `php artisan migrate`.
--
--  Part 1's DDL was generated from the Laravel migrations using Laravel's own
--  MySQL schema grammar. It compiles identically for MySQL 8 and
--  MariaDB 10.11.
--
--  RUN THE PREVIOUS SCRIPTS FIRST if you haven't, in this order:
--    1. 2026_09_02_student_growth_career_modules.sql
--    2. 2026_09_03_school_core_udise_fees_facilities.sql
--    3. 2026_09_03_safeguarding_exams_health.sql
--    4. 2026_09_03_benchmark_references.sql
--    5. 2026_09_03_courses_and_ratings.sql
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP. phpMyAdmin: select the database, Export, Go.
--  2. `users` and `schools` must already exist.
--  3. This script only CREATES tables. It alters nothing existing.
--  4. Run once. Re-running errors on the CREATEs, which is deliberate.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 — SCHEMA
-- ---------------------------------------------------------------------

-- Spec section 29 — the school's public answer to a reported
-- claimed-vs-experienced gap. APPEND-ONLY by application rule: a school posts
-- a reply and, if things change, posts another; both stay visible and dated.
-- Editing in place would let a published answer be quietly rewritten, and that
-- record protects the school as much as the reader. A reply never removes,
-- hides or scores down what it answers.
create table `school_replies` (
  `id` bigint unsigned not null auto_increment primary key,
  `school_id` bigint unsigned not null,
  `context_type` enum('facility_discrepancy', 'course_feedback', 'general_feedback') not null,
  `context_key` varchar(60) null,
  `academic_year` varchar(9) not null,
  `body` text not null,
  `author_user_id` bigint unsigned not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `school_replies` add constraint `school_replies_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `school_replies` add constraint `school_replies_author_user_id_foreign` foreign key (`author_user_id`) references `users` (`id`) on delete cascade;
alter table `school_replies` add index `school_replies_school_year_idx`(`school_id`, `academic_year`);
alter table `school_replies` add index `school_replies_context_idx`(`school_id`, `context_type`, `context_key`);


-- Spec sections 21, 34 and 40 — DPDP access, correction and erasure requests,
-- handled by the Data Protection Officer.
--
-- The row is kept after the request is dealt with, including when refused: a
-- platform that cannot show what was asked of it and what it did cannot
-- demonstrate it honoured the right, and a refused erasure needs its reason on
-- record more than a granted one.
--
-- `outcome_by_category` exists because a request is routinely granted in part
-- and refused in part — safeguarding cases, consent records and audit logs are
-- never erased (see App\Support\DataRetention for each reason) — and one
-- status would hide which.
create table `data_subject_requests` (
  `id` bigint unsigned not null auto_increment primary key,
  `reference` varchar(20) not null,
  `requester_user_id` bigint unsigned not null,
  `subject_user_id` bigint unsigned not null,
  `request_type` enum('access', 'correction', 'erasure') not null,
  `categories` json not null,
  `detail` text null,
  `status` enum('submitted', 'under_review', 'completed', 'partially_completed', 'refused') not null default 'submitted',
  `outcome_by_category` json null,
  `response_note` text null,
  `handled_by_user_id` bigint unsigned null,
  `handled_at` timestamp null,
  `due_by` timestamp null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `data_subject_requests` add constraint `data_subject_requests_requester_user_id_foreign` foreign key (`requester_user_id`) references `users` (`id`) on delete cascade;
alter table `data_subject_requests` add constraint `data_subject_requests_subject_user_id_foreign` foreign key (`subject_user_id`) references `users` (`id`) on delete cascade;
alter table `data_subject_requests` add constraint `data_subject_requests_handled_by_user_id_foreign` foreign key (`handled_by_user_id`) references `users` (`id`) on delete set null;
alter table `data_subject_requests` add index `data_subject_requests_status_index`(`status`);
alter table `data_subject_requests` add index `dsr_subject_created_idx`(`subject_user_id`, `created_at`);
alter table `data_subject_requests` add index `data_subject_requests_due_by_index`(`due_by`);
alter table `data_subject_requests` add unique `data_subject_requests_reference_unique`(`reference`);


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel these migrations are already applied. Safe to re-run: the
--  NOT IN guard prevents duplicates. The inner SELECTs are wrapped in derived
--  tables because MySQL restricts referencing the table being written to
--  directly in a subquery.
-- ---------------------------------------------------------------------

INSERT INTO `migrations` (`migration`, `batch`)
SELECT v.migration, b.next_batch
FROM (
  SELECT '2026_09_03_100018_create_school_replies_table' AS migration
  UNION ALL SELECT '2026_09_03_100019_create_data_subject_requests_table'
) AS v
CROSS JOIN (
  SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM (SELECT `batch` FROM `migrations`) AS mb
) AS b
WHERE v.migration NOT IN (
  SELECT existing.migration FROM (SELECT `migration` FROM `migrations`) AS existing
);

-- No new roles or permissions: the right of reply reuses school_admin, and
-- the request queue reuses the existing data_protection_officer role.
--
-- RETENTION PERIODS: the per-category retention positions live in
-- App\Support\DataRetention, not in the database, so they can be reviewed in
-- one place. They are a starting position and should be checked against the
-- deployment state's own record-keeping rules before this is relied on.
