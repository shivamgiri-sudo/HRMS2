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
-- Table structure for table `ats_onboarding_request`
--

DROP TABLE IF EXISTS `ats_onboarding_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_onboarding_request` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `candidate_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `assigned_to` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','in_progress','offer_submitted','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `candidate_id` (`candidate_id`),
  KEY `idx_onb_req_branch` (`branch_id`),
  KEY `idx_onb_req_status` (`status`),
  CONSTRAINT `ats_onboarding_request_ibfk_1` FOREIGN KEY (`candidate_id`) REFERENCES `ats_candidate` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ats_onboarding_request_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ats_onboarding_request`
--

LOCK TABLES `ats_onboarding_request` WRITE;
/*!40000 ALTER TABLE `ats_onboarding_request` DISABLE KEYS */;
/*!40000 ALTER TABLE `ats_onboarding_request` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ats_onboarding_bridge`
--

DROP TABLE IF EXISTS `ats_onboarding_bridge`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_onboarding_bridge` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `candidate_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bridge_date` date NOT NULL,
  `offer_letter_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `joining_date` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `onboarding_token` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `onboarding_token_expires_at` datetime DEFAULT NULL,
  `hr_approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hr_approved_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `candidate_id` (`candidate_id`),
  UNIQUE KEY `uq_onb_token` (`onboarding_token`),
  KEY `employee_id` (`employee_id`),
  CONSTRAINT `ats_onboarding_bridge_ibfk_1` FOREIGN KEY (`candidate_id`) REFERENCES `ats_candidate` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ats_onboarding_bridge_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ats_onboarding_bridge`
--

LOCK TABLES `ats_onboarding_bridge` WRITE;
/*!40000 ALTER TABLE `ats_onboarding_bridge` DISABLE KEYS */;
/*!40000 ALTER TABLE `ats_onboarding_bridge` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ats_bgv_record`
--

DROP TABLE IF EXISTS `ats_bgv_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_bgv_record` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `candidate_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bgv_vendor` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `initiated_date` date DEFAULT NULL,
  `completed_date` date DEFAULT NULL,
  `overall_status` enum('pending','in_progress','clear','adverse','pending_review') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `address_check` enum('pending','clear','adverse') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `education_check` enum('pending','clear','adverse') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `employment_check` enum('pending','clear','adverse') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `criminal_check` enum('pending','clear','adverse') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `initiated_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bgv_candidate` (`candidate_id`),
  CONSTRAINT `ats_bgv_record_ibfk_1` FOREIGN KEY (`candidate_id`) REFERENCES `ats_candidate` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ats_bgv_record`
--

LOCK TABLES `ats_bgv_record` WRITE;
/*!40000 ALTER TABLE `ats_bgv_record` DISABLE KEYS */;
/*!40000 ALTER TABLE `ats_bgv_record` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ats_bgv_response`
--

DROP TABLE IF EXISTS `ats_bgv_response`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_bgv_response` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `candidate_id` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `batch_no` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_no` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emergency_contact_no` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dob` date DEFAULT NULL,
  `aadhaar_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `father_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `husband_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `permanent_same_as_current` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `permanent_address` text COLLATE utf8mb4_unicode_ci,
  `permanent_city` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `permanent_state` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `permanent_pincode` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `permanent_landmark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_address` text COLLATE utf8mb4_unicode_ci,
  `current_city` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_state` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_pincode` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_landmark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_payload` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ats_bgv_candidate` (`candidate_id`),
  KEY `idx_ats_bgv_mobile` (`contact_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ats_bgv_response`
--

LOCK TABLES `ats_bgv_response` WRITE;
/*!40000 ALTER TABLE `ats_bgv_response` DISABLE KEYS */;
/*!40000 ALTER TABLE `ats_bgv_response` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-04  3:00:19
