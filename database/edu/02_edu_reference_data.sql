-- Education reference data (production AND test): roles, permissions, states/districts,
-- complaint categories, rating components, benchmark references. No user accounts.
-- Safe to re-run (INSERT IGNORE). After import run on the server: php artisan permission:cache-reset


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

LOCK TABLES `benchmark_references` WRITE;
/*!40000 ALTER TABLE `benchmark_references` DISABLE KEYS */;
INSERT  IGNORE INTO `benchmark_references` (`id`, `dimension`, `system_name`, `system_type`, `practice`, `relevance`, `source_name`, `source_url`, `source_year`, `source_verified`, `created_at`, `updated_at`) VALUES (1,'tracking_and_streaming','Finland','country','Comprehensive schooling keeps pupils in mixed-ability groups through the basic education years, avoiding early separation into ability streams, with support given inside the mainstream class.','The platform enforces the same principle structurally: capability data can never be used to sort children into ability groups or restrict access to subjects.','OECD country education policy profiles',NULL,2020,0,'2026-09-28 09:52:29','2026-09-28 09:52:29'),(2,'teaching_quality','Finland','country','Teaching is a research-based master\'s-level profession with substantial classroom autonomy and relatively little external standardised testing.','Comparison point for this platform\'s teacher-quality measures, which are development-oriented rather than punitive by design.','OECD country education policy profiles',NULL,2020,0,'2026-09-28 09:52:29','2026-09-28 09:52:29'),(3,'holistic_assessment','Singapore','country','Holistic assessment approaches in the primary years reduce reliance on a single examination mark, reporting a broader picture of a child\'s development alongside academic attainment.','Directly comparable to NEP 2020 and PARAKH\'s Holistic Progress Card, which this platform\'s growth module is built to feed rather than compete with.','Singapore Ministry of Education, holistic assessment policy statements',NULL,2021,0,'2026-09-28 09:52:29','2026-09-28 09:52:29'),(4,'career_readiness','Singapore','country','Applied learning and education-and-career guidance are embedded across schooling rather than concentrated into a single decision point.','The platform\'s career module is exploratory and revisited over time for the same reason: interests at 12 are not fixed at 12.','Singapore Ministry of Education, applied learning programme materials',NULL,2021,0,'2026-09-28 09:52:29','2026-09-28 09:52:29'),(5,'digital_access','Estonia','country','A digital-first national curriculum and shared national digital learning infrastructure, with digital competence treated as a cross-curricular skill rather than a separate subject.','Reference point for digital access and digital-literacy tracking in the life-skills module.','Estonian Education Information System and national curriculum documents',NULL,2021,0,'2026-09-28 09:52:29','2026-09-28 09:52:29'),(6,'holistic_assessment','OECD Learning Compass 2030','framework','A competency framework spanning knowledge, skills, attitudes and values, with student agency at its centre — learners as active participants in setting their own direction rather than recipients of instruction.','The growth loop in this platform gives older students a direct role in setting their own goals, which is what student agency means in practice.','OECD Future of Education and Skills 2030 project',NULL,2019,0,'2026-09-28 09:52:29','2026-09-28 09:52:29'),(7,'student_wellbeing','OECD Learning Compass 2030','framework','Wellbeing is treated as an outcome of education in its own right, not only as a condition for academic attainment.','This platform holds wellbeing records under a stricter confidentiality tier than academic data for the same reason — it is not merely instrumental to results.','OECD Future of Education and Skills 2030 project',NULL,2019,0,'2026-09-28 09:52:29','2026-09-28 09:52:29'),(8,'grievance_and_accountability','UNESCO Education 2030 / SDG 4','framework','Accountability frameworks emphasise transparent, accessible mechanisms through which families can raise concerns, and public reporting of how systems respond.','The complaint workflow here measures resolution and lets complainants — not schools — confirm whether something was actually resolved.','UNESCO Global Education Monitoring Report, accountability edition',NULL,2017,0,'2026-09-28 09:52:29','2026-09-28 09:52:29'),(9,'teaching_quality','UNESCO Education 2030 / SDG 4','framework','Target 4.c commits to substantially increasing the supply of qualified teachers, treating teacher supply and qualification as a measured system-level indicator.','Comparison point for the platform\'s school-reported teacher counts and qualification records.','UNESCO SDG 4 indicator framework',NULL,2016,0,'2026-09-28 09:52:29','2026-09-28 09:52:29');
/*!40000 ALTER TABLE `benchmark_references` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `complaint_categories` WRITE;
/*!40000 ALTER TABLE `complaint_categories` DISABLE KEYS */;
INSERT  IGNORE INTO `complaint_categories` (`id`, `name`, `slug`, `description`, `is_child_safety`, `is_active`, `created_at`, `updated_at`) VALUES (1,'Teaching','teaching',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(2,'Teacher Behaviour','teacher-behaviour',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(3,'Fees','fees',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(4,'Books','books',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(5,'Uniform','uniform',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(6,'Stationery','stationery',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(7,'Transport','transport',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(8,'Infrastructure','infrastructure',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(9,'Safety','safety',NULL,1,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(10,'Bullying','bullying',NULL,1,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(11,'Harassment','harassment',NULL,1,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(12,'Discrimination','discrimination',NULL,1,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(13,'Food','food',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(14,'Hygiene','hygiene',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(15,'Sports','sports',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(16,'Counselling','counselling',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(17,'Special Needs','special-needs',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(18,'Attendance','attendance',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(19,'Communication','communication',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(20,'Management','management',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(21,'Career Guidance','career-guidance',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26'),(22,'Other','other',NULL,0,1,'2026-09-28 09:52:26','2026-09-28 09:52:26');
/*!40000 ALTER TABLE `complaint_categories` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `districts` WRITE;
/*!40000 ALTER TABLE `districts` DISABLE KEYS */;
INSERT  IGNORE INTO `districts` (`id`, `state_id`, `name`, `code`, `created_at`, `updated_at`) VALUES (1,1,'Pune','PUN','2026-09-28 09:52:25','2026-09-28 09:52:25'),(2,1,'Mumbai','MUM','2026-09-28 09:52:25','2026-09-28 09:52:25'),(3,2,'Bengaluru Urban','BLR','2026-09-28 09:52:25','2026-09-28 09:52:25'),(4,2,'Mysuru','MYS','2026-09-28 09:52:25','2026-09-28 09:52:25'),(5,3,'New Delhi','NDL','2026-09-28 09:52:25','2026-09-28 09:52:25');
/*!40000 ALTER TABLE `districts` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `permissions` WRITE;
/*!40000 ALTER TABLE `permissions` DISABLE KEYS */;
INSERT  IGNORE INTO `permissions` (`id`, `name`, `guard_name`, `created_at`, `updated_at`) VALUES (1,'submit-complaint','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(2,'submit-feedback','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(3,'view-own-complaints','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(4,'respond-to-complaint','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(5,'manage-school-profile','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(6,'review-district-complaints','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(7,'review-state-complaints','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(8,'access-protected-identity','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(9,'view-audit-logs','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(10,'manage-admin-settings','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(11,'view-national-analytics','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(12,'record-capability-observation','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(13,'manage-growth-plan','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(14,'record-life-skills','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(15,'manage-consent','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(16,'handle-safeguarding-cases','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(17,'record-physical-health','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(18,'raise-wellbeing-concern','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(19,'record-counselling-session','web','2026-09-28 09:52:24','2026-09-28 09:52:24');
/*!40000 ALTER TABLE `permissions` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `role_has_permissions` WRITE;
/*!40000 ALTER TABLE `role_has_permissions` DISABLE KEYS */;
INSERT  IGNORE INTO `role_has_permissions` (`permission_id`, `role_id`) VALUES (1,2),(2,2),(3,2),(12,2),(15,2),(1,3),(2,3),(3,3),(12,3),(3,4),(12,4),(13,4),(14,4),(18,4),(17,5),(18,5),(18,6),(19,6),(12,7),(14,7),(4,8),(5,8),(16,9),(6,10),(8,10),(16,10),(7,11),(8,11),(11,11),(16,11),(7,12),(8,12),(9,12),(11,12),(16,12),(11,13),(9,14),(15,14),(1,15),(2,15),(3,15),(4,15),(5,15),(6,15),(7,15),(8,15),(9,15),(10,15),(11,15),(12,15),(13,15),(14,15),(15,15),(16,15),(17,15),(18,15),(19,15);
/*!40000 ALTER TABLE `role_has_permissions` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `roles` WRITE;
/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT  IGNORE INTO `roles` (`id`, `name`, `guard_name`, `created_at`, `updated_at`) VALUES (1,'public','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(2,'parent','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(3,'student','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(4,'teacher','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(5,'school_nurse','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(6,'counsellor','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(7,'career_mentor','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(8,'school_admin','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(9,'child_safety_officer','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(10,'district_officer','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(11,'state_officer','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(12,'national_admin','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(13,'researcher','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(14,'data_protection_officer','web','2026-09-28 09:52:24','2026-09-28 09:52:24'),(15,'system_admin','web','2026-09-28 09:52:24','2026-09-28 09:52:24');
/*!40000 ALTER TABLE `roles` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `school_rating_components` WRITE;
/*!40000 ALTER TABLE `school_rating_components` DISABLE KEYS */;
INSERT  IGNORE INTO `school_rating_components` (`id`, `key`, `label`, `weight`, `is_active`, `created_at`, `updated_at`) VALUES (1,'teaching_learning','Teaching & Learning',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27'),(2,'teacher_quality','Teacher Quality',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27'),(3,'student_development','Student Development',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27'),(4,'safety_wellbeing','Safety & Wellbeing',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27'),(5,'parent_experience','Parent Experience',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27'),(6,'transparency','Transparency',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27'),(7,'infrastructure','Infrastructure',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27'),(8,'sports_activities','Sports & Activities',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27'),(9,'career_guidance','Career Guidance',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27'),(10,'complaint_resolution','Complaint Resolution',10.00,1,'2026-09-28 09:52:27','2026-09-28 09:52:27');
/*!40000 ALTER TABLE `school_rating_components` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `states` WRITE;
/*!40000 ALTER TABLE `states` DISABLE KEYS */;
INSERT  IGNORE INTO `states` (`id`, `name`, `code`, `created_at`, `updated_at`) VALUES (1,'Maharashtra','MH','2026-09-28 09:52:25','2026-09-28 09:52:25'),(2,'Karnataka','KA','2026-09-28 09:52:25','2026-09-28 09:52:25'),(3,'Delhi','DL','2026-09-28 09:52:25','2026-09-28 09:52:25');
/*!40000 ALTER TABLE `states` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `teacher_rating_components` WRITE;
/*!40000 ALTER TABLE `teacher_rating_components` DISABLE KEYS */;
INSERT  IGNORE INTO `teacher_rating_components` (`id`, `key`, `label`, `weight`, `is_active`, `created_at`, `updated_at`) VALUES (1,'subject_knowledge','Subject Knowledge',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(2,'explanation','Explanation',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(3,'communication','Communication',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(4,'engagement','Engagement',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(5,'fairness','Fairness',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(6,'classroom_management','Classroom Management',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(7,'individual_attention','Individual Attention',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(8,'practical_learning','Practical Learning',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(9,'feedback','Feedback',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(10,'homework','Homework',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(11,'student_support','Student Support',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28'),(12,'punctuality','Punctuality',8.33,1,'2026-09-28 09:52:28','2026-09-28 09:52:28');
/*!40000 ALTER TABLE `teacher_rating_components` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

