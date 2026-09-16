-- =====================================================================
--  Courses & curriculum ratings — spec sections 8 and 12
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
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP. phpMyAdmin: select the database, Export, Go.
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
create table `courses` (
  `id` bigint unsigned not null auto_increment primary key,
  `school_id` bigint unsigned not null,
  `academic_year` varchar(9) not null,
  `name` varchar(150) not null,
  `course_type` enum('core_subject', 'elective', 'stream', 'vocational', 'language', 'programme', 'other') not null default 'core_subject',
  `applicable_classes` varchar(100) null,
  `stream` varchar(60) null,
  `description` text null,
  `recorded_by_user_id` bigint unsigned not null,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `courses` add constraint `courses_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `courses` add constraint `courses_recorded_by_user_id_foreign` foreign key (`recorded_by_user_id`) references `users` (`id`) on delete cascade;
alter table `courses` add unique `course_unique_per_year`(`school_id`, `academic_year`, `name`);
alter table `courses` add index `courses_school_year_idx`(`school_id`, `academic_year`);


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
create table `course_ratings` (
  `id` bigint unsigned not null auto_increment primary key,
  `course_id` bigint unsigned not null,
  `school_id` bigint unsigned not null,
  `academic_year` varchar(9) not null,
  `anonymous_ref` varchar(40) not null,
  `rater_role` enum('parent', 'student') not null,
  `curriculum_relevance` tinyint unsigned null,
  `course_quality` tinyint unsigned null,
  `conceptual_learning` tinyint unsigned null,
  `practical_learning` tinyint unsigned null,
  `project_work` tinyint unsigned null,
  `learning_resources` tinyint unsigned null,
  `teaching_quality` tinyint unsigned null,
  `course_organisation` tinyint unsigned null,
  `engagement` tinyint unsigned null,
  `career_relevance` tinyint unsigned null,
  `comment` text null,
  `submitted_at` timestamp not null default CURRENT_TIMESTAMP,
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `course_ratings` add constraint `course_ratings_course_id_foreign` foreign key (`course_id`) references `courses` (`id`) on delete cascade;
alter table `course_ratings` add constraint `course_ratings_school_id_foreign` foreign key (`school_id`) references `schools` (`id`) on delete cascade;
alter table `course_ratings` add unique `course_rating_unique`(`course_id`, `academic_year`, `anonymous_ref`);
alter table `course_ratings` add index `course_ratings_school_year_idx`(`school_id`, `academic_year`);


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel these migrations are already applied. Safe to re-run: the
--  NOT IN guard prevents duplicates. The inner SELECTs are wrapped in
--  derived tables because MySQL restricts referencing the table being
--  written to directly in a subquery.
-- ---------------------------------------------------------------------

INSERT INTO `migrations` (`migration`, `batch`)
SELECT v.migration, b.next_batch
FROM (
  SELECT '2026_09_03_100016_create_courses_table' AS migration
  UNION ALL SELECT '2026_09_03_100017_create_course_ratings_table'
) AS v
CROSS JOIN (
  SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM (SELECT `batch` FROM `migrations`) AS mb
) AS b
WHERE v.migration NOT IN (
  SELECT existing.migration FROM (SELECT `migration` FROM `migrations`) AS existing
);

-- No new roles or permissions are needed: course management reuses
-- school_admin, and rating reuses the parent/student roles.
