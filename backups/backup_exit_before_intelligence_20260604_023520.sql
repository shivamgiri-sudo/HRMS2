-- MySQL dump 10.13  Distrib 8.0.45, for Linux (x86_64)
--
-- Host: 122.184.128.90    Database: mas_hrms
-- ------------------------------------------------------
-- Server version	8.0.42-0ubuntu0.20.04.1

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
mysqldump: Error: 'Access denied; you need (at least one of) the PROCESS privilege(s) for this operation' when trying to dump tablespaces

--
-- Table structure for table `exit_request`
--

DROP TABLE IF EXISTS `exit_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `exit_request` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `initiated_by` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'employee',
  `initiated_by_user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exit_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'voluntary',
  `exit_sub_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'resignation',
  `exit_reason_category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resignation_reason` text COLLATE utf8mb4_unicode_ci,
  `last_working_day_proposed` date DEFAULT NULL,
  `last_working_day_confirmed` date DEFAULT NULL,
  `notice_period_days` int NOT NULL DEFAULT '0',
  `notice_start_date` date DEFAULT NULL,
  `notice_end_date` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `revoked_at` datetime DEFAULT NULL,
  `revoke_reason` text COLLATE utf8mb4_unicode_ci,
  `revoked_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `manager_actioned_at` datetime DEFAULT NULL,
  `hr_actioned_at` datetime DEFAULT NULL,
  `admin_actioned_at` datetime DEFAULT NULL,
  `exit_confirmed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_exit_employee` (`employee_id`),
  KEY `idx_exit_status` (`status`),
  KEY `idx_exit_type` (`exit_type`),
  KEY `idx_exit_lwd` (`last_working_day_confirmed`),
  CONSTRAINT `exit_request_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `exit_request`
--

LOCK TABLES `exit_request` WRITE;
/*!40000 ALTER TABLE `exit_request` DISABLE KEYS */;
INSERT INTO `exit_request` VALUES ('exit-001','emp-recruiter-001','emp-recruiter-001',NULL,'voluntary','resignation','Better opportunity','Got a better offer','2026-07-01',NULL,30,NULL,NULL,'submitted',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-06-01 13:54:19','2026-06-01 13:54:19');
/*!40000 ALTER TABLE `exit_request` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `exit_approval_log`
--

DROP TABLE IF EXISTS `exit_approval_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `exit_approval_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `exit_request_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stage` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_by_role` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `discussion_remarks` text COLLATE utf8mb4_unicode_ci,
  `internal_notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_exit_log_req` (`exit_request_id`),
  KEY `idx_exit_log_stage` (`stage`),
  CONSTRAINT `exit_approval_log_ibfk_1` FOREIGN KEY (`exit_request_id`) REFERENCES `exit_request` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `exit_approval_log`
--

LOCK TABLES `exit_approval_log` WRITE;
/*!40000 ALTER TABLE `exit_approval_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `exit_approval_log` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `exit_clearance_checklist`
--

DROP TABLE IF EXISTS `exit_clearance_checklist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `exit_clearance_checklist` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `exit_request_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `department` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `assigned_to` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `cleared_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_exit_dept` (`exit_request_id`,`department`),
  KEY `idx_clearance_req` (`exit_request_id`),
  KEY `idx_clearance_status` (`status`),
  CONSTRAINT `exit_clearance_checklist_ibfk_1` FOREIGN KEY (`exit_request_id`) REFERENCES `exit_request` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `exit_clearance_checklist`
--

LOCK TABLES `exit_clearance_checklist` WRITE;
/*!40000 ALTER TABLE `exit_clearance_checklist` DISABLE KEYS */;
/*!40000 ALTER TABLE `exit_clearance_checklist` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-04  2:35:20
