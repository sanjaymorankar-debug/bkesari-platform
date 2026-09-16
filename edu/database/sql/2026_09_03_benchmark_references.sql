-- =====================================================================
--  International benchmarking references — spec section 3
--
--  FOR: running by hand in phpMyAdmin against the Hostinger MySQL/MariaDB
--       database, as an alternative to `php artisan migrate`.
--
--  Part 1's DDL was generated from the Laravel migration using Laravel's own
--  MySQL schema grammar. It compiles identically for MySQL 8 and
--  MariaDB 10.11.
--
--  RUN THE PREVIOUS SCRIPTS FIRST if you haven't, in this order:
--    1. 2026_09_02_student_growth_career_modules.sql
--    2. 2026_09_03_school_core_udise_fees_facilities.sql
--    3. 2026_09_03_safeguarding_exams_health.sql
--
--  BEFORE YOU RUN THIS
--  -------------------
--  1. TAKE A BACKUP. phpMyAdmin: select the database, Export, Go.
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

create table `benchmark_references` (
  `id` bigint unsigned not null auto_increment primary key,
  `dimension` varchar(60) not null,
  `system_name` varchar(100) not null,
  `system_type` enum('country', 'framework') not null default 'country',
  `practice` text not null,
  `relevance` text null,
  `source_name` varchar(200) not null,
  `source_url` varchar(500) null,
  `source_year` smallint unsigned not null,
  -- Set to 1 only when a human has re-checked the citation against the
  -- original published source. The public page says "citation pending
  -- verification" while this is 0.
  `source_verified` tinyint(1) not null default '0',
  `created_at` timestamp null,
  `updated_at` timestamp null
) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;

alter table `benchmark_references` add index `benchmark_references_dimension_index`(`dimension`);
alter table `benchmark_references` add index `benchmark_references_system_name_index`(`system_name`);


-- ---------------------------------------------------------------------
--  PART 2 — MIGRATION BOOKKEEPING
--
--  Tells Laravel this migration is already applied. Safe to re-run: the
--  NOT IN guard prevents duplicates. The inner SELECTs are wrapped in
--  derived tables because MySQL restricts referencing the table being
--  written to directly in a subquery.
-- ---------------------------------------------------------------------

INSERT INTO `migrations` (`migration`, `batch`)
SELECT v.migration, b.next_batch
FROM (
  SELECT '2026_09_03_100015_create_benchmark_references_table' AS migration
) AS v
CROSS JOIN (
  SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM (SELECT `batch` FROM `migrations`) AS mb
) AS b
WHERE v.migration NOT IN (
  SELECT existing.migration FROM (SELECT `migration` FROM `migrations`) AS existing
);


-- ---------------------------------------------------------------------
--  PART 3 — REFERENCE CONTENT (run this command, not SQL)
--
--  The structural-practice rows are seeded from the application so they stay
--  in one reviewable place:
--
--      php artisan db:seed --class=BenchmarkReferenceSeeder --force
--
--  Every seeded row lands with source_verified = 0 on purpose. Before this
--  page is shown publicly, someone must check each citation against the
--  actual published source and set the flag:
--
--      UPDATE `benchmark_references` SET `source_verified` = 1 WHERE `id` = ?;
--
--  Until then the page tells readers the citations are pending verification,
--  which is the honest state — not an omission to be tidied away.
-- ---------------------------------------------------------------------
