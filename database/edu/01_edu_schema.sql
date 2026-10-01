-- Education (Laravel) database: all 74 tables + the migrations log.
-- Generated 2026-09-28 from the 65 migrations in edu/database/migrations (run on MySQL 8.4).
-- Run ONCE on an EMPTY database (phpMyAdmin -> Import). Next: 02_edu_reference_data.sql.


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_snapshots` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `scope` enum('state','national') COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_id` bigint unsigned DEFAULT NULL,
  `metrics` json NOT NULL,
  `calculated_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `analytics_snapshots_scope_scope_id_calculated_at_index` (`scope`,`scope_id`,`calculated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `anonymous_identities` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `context` enum('parent','student') COLLATE utf8mb4_unicode_ci NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `anon_identity_unique` (`user_id`,`school_id`,`context`),
  UNIQUE KEY `anonymous_identities_anonymous_ref_unique` (`anonymous_ref`),
  KEY `anonymous_identities_school_id_foreign` (`school_id`),
  CONSTRAINT `anonymous_identities_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `anonymous_identities_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `appeals` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `complaint_id` bigint unsigned NOT NULL,
  `district_id` bigint unsigned NOT NULL,
  `state_id` bigint unsigned NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('submitted','under_review','upheld','denied') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  `reviewed_by_user_id` bigint unsigned DEFAULT NULL,
  `decision_note` text COLLATE utf8mb4_unicode_ci,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `appeals_complaint_id_unique` (`complaint_id`),
  KEY `appeals_district_id_foreign` (`district_id`),
  KEY `appeals_reviewed_by_user_id_foreign` (`reviewed_by_user_id`),
  KEY `appeals_status_index` (`status`),
  KEY `appeals_state_id_status_index` (`state_id`,`status`),
  CONSTRAINT `appeals_complaint_id_foreign` FOREIGN KEY (`complaint_id`) REFERENCES `complaints` (`id`) ON DELETE CASCADE,
  CONSTRAINT `appeals_district_id_foreign` FOREIGN KEY (`district_id`) REFERENCES `districts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `appeals_reviewed_by_user_id_foreign` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `appeals_state_id_foreign` FOREIGN KEY (`state_id`) REFERENCES `states` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned DEFAULT NULL,
  `action` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `auditable_type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `auditable_id` bigint unsigned DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `audit_logs_user_id_foreign` (`user_id`),
  KEY `audit_logs_auditable_type_auditable_id_index` (`auditable_type`,`auditable_id`),
  KEY `audit_logs_action_index` (`action`),
  CONSTRAINT `audit_logs_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `benchmark_references` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `dimension` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `system_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `system_type` enum('country','framework') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'country',
  `practice` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `relevance` text COLLATE utf8mb4_unicode_ci,
  `source_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_year` smallint unsigned NOT NULL,
  `source_verified` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `benchmark_references_dimension_index` (`dimension`),
  KEY `benchmark_references_system_name_index` (`system_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cache` (
  `key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiration` bigint NOT NULL,
  PRIMARY KEY (`key`),
  KEY `cache_expiration_index` (`expiration`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cache_locks` (
  `key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiration` bigint NOT NULL,
  PRIMARY KEY (`key`),
  KEY `cache_locks_expiration_index` (`expiration`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `capability_observations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `observer_user_id` bigint unsigned NOT NULL,
  `observer_role` enum('teacher','parent','self','peer') COLLATE utf8mb4_unicode_ci NOT NULL,
  `domain` enum('cognitive_scholastic','socio_emotional','creative_co_scholastic','physical_development','life_skills') COLLATE utf8mb4_unicode_ci NOT NULL,
  `strand` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `observation_type` enum('strength','growth_area') COLLATE utf8mb4_unicode_ci NOT NULL,
  `observation` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `evidence_context` text COLLATE utf8mb4_unicode_ci,
  `academic_term` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `observed_on` date NOT NULL,
  `moderation_status` enum('approved','pending','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'approved',
  `moderated_by_user_id` bigint unsigned DEFAULT NULL,
  `moderated_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `capability_observations_moderated_by_user_id_foreign` (`moderated_by_user_id`),
  KEY `cap_obs_student_domain_date_idx` (`student_user_id`,`domain`,`observed_on`),
  KEY `cap_obs_school_term_idx` (`school_id`,`academic_term`),
  KEY `capability_observations_observer_user_id_index` (`observer_user_id`),
  CONSTRAINT `capability_observations_moderated_by_user_id_foreign` FOREIGN KEY (`moderated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `capability_observations_observer_user_id_foreign` FOREIGN KEY (`observer_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `capability_observations_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `capability_observations_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `career_interest_profiles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `captured_by_user_id` bigint unsigned NOT NULL,
  `academic_term` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `interest_areas` json NOT NULL,
  `enjoyed_activities` json DEFAULT NULL,
  `reflection` text COLLATE utf8mb4_unicode_ci,
  `captured_on` date NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `career_interest_profiles_captured_by_user_id_foreign` (`captured_by_user_id`),
  KEY `career_profile_student_date_idx` (`student_user_id`,`captured_on`),
  CONSTRAINT `career_interest_profiles_captured_by_user_id_foreign` FOREIGN KEY (`captured_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `career_interest_profiles_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `coaching_programmes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `programme_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `programme_type` enum('jee','neet','cuet','clat','nda','olympiad','scholarship','coding','robotics','languages','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `provider_type` enum('school','external_partner') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'school',
  `provider_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `applicable_classes` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `faculty` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `duration` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timing` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `during_school_hours` tinyint(1) NOT NULL DEFAULT '0',
  `fee` decimal(12,2) DEFAULT NULL,
  `bundled_into_school_fees` tinyint(1) NOT NULL DEFAULT '0',
  `is_mandatory` tinyint(1) NOT NULL DEFAULT '0',
  `certification_offered` tinyint(1) NOT NULL DEFAULT '0',
  `recorded_by_user_id` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `coaching_programmes_recorded_by_user_id_foreign` (`recorded_by_user_id`),
  KEY `coaching_school_year_idx` (`school_id`,`academic_year`),
  CONSTRAINT `coaching_programmes_recorded_by_user_id_foreign` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `coaching_programmes_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `complaint_categories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_child_safety` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `complaint_categories_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `complaint_evidence` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `complaint_id` bigint unsigned NOT NULL,
  `uploaded_by` enum('submitter','school') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitter',
  `original_filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stored_filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `size_bytes` bigint unsigned NOT NULL,
  `disk` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'local',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `complaint_evidence_complaint_id_foreign` (`complaint_id`),
  CONSTRAINT `complaint_evidence_complaint_id_foreign` FOREIGN KEY (`complaint_id`) REFERENCES `complaints` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `complaint_resolutions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `complaint_id` bigint unsigned NOT NULL,
  `resolution_summary` text COLLATE utf8mb4_unicode_ci,
  `confirmed_by_submitter` enum('pending','yes','partially','no') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `confirmed_at` timestamp NULL DEFAULT NULL,
  `escalated` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `complaint_resolutions_complaint_id_unique` (`complaint_id`),
  CONSTRAINT `complaint_resolutions_complaint_id_foreign` FOREIGN KEY (`complaint_id`) REFERENCES `complaints` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `complaint_responses` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `complaint_id` bigint unsigned NOT NULL,
  `responder_type` enum('school','district','state') COLLATE utf8mb4_unicode_ci NOT NULL,
  `responder_user_id` bigint unsigned DEFAULT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `complaint_responses_complaint_id_foreign` (`complaint_id`),
  KEY `complaint_responses_responder_user_id_foreign` (`responder_user_id`),
  CONSTRAINT `complaint_responses_complaint_id_foreign` FOREIGN KEY (`complaint_id`) REFERENCES `complaints` (`id`) ON DELETE CASCADE,
  CONSTRAINT `complaint_responses_responder_user_id_foreign` FOREIGN KEY (`responder_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `complaint_status_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `complaint_id` bigint unsigned NOT NULL,
  `from_status` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_status` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `changed_by_user_id` bigint unsigned DEFAULT NULL,
  `note` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `complaint_status_history_complaint_id_foreign` (`complaint_id`),
  KEY `complaint_status_history_changed_by_user_id_foreign` (`changed_by_user_id`),
  CONSTRAINT `complaint_status_history_changed_by_user_id_foreign` FOREIGN KEY (`changed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `complaint_status_history_complaint_id_foreign` FOREIGN KEY (`complaint_id`) REFERENCES `complaints` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `complaints` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `complaint_number` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `complaint_category_id` bigint unsigned NOT NULL,
  `district_id` bigint unsigned NOT NULL,
  `state_id` bigint unsigned NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `submitted_role` enum('parent','student') COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` enum('low','medium','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `status` enum('submitted','under_review','school_responded','escalated','investigating','action_taken','resolved','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  `is_child_safety_flag` tinyint(1) NOT NULL DEFAULT '0',
  `resolved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `complaints_complaint_number_unique` (`complaint_number`),
  KEY `complaints_complaint_category_id_foreign` (`complaint_category_id`),
  KEY `complaints_state_id_foreign` (`state_id`),
  KEY `complaints_status_index` (`status`),
  KEY `complaints_anonymous_ref_index` (`anonymous_ref`),
  KEY `complaints_school_id_status_index` (`school_id`,`status`),
  KEY `complaints_district_id_status_index` (`district_id`,`status`),
  CONSTRAINT `complaints_complaint_category_id_foreign` FOREIGN KEY (`complaint_category_id`) REFERENCES `complaint_categories` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `complaints_district_id_foreign` FOREIGN KEY (`district_id`) REFERENCES `districts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `complaints_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `complaints_state_id_foreign` FOREIGN KEY (`state_id`) REFERENCES `states` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `consent_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `granted_by_user_id` bigint unsigned NOT NULL,
  `purpose` enum('capability_growth','career_pathway','life_skills','physical_health','mental_wellbeing','alumni_outcomes') COLLATE utf8mb4_unicode_ci NOT NULL,
  `notice_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `notice_version` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('granted','withdrawn','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'granted',
  `verification_method` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `granted_at` timestamp NOT NULL,
  `withdrawn_at` timestamp NULL DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `consent_student_purpose_status_idx` (`student_user_id`,`purpose`,`status`),
  KEY `consent_records_granted_by_user_id_index` (`granted_by_user_id`),
  CONSTRAINT `consent_records_granted_by_user_id_foreign` FOREIGN KEY (`granted_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `consent_records_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `counselling_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `wellbeing_concern_id` bigint unsigned DEFAULT NULL,
  `session_date` date NOT NULL,
  `session_type` enum('initial','follow_up','group','parent_meeting','crisis','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'follow_up',
  `session_notes` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `shareable_summary` text COLLATE utf8mb4_unicode_ci,
  `support_plan` text COLLATE utf8mb4_unicode_ci,
  `interventions` text COLLATE utf8mb4_unicode_ci,
  `referred_externally` tinyint(1) NOT NULL DEFAULT '0',
  `referral_detail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `next_session_date` date DEFAULT NULL,
  `counsellor_user_id` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `counselling_sessions_school_id_foreign` (`school_id`),
  KEY `counselling_sessions_wellbeing_concern_id_foreign` (`wellbeing_concern_id`),
  KEY `counselling_student_date_idx` (`student_user_id`,`session_date`),
  KEY `counselling_counsellor_date_idx` (`counsellor_user_id`,`session_date`),
  CONSTRAINT `counselling_sessions_counsellor_user_id_foreign` FOREIGN KEY (`counsellor_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `counselling_sessions_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `counselling_sessions_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `counselling_sessions_wellbeing_concern_id_foreign` FOREIGN KEY (`wellbeing_concern_id`) REFERENCES `wellbeing_concerns` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_ratings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `course_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rater_role` enum('parent','student') COLLATE utf8mb4_unicode_ci NOT NULL,
  `curriculum_relevance` tinyint unsigned DEFAULT NULL,
  `course_quality` tinyint unsigned DEFAULT NULL,
  `conceptual_learning` tinyint unsigned DEFAULT NULL,
  `practical_learning` tinyint unsigned DEFAULT NULL,
  `project_work` tinyint unsigned DEFAULT NULL,
  `learning_resources` tinyint unsigned DEFAULT NULL,
  `teaching_quality` tinyint unsigned DEFAULT NULL,
  `course_organisation` tinyint unsigned DEFAULT NULL,
  `engagement` tinyint unsigned DEFAULT NULL,
  `career_relevance` tinyint unsigned DEFAULT NULL,
  `comment` text COLLATE utf8mb4_unicode_ci,
  `submitted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `course_rating_unique` (`course_id`,`academic_year`,`anonymous_ref`),
  KEY `course_ratings_school_year_idx` (`school_id`,`academic_year`),
  CONSTRAINT `course_ratings_course_id_foreign` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `course_ratings_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `courses` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `course_type` enum('core_subject','elective','stream','vocational','language','programme','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'core_subject',
  `applicable_classes` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stream` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `recorded_by_user_id` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `course_unique_per_year` (`school_id`,`academic_year`,`name`),
  KEY `courses_recorded_by_user_id_foreign` (`recorded_by_user_id`),
  KEY `courses_school_year_idx` (`school_id`,`academic_year`),
  CONSTRAINT `courses_recorded_by_user_id_foreign` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `courses_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_subject_requests` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `reference` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `requester_user_id` bigint unsigned NOT NULL,
  `subject_user_id` bigint unsigned NOT NULL,
  `request_type` enum('access','correction','erasure') COLLATE utf8mb4_unicode_ci NOT NULL,
  `categories` json NOT NULL,
  `detail` text COLLATE utf8mb4_unicode_ci,
  `status` enum('submitted','under_review','completed','partially_completed','refused') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  `outcome_by_category` json DEFAULT NULL,
  `response_note` text COLLATE utf8mb4_unicode_ci,
  `handled_by_user_id` bigint unsigned DEFAULT NULL,
  `handled_at` timestamp NULL DEFAULT NULL,
  `due_by` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `data_subject_requests_reference_unique` (`reference`),
  KEY `data_subject_requests_requester_user_id_foreign` (`requester_user_id`),
  KEY `data_subject_requests_handled_by_user_id_foreign` (`handled_by_user_id`),
  KEY `data_subject_requests_status_index` (`status`),
  KEY `dsr_subject_created_idx` (`subject_user_id`,`created_at`),
  KEY `data_subject_requests_due_by_index` (`due_by`),
  CONSTRAINT `data_subject_requests_handled_by_user_id_foreign` FOREIGN KEY (`handled_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `data_subject_requests_requester_user_id_foreign` FOREIGN KEY (`requester_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `data_subject_requests_subject_user_id_foreign` FOREIGN KEY (`subject_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `districts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `state_id` bigint unsigned NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `districts_state_id_name_unique` (`state_id`,`name`),
  CONSTRAINT `districts_state_id_foreign` FOREIGN KEY (`state_id`) REFERENCES `states` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `external_exams` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `exam_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `conducting_body` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exam_type` enum('olympiad','scholarship','competitive','entrance','international','language','skill_certification','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `applicable_classes` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `eligibility` text COLLATE utf8mb4_unicode_ci,
  `registration_process` text COLLATE utf8mb4_unicode_ci,
  `through_school` tinyint(1) NOT NULL DEFAULT '1',
  `exam_fee` decimal(12,2) DEFAULT NULL,
  `preparation_offered` tinyint(1) NOT NULL DEFAULT '0',
  `preparation_fee` decimal(12,2) DEFAULT NULL,
  `is_mandatory` tinyint(1) NOT NULL DEFAULT '0',
  `frequency` enum('annual','biannual','termly','one_off') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'annual',
  `recorded_by_user_id` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `external_exams_recorded_by_user_id_foreign` (`recorded_by_user_id`),
  KEY `external_exams_school_year_idx` (`school_id`,`academic_year`),
  CONSTRAINT `external_exams_recorded_by_user_id_foreign` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `external_exams_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `facility_claims` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `facility_key` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_offered` tinyint(1) NOT NULL DEFAULT '1',
  `description` text COLLATE utf8mb4_unicode_ci,
  `applicable_classes` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `availability` enum('all_students','selected_classes','optional_enrolment','limited') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'all_students',
  `capacity` int unsigned DEFAULT NULL,
  `fee_amount` decimal(12,2) DEFAULT NULL,
  `is_mandatory` tinyint(1) NOT NULL DEFAULT '0',
  `provider` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `evidence_path` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `evidence_note` text COLLATE utf8mb4_unicode_ci,
  `verification_status` enum('unverified','pending','verified') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unverified',
  `verified_by_user_id` bigint unsigned DEFAULT NULL,
  `verified_at` timestamp NULL DEFAULT NULL,
  `recorded_by_user_id` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `facility_claim_unique` (`school_id`,`facility_key`,`academic_year`),
  KEY `facility_claims_verified_by_user_id_foreign` (`verified_by_user_id`),
  KEY `facility_claims_recorded_by_user_id_foreign` (`recorded_by_user_id`),
  KEY `facility_claims_school_year_idx` (`school_id`,`academic_year`),
  CONSTRAINT `facility_claims_recorded_by_user_id_foreign` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `facility_claims_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `facility_claims_verified_by_user_id_foreign` FOREIGN KEY (`verified_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `facility_ratings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `facility_key` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rater_role` enum('parent','student') COLLATE utf8mb4_unicode_ci NOT NULL,
  `availability_report` enum('available','partially_available','not_available') COLLATE utf8mb4_unicode_ci NOT NULL,
  `quality` tinyint unsigned DEFAULT NULL,
  `equipment` tinyint unsigned DEFAULT NULL,
  `usage_frequency` tinyint unsigned DEFAULT NULL,
  `staff_support` tinyint unsigned DEFAULT NULL,
  `overall_usefulness` tinyint unsigned DEFAULT NULL,
  `comment` text COLLATE utf8mb4_unicode_ci,
  `submitted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `facility_rating_unique` (`school_id`,`facility_key`,`academic_year`,`anonymous_ref`),
  KEY `facility_ratings_lookup_idx` (`school_id`,`facility_key`,`academic_year`),
  CONSTRAINT `facility_ratings_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `failed_jobs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `uuid` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `connection` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `queue` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `exception` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `failed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `failed_jobs_uuid_unique` (`uuid`),
  KEY `failed_jobs_connection_queue_failed_at_index` (`connection`,`queue`,`failed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fee_revisions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `fee_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `changed_by_user_id` bigint unsigned NOT NULL,
  `previous_amount` decimal(12,2) NOT NULL,
  `new_amount` decimal(12,2) NOT NULL,
  `previous_snapshot` json NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `changed_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fee_revisions_changed_by_user_id_foreign` (`changed_by_user_id`),
  KEY `fee_revisions_school_date_idx` (`school_id`,`changed_at`),
  KEY `fee_revisions_fee_id_index` (`fee_id`),
  CONSTRAINT `fee_revisions_changed_by_user_id_foreign` FOREIGN KEY (`changed_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fee_revisions_fee_id_foreign` FOREIGN KEY (`fee_id`) REFERENCES `fees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fee_revisions_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fees` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `class_grade` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stream` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` enum('admission','registration','tuition','annual','development','term','examination','assessment','laboratory','computer','library','sports','activity','transport','hostel','meals','books','uniform','id_card','diary','field_trips','competitions','external_exam','certification','coaching','other') COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `frequency` enum('one_time','monthly','quarterly','term','annual') COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_mandatory` tinyint(1) NOT NULL DEFAULT '1',
  `is_refundable` tinyint(1) NOT NULL DEFAULT '0',
  `conditions` text COLLATE utf8mb4_unicode_ci,
  `effective_from` date NOT NULL,
  `state_cap_status` enum('not_applicable','within_cap','pending_review','exceeds_cap') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_applicable',
  `recorded_by_user_id` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fees_recorded_by_user_id_foreign` (`recorded_by_user_id`),
  KEY `fees_school_year_idx` (`school_id`,`academic_year`),
  KEY `fees_school_year_class_idx` (`school_id`,`academic_year`,`class_grade`),
  CONSTRAINT `fees_recorded_by_user_id_foreign` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fees_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fraud_flags` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `flag_type` enum('feedback_spike','coordinated_review','duplicate_pattern','other') COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject_type` enum('school','teacher') COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject_id` bigint unsigned NOT NULL,
  `details` json DEFAULT NULL,
  `status` enum('open','reviewing','dismissed','confirmed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `reviewed_by_user_id` bigint unsigned DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fraud_flags_reviewed_by_user_id_foreign` (`reviewed_by_user_id`),
  KEY `fraud_flags_subject_type_subject_id_index` (`subject_type`,`subject_id`),
  KEY `fraud_flags_status_index` (`status`),
  CONSTRAINT `fraud_flags_reviewed_by_user_id_foreign` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `growth_goals` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `growth_plan_id` bigint unsigned NOT NULL,
  `domain` enum('cognitive_scholastic','socio_emotional','creative_co_scholastic','physical_development','life_skills') COLLATE utf8mb4_unicode_ci NOT NULL,
  `goal_statement` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `support_at_school` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `support_at_home` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `student_voice` text COLLATE utf8mb4_unicode_ci,
  `status` enum('set','in_progress','achieved','continuing') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'set',
  `review_note` text COLLATE utf8mb4_unicode_ci,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `growth_goals_growth_plan_id_index` (`growth_plan_id`),
  CONSTRAINT `growth_goals_growth_plan_id_foreign` FOREIGN KEY (`growth_plan_id`) REFERENCES `growth_plans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `growth_plans` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `created_by_user_id` bigint unsigned NOT NULL,
  `academic_term` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('draft','active','completed','archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `summary_for_parent` text COLLATE utf8mb4_unicode_ci,
  `shared_with_parent_at` timestamp NULL DEFAULT NULL,
  `parent_acknowledged_at` timestamp NULL DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `growth_plan_student_term_unique` (`student_user_id`,`school_id`,`academic_term`),
  KEY `growth_plans_created_by_user_id_foreign` (`created_by_user_id`),
  KEY `growth_plan_school_status_idx` (`school_id`,`status`),
  CONSTRAINT `growth_plans_created_by_user_id_foreign` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `growth_plans_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `growth_plans_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `health_access_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `actor_user_id` bigint unsigned NOT NULL,
  `actor_role` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `record_type` enum('physical_health','wellbeing_concern','counselling_session','followup') COLLATE utf8mb4_unicode_ci NOT NULL,
  `record_id` bigint unsigned DEFAULT NULL,
  `action` enum('viewed','created','updated','downloaded','denied') COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `occurred_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `health_logs_student_time_idx` (`student_user_id`,`occurred_at`),
  KEY `health_logs_actor_time_idx` (`actor_user_id`,`occurred_at`),
  KEY `health_access_logs_action_index` (`action`),
  CONSTRAINT `health_access_logs_actor_user_id_foreign` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `health_access_logs_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `health_followups` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `physical_health_record_id` bigint unsigned DEFAULT NULL,
  `area` enum('vision','hearing','dental','nutrition','general','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'general',
  `finding` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `recommended_action` text COLLATE utf8mb4_unicode_ci,
  `status` enum('identified','referred','follow_up','completed','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'identified',
  `identified_on` date NOT NULL,
  `due_on` date DEFAULT NULL,
  `completed_on` date DEFAULT NULL,
  `outcome` text COLLATE utf8mb4_unicode_ci,
  `opened_by_user_id` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `health_followups_physical_health_record_id_foreign` (`physical_health_record_id`),
  KEY `health_followups_opened_by_user_id_foreign` (`opened_by_user_id`),
  KEY `followups_student_status_idx` (`student_user_id`,`status`),
  KEY `followups_school_status_idx` (`school_id`,`status`),
  KEY `health_followups_due_on_index` (`due_on`),
  CONSTRAINT `health_followups_opened_by_user_id_foreign` FOREIGN KEY (`opened_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `health_followups_physical_health_record_id_foreign` FOREIGN KEY (`physical_health_record_id`) REFERENCES `physical_health_records` (`id`) ON DELETE SET NULL,
  CONSTRAINT `health_followups_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `health_followups_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `identity_access_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `officer_user_id` bigint unsigned NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `identity_access_logs_anonymous_ref_index` (`anonymous_ref`),
  KEY `identity_access_logs_officer_user_id_index` (`officer_user_id`),
  CONSTRAINT `identity_access_logs_officer_user_id_foreign` FOREIGN KEY (`officer_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invitations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `invited_by_user_id` bigint unsigned NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('parent','student','teacher') COLLATE utf8mb4_unicode_ci NOT NULL,
  `student_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `token` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','accepted','revoked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `accepted_by_user_id` bigint unsigned DEFAULT NULL,
  `accepted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invitations_token_unique` (`token`),
  KEY `invitations_invited_by_user_id_foreign` (`invited_by_user_id`),
  KEY `invitations_accepted_by_user_id_foreign` (`accepted_by_user_id`),
  KEY `invitations_school_id_status_index` (`school_id`,`status`),
  CONSTRAINT `invitations_accepted_by_user_id_foreign` FOREIGN KEY (`accepted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `invitations_invited_by_user_id_foreign` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `invitations_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_batches` (
  `id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_jobs` int NOT NULL,
  `pending_jobs` int NOT NULL,
  `failed_jobs` int NOT NULL,
  `failed_job_ids` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `options` mediumtext COLLATE utf8mb4_unicode_ci,
  `cancelled_at` int DEFAULT NULL,
  `created_at` int NOT NULL,
  `finished_at` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `jobs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `queue` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `attempts` smallint unsigned NOT NULL,
  `reserved_at` int unsigned DEFAULT NULL,
  `available_at` int unsigned NOT NULL,
  `created_at` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  KEY `jobs_queue_index` (`queue`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `life_skills_tracking` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `recorded_by_user_id` bigint unsigned NOT NULL,
  `skill_area` enum('financial_literacy','digital_literacy_safety','civic_citizenship','communication','leadership','critical_thinking','emotional_intelligence','environmental_awareness') COLLATE utf8mb4_unicode_ci NOT NULL,
  `activity_title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activity_description` text COLLATE utf8mb4_unicode_ci,
  `participation_level` enum('participated','engaged','led') COLLATE utf8mb4_unicode_ci NOT NULL,
  `academic_term` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recorded_on` date NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `life_skills_tracking_recorded_by_user_id_foreign` (`recorded_by_user_id`),
  KEY `life_skills_student_area_idx` (`student_user_id`,`skill_area`),
  KEY `life_skills_school_term_idx` (`school_id`,`academic_term`),
  CONSTRAINT `life_skills_tracking_recorded_by_user_id_foreign` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `life_skills_tracking_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `life_skills_tracking_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `migrations` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `migration` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=66 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `model_has_permissions` (
  `permission_id` bigint unsigned NOT NULL,
  `model_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model_id` bigint unsigned NOT NULL,
  PRIMARY KEY (`permission_id`,`model_id`,`model_type`),
  KEY `model_has_permissions_model_id_model_type_index` (`model_id`,`model_type`),
  CONSTRAINT `model_has_permissions_permission_id_foreign` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `model_has_roles` (
  `role_id` bigint unsigned NOT NULL,
  `model_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model_id` bigint unsigned NOT NULL,
  PRIMARY KEY (`role_id`,`model_id`,`model_type`),
  KEY `model_has_roles_model_id_model_type_index` (`model_id`,`model_type`),
  CONSTRAINT `model_has_roles_role_id_foreign` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `notifiable_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `notifiable_id` bigint unsigned NOT NULL,
  `data` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `read_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `notifications_notifiable_type_notifiable_id_index` (`notifiable_type`,`notifiable_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `officer_jurisdictions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `level` enum('district','state','national') COLLATE utf8mb4_unicode_ci NOT NULL,
  `district_id` bigint unsigned DEFAULT NULL,
  `state_id` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `officer_jurisdiction_unique` (`user_id`,`level`,`district_id`,`state_id`),
  KEY `officer_jurisdictions_district_id_foreign` (`district_id`),
  KEY `officer_jurisdictions_state_id_foreign` (`state_id`),
  CONSTRAINT `officer_jurisdictions_district_id_foreign` FOREIGN KEY (`district_id`) REFERENCES `districts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `officer_jurisdictions_state_id_foreign` FOREIGN KEY (`state_id`) REFERENCES `states` (`id`) ON DELETE CASCADE,
  CONSTRAINT `officer_jurisdictions_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `parent_profiles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verified_at` timestamp NULL DEFAULT NULL,
  `verification_method` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `parent_profiles_user_id_unique` (`user_id`),
  CONSTRAINT `parent_profiles_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `parent_school_relationships` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `student_user_id` bigint unsigned DEFAULT NULL,
  `status` enum('pending','verified','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `verified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `parent_school_rel_unique` (`user_id`,`school_id`,`student_user_id`),
  KEY `parent_school_relationships_school_id_foreign` (`school_id`),
  KEY `parent_school_relationships_student_user_id_foreign` (`student_user_id`),
  CONSTRAINT `parent_school_relationships_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `parent_school_relationships_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `parent_school_relationships_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_tokens` (
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `permissions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `guard_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `permissions_name_guard_name_unique` (`name`,`guard_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `physical_health_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `examination_date` date NOT NULL,
  `examination_type` enum('annual_screening','follow_up','incident','immunisation','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'annual_screening',
  `height_cm` decimal(5,1) DEFAULT NULL,
  `weight_kg` decimal(5,1) DEFAULT NULL,
  `bmi` decimal(4,1) DEFAULT NULL,
  `vision_left` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vision_right` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hearing` enum('normal','concern_noted','not_tested') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dental` enum('normal','concern_noted','not_tested') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `general_examination` text COLLATE utf8mb4_unicode_ci,
  `nutrition_observations` text COLLATE utf8mb4_unicode_ci,
  `health_concerns` text COLLATE utf8mb4_unicode_ci,
  `recommendations` text COLLATE utf8mb4_unicode_ci,
  `next_due_date` date DEFAULT NULL,
  `recorded_by_user_id` bigint unsigned NOT NULL,
  `recorded_by_designation` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `physical_health_records_recorded_by_user_id_foreign` (`recorded_by_user_id`),
  KEY `health_student_date_idx` (`student_user_id`,`examination_date`),
  KEY `health_school_year_idx` (`school_id`,`academic_year`),
  CONSTRAINT `physical_health_records_recorded_by_user_id_foreign` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `physical_health_records_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `physical_health_records_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `retaliation_reports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `complaint_id` bigint unsigned DEFAULT NULL,
  `school_id` bigint unsigned NOT NULL,
  `district_id` bigint unsigned NOT NULL,
  `state_id` bigint unsigned NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `submitted_role` enum('parent','student') COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('intimidation','harassment','discrimination','punishment','academic_retaliation','threats','withdrawal_of_facilities','other') COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('submitted','under_review','investigating','action_taken','resolved','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  `resolved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `retaliation_reports_complaint_id_foreign` (`complaint_id`),
  KEY `retaliation_reports_school_id_foreign` (`school_id`),
  KEY `retaliation_reports_state_id_foreign` (`state_id`),
  KEY `retaliation_reports_status_index` (`status`),
  KEY `retaliation_reports_anonymous_ref_index` (`anonymous_ref`),
  KEY `retaliation_reports_district_id_status_index` (`district_id`,`status`),
  CONSTRAINT `retaliation_reports_complaint_id_foreign` FOREIGN KEY (`complaint_id`) REFERENCES `complaints` (`id`) ON DELETE SET NULL,
  CONSTRAINT `retaliation_reports_district_id_foreign` FOREIGN KEY (`district_id`) REFERENCES `districts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `retaliation_reports_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `retaliation_reports_state_id_foreign` FOREIGN KEY (`state_id`) REFERENCES `states` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_has_permissions` (
  `permission_id` bigint unsigned NOT NULL,
  `role_id` bigint unsigned NOT NULL,
  PRIMARY KEY (`permission_id`,`role_id`),
  KEY `role_has_permissions_role_id_foreign` (`role_id`),
  CONSTRAINT `role_has_permissions_permission_id_foreign` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `role_has_permissions_role_id_foreign` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `guard_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `roles_name_guard_name_unique` (`name`,`guard_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `safeguarding_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `safeguarding_report_id` bigint unsigned NOT NULL,
  `event_type` enum('submitted','legal_duty_shown','acknowledged','assigned','external_report_recorded','investigation_started','note_added','closed','reopened','viewed') COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_user_id` bigint unsigned DEFAULT NULL,
  `actor_role` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail` text COLLATE utf8mb4_unicode_ci,
  `occurred_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `safeguarding_events_actor_user_id_foreign` (`actor_user_id`),
  KEY `safeguarding_events_case_time_idx` (`safeguarding_report_id`,`occurred_at`),
  CONSTRAINT `safeguarding_events_actor_user_id_foreign` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `safeguarding_events_safeguarding_report_id_foreign` FOREIGN KEY (`safeguarding_report_id`) REFERENCES `safeguarding_reports` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `safeguarding_reports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `reference` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `district_id` bigint unsigned NOT NULL,
  `state_id` bigint unsigned NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reporter_role` enum('parent','student','teacher','staff','other') COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('child_sexual_abuse','physical_abuse','emotional_abuse','neglect','serious_violence','immediate_danger','serious_harassment','criminal_allegation','other_serious_concern') COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `immediate_danger` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('submitted','acknowledged','external_report_confirmed','under_investigation','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  `legal_duty_shown_at` timestamp NULL DEFAULT NULL,
  `external_report_acknowledged_at` timestamp NULL DEFAULT NULL,
  `external_report_acknowledged_by` bigint unsigned DEFAULT NULL,
  `external_report_channel` enum('police','sjpu','childline_1098','cwc','other') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `external_report_reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `assigned_officer_user_id` bigint unsigned DEFAULT NULL,
  `acknowledged_at` timestamp NULL DEFAULT NULL,
  `closed_at` timestamp NULL DEFAULT NULL,
  `closed_by_user_id` bigint unsigned DEFAULT NULL,
  `closure_reason` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `safeguarding_reports_reference_unique` (`reference`),
  KEY `safeguarding_reports_state_id_foreign` (`state_id`),
  KEY `safeguarding_reports_external_report_acknowledged_by_foreign` (`external_report_acknowledged_by`),
  KEY `safeguarding_reports_assigned_officer_user_id_foreign` (`assigned_officer_user_id`),
  KEY `safeguarding_reports_closed_by_user_id_foreign` (`closed_by_user_id`),
  KEY `safeguarding_reports_status_index` (`status`),
  KEY `safeguarding_reports_anonymous_ref_index` (`anonymous_ref`),
  KEY `safeguarding_reports_school_id_status_index` (`school_id`,`status`),
  KEY `safeguarding_reports_district_id_status_index` (`district_id`,`status`),
  CONSTRAINT `safeguarding_reports_assigned_officer_user_id_foreign` FOREIGN KEY (`assigned_officer_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `safeguarding_reports_closed_by_user_id_foreign` FOREIGN KEY (`closed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `safeguarding_reports_district_id_foreign` FOREIGN KEY (`district_id`) REFERENCES `districts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `safeguarding_reports_external_report_acknowledged_by_foreign` FOREIGN KEY (`external_report_acknowledged_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `safeguarding_reports_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `safeguarding_reports_state_id_foreign` FOREIGN KEY (`state_id`) REFERENCES `states` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `school_feedback` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rater_role` enum('parent','student') COLLATE utf8mb4_unicode_ci NOT NULL,
  `dimension_scores` json NOT NULL,
  `overall_comment` text COLLATE utf8mb4_unicode_ci,
  `submitted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `school_feedback_school_id_submitted_at_index` (`school_id`,`submitted_at`),
  KEY `school_feedback_anonymous_ref_index` (`anonymous_ref`),
  CONSTRAINT `school_feedback_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `school_profiles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `about` text COLLATE utf8mb4_unicode_ci,
  `facilities` json DEFAULT NULL,
  `sports` json DEFAULT NULL,
  `fees` json DEFAULT NULL,
  `policies` text COLLATE utf8mb4_unicode_ci,
  `has_transport` tinyint(1) NOT NULL DEFAULT '0',
  `has_hostel` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `school_profiles_school_id_unique` (`school_id`),
  CONSTRAINT `school_profiles_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `school_quality_scores` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `score` decimal(5,2) NOT NULL,
  `confidence` enum('high','medium','low','insufficient_data') COLLATE utf8mb4_unicode_ci NOT NULL,
  `response_count` int unsigned NOT NULL,
  `component_breakdown` json NOT NULL,
  `calculated_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `school_quality_scores_school_id_calculated_at_index` (`school_id`,`calculated_at`),
  CONSTRAINT `school_quality_scores_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `school_rating_components` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `key` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `weight` decimal(5,2) NOT NULL DEFAULT '10.00',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `school_rating_components_key_unique` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `school_replies` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint unsigned NOT NULL,
  `context_type` enum('facility_discrepancy','course_feedback','general_feedback') COLLATE utf8mb4_unicode_ci NOT NULL,
  `context_key` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_user_id` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `school_replies_author_user_id_foreign` (`author_user_id`),
  KEY `school_replies_school_year_idx` (`school_id`,`academic_year`),
  KEY `school_replies_context_idx` (`school_id`,`context_type`,`context_key`),
  CONSTRAINT `school_replies_author_user_id_foreign` FOREIGN KEY (`author_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `school_replies_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `school_staff` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `designation` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'School Admin',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `school_staff_user_id_school_id_unique` (`user_id`,`school_id`),
  KEY `school_staff_school_id_foreign` (`school_id`),
  CONSTRAINT `school_staff_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `school_staff_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schools` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_code` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `udise_code` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `udise_verified_at` timestamp NULL DEFAULT NULL,
  `udise_verified_by_user_id` bigint unsigned DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `board` enum('CBSE','ICSE','STATE','IB','OTHER') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STATE',
  `management_type` enum('government','aided','private','international') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'private',
  `state_id` bigint unsigned NOT NULL,
  `district_id` bigint unsigned NOT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `city` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pincode` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `website` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recognition_status` enum('verified','pending','under_review') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `classes_from` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `classes_to` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `student_count` int unsigned NOT NULL DEFAULT '0',
  `teacher_count` int unsigned NOT NULL DEFAULT '0',
  `established_year` smallint unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `schools_school_code_unique` (`school_code`),
  UNIQUE KEY `schools_udise_code_unique` (`udise_code`),
  KEY `schools_district_id_foreign` (`district_id`),
  KEY `schools_state_id_district_id_index` (`state_id`,`district_id`),
  KEY `schools_name_index` (`name`),
  KEY `schools_pincode_index` (`pincode`),
  KEY `schools_board_index` (`board`),
  KEY `schools_udise_verified_by_user_id_foreign` (`udise_verified_by_user_id`),
  CONSTRAINT `schools_district_id_foreign` FOREIGN KEY (`district_id`) REFERENCES `districts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `schools_state_id_foreign` FOREIGN KEY (`state_id`) REFERENCES `states` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `schools_udise_verified_by_user_id_foreign` FOREIGN KEY (`udise_verified_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions` (
  `id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` bigint unsigned DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text COLLATE utf8mb4_unicode_ci,
  `payload` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_activity` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `sessions_user_id_index` (`user_id`),
  KEY `sessions_last_activity_index` (`last_activity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `settings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `settings_key_unique` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `states` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `states_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `student_academic_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `subject` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `term` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` decimal(6,2) NOT NULL,
  `max_score` decimal(6,2) NOT NULL DEFAULT '100.00',
  `recorded_by_user_id` bigint unsigned NOT NULL,
  `recorded_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `student_academic_records_recorded_by_user_id_foreign` (`recorded_by_user_id`),
  KEY `student_academic_records_student_user_id_subject_index` (`student_user_id`,`subject`),
  KEY `student_academic_records_school_id_subject_term_index` (`school_id`,`subject`,`term`),
  CONSTRAINT `student_academic_records_recorded_by_user_id_foreign` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `student_academic_records_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `student_academic_records_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `student_profiles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `gender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verified_at` timestamp NULL DEFAULT NULL,
  `verification_method` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `student_profiles_user_id_unique` (`user_id`),
  CONSTRAINT `student_profiles_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `student_school_relationships` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `class_grade` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','verified','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `verified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `student_school_relationships_user_id_school_id_unique` (`user_id`,`school_id`),
  KEY `student_school_relationships_school_id_foreign` (`school_id`),
  CONSTRAINT `student_school_relationships_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `student_school_relationships_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teacher_effectiveness_scores` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `teacher_user_id` bigint unsigned NOT NULL,
  `score` decimal(5,2) NOT NULL,
  `confidence` enum('high','medium','low','insufficient_data') COLLATE utf8mb4_unicode_ci NOT NULL,
  `response_count` int unsigned NOT NULL,
  `component_breakdown` json NOT NULL,
  `calculated_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `teacher_effectiveness_scores_teacher_user_id_calculated_at_index` (`teacher_user_id`,`calculated_at`),
  CONSTRAINT `teacher_effectiveness_scores_teacher_user_id_foreign` FOREIGN KEY (`teacher_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teacher_feedback` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `teacher_user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `anonymous_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rater_role` enum('parent','student') COLLATE utf8mb4_unicode_ci NOT NULL,
  `dimension_scores` json NOT NULL,
  `overall_comment` text COLLATE utf8mb4_unicode_ci,
  `submitted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `teacher_feedback_school_id_foreign` (`school_id`),
  KEY `teacher_feedback_teacher_user_id_submitted_at_index` (`teacher_user_id`,`submitted_at`),
  KEY `teacher_feedback_anonymous_ref_index` (`anonymous_ref`),
  CONSTRAINT `teacher_feedback_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `teacher_feedback_teacher_user_id_foreign` FOREIGN KEY (`teacher_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teacher_profiles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `subject_specialization` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qualification` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `joining_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `teacher_profiles_user_id_unique` (`user_id`),
  CONSTRAINT `teacher_profiles_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teacher_rating_components` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `key` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `weight` decimal(5,2) NOT NULL DEFAULT '10.00',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `teacher_rating_components_key_unique` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teacher_school_relationships` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `status` enum('pending','verified','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `verified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `teacher_school_relationships_user_id_school_id_unique` (`user_id`,`school_id`),
  KEY `teacher_school_relationships_school_id_foreign` (`school_id`),
  CONSTRAINT `teacher_school_relationships_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `teacher_school_relationships_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `two_factor_authentications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `secret` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `recovery_codes` text COLLATE utf8mb4_unicode_ci,
  `confirmed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `two_factor_authentications_user_id_unique` (`user_id`),
  CONSTRAINT `two_factor_authentications_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email_verified_at` timestamp NULL DEFAULT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `remember_token` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wellbeing_concerns` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `student_user_id` bigint unsigned NOT NULL,
  `school_id` bigint unsigned NOT NULL,
  `observation` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `context` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `observed_on` date NOT NULL,
  `raised_by_user_id` bigint unsigned NOT NULL,
  `raised_by_role` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `referral_status` enum('raised','seen_by_counsellor','closed_without_referral') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'raised',
  `seen_at` timestamp NULL DEFAULT NULL,
  `seen_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `wellbeing_concerns_raised_by_user_id_foreign` (`raised_by_user_id`),
  KEY `wellbeing_concerns_seen_by_user_id_foreign` (`seen_by_user_id`),
  KEY `wellbeing_student_date_idx` (`student_user_id`,`observed_on`),
  KEY `wellbeing_school_status_idx` (`school_id`,`referral_status`),
  CONSTRAINT `wellbeing_concerns_raised_by_user_id_foreign` FOREIGN KEY (`raised_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wellbeing_concerns_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wellbeing_concerns_seen_by_user_id_foreign` FOREIGN KEY (`seen_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `wellbeing_concerns_student_user_id_foreign` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


-- Laravel's migrations log, so a later 'php artisan migrate' only runs NEW migrations

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

LOCK TABLES `migrations` WRITE;
/*!40000 ALTER TABLE `migrations` DISABLE KEYS */;
INSERT  IGNORE INTO `migrations` VALUES (1,'0001_01_01_000000_create_users_table',1),(2,'0001_01_01_000001_create_cache_table',1),(3,'0001_01_01_000002_create_jobs_table',1),(4,'2026_08_25_011344_create_permission_tables',1),(5,'2026_08_25_044125_create_states_table',1),(6,'2026_08_25_044126_create_districts_table',1),(7,'2026_08_25_044127_create_schools_table',1),(8,'2026_08_25_044128_create_school_profiles_table',1),(9,'2026_08_25_044129_create_anonymous_identities_table',1),(10,'2026_08_25_044130_create_parent_profiles_table',1),(11,'2026_08_25_044131_create_student_profiles_table',1),(12,'2026_08_25_044132_create_teacher_profiles_table',1),(13,'2026_08_25_044133_create_school_staff_table',1),(14,'2026_08_25_044134_create_parent_school_relationships_table',1),(15,'2026_08_25_044135_create_student_school_relationships_table',1),(16,'2026_08_25_044136_create_teacher_school_relationships_table',1),(17,'2026_08_25_044137_create_complaint_categories_table',1),(18,'2026_08_25_044138_create_complaints_table',1),(19,'2026_08_25_044139_create_complaint_evidence_table',1),(20,'2026_08_25_044140_create_complaint_responses_table',1),(21,'2026_08_25_044141_create_complaint_status_history_table',1),(22,'2026_08_25_044142_create_complaint_resolutions_table',1),(23,'2026_08_25_044143_create_school_feedback_table',1),(24,'2026_08_25_044144_create_school_rating_components_table',1),(25,'2026_08_25_044145_create_school_quality_scores_table',1),(26,'2026_08_25_044146_create_audit_logs_table',1),(27,'2026_08_25_044147_create_identity_access_logs_table',1),(28,'2026_08_25_044148_create_notifications_table',1),(29,'2026_08_25_044427_create_officer_jurisdictions_table',1),(30,'2026_08_26_023118_create_retaliation_reports_table',1),(31,'2026_08_26_023130_create_teacher_feedback_table',1),(32,'2026_08_26_023143_create_teacher_effectiveness_scores_table',1),(33,'2026_08_26_024026_create_teacher_rating_components_table',1),(34,'2026_08_26_071443_create_invitations_table',1),(35,'2026_08_26_134827_create_student_academic_records_table',1),(36,'2026_08_26_134833_create_fraud_flags_table',1),(37,'2026_08_26_134834_create_appeals_table',1),(38,'2026_08_26_134838_create_analytics_snapshots_table',1),(39,'2026_08_26_134839_create_two_factor_authentications_table',1),(40,'2026_08_26_134840_create_settings_table',1),(41,'2026_09_02_100001_create_consent_records_table',1),(42,'2026_09_02_100002_create_capability_observations_table',1),(43,'2026_09_02_100003_create_growth_plans_table',1),(44,'2026_09_02_100004_create_growth_goals_table',1),(45,'2026_09_02_100005_create_career_interest_profiles_table',1),(46,'2026_09_02_100006_create_life_skills_tracking_table',1),(47,'2026_09_03_100001_add_udise_code_to_schools_table',1),(48,'2026_09_03_100002_create_fees_table',1),(49,'2026_09_03_100003_create_fee_revisions_table',1),(50,'2026_09_03_100004_create_facility_claims_table',1),(51,'2026_09_03_100005_create_facility_ratings_table',1),(52,'2026_09_03_100006_create_safeguarding_reports_table',1),(53,'2026_09_03_100007_create_safeguarding_events_table',1),(54,'2026_09_03_100008_create_external_exams_table',1),(55,'2026_09_03_100009_create_coaching_programmes_table',1),(56,'2026_09_03_100010_create_physical_health_records_table',1),(57,'2026_09_03_100011_create_wellbeing_concerns_table',1),(58,'2026_09_03_100012_create_counselling_sessions_table',1),(59,'2026_09_03_100013_create_health_followups_table',1),(60,'2026_09_03_100014_create_health_access_logs_table',1),(61,'2026_09_03_100015_create_benchmark_references_table',1),(62,'2026_09_03_100016_create_courses_table',1),(63,'2026_09_03_100017_create_course_ratings_table',1),(64,'2026_09_03_100018_create_school_replies_table',1),(65,'2026_09_03_100019_create_data_subject_requests_table',1);
/*!40000 ALTER TABLE `migrations` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

