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
-- Table structure for table `ats_candidate`
--

DROP TABLE IF EXISTS `ats_candidate`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_candidate` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `candidate_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gender` enum('Male','Female','Other') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `current_stage` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Applied',
  `applied_for_process` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `applied_for_branch` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sourcing_channel` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `referred_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `walk_in_date` date DEFAULT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `requisition_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bgv_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `offer_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `duplicate_of` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `education` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `experience` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rotational_shift` tinyint(1) DEFAULT NULL,
  `preferred_shift` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `night_shift_ok` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `leaves_in_3months` tinyint(1) DEFAULT NULL,
  `owns_two_wheeler` tinyint(1) DEFAULT NULL,
  `id_proof_available` tinyint(1) DEFAULT NULL,
  `education_proof_available` tinyint(1) DEFAULT NULL,
  `resume_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `selfie_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recruiter_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `profile_status` enum('registered','selected','onboarding_sent','profile_submitted','onboarded') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'registered',
  `father_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_address` text COLLATE utf8mb4_unicode_ci,
  `permanent_address` text COLLATE utf8mb4_unicode_ci,
  `aadhar_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pan_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uan_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `aadhar_verified` tinyint(1) NOT NULL DEFAULT '0',
  `pan_verified` tinyint(1) NOT NULL DEFAULT '0',
  `bank_account_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_ifsc` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emergency_contact_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emergency_contact_mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `profile_submitted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `candidate_code` (`candidate_code`),
  KEY `idx_ats_mobile` (`mobile`),
  KEY `idx_ats_stage` (`current_stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ats_candidate`
--

LOCK TABLES `ats_candidate` WRITE;
/*!40000 ALTER TABLE `ats_candidate` DISABLE KEYS */;
INSERT INTO `ats_candidate` VALUES ('7012a4ac-81bc-4103-bd16-903255bf857e','CND-MPY122DM','Tausif Ansari','7894561230','tausif@gmail.com','Female',NULL,'Applied','Inbound Agent','Mumbai','walk-in',NULL,'2026-06-03',NULL,NULL,1,'2026-06-03 17:43:20','2026-06-03 17:43:20',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-001','CND-001','Rahul Verma','+919800000001','rahul.v@test.com','Male',NULL,'New','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',NULL,'2026-05-28',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-002','CND-002','Sneha Pillai','+919800000002','sneha.p@test.com','Female',NULL,'New','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',NULL,'2026-05-29',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-003','CND-003','Amit Saxena','+919800000003','amit.s@test.com','Male',NULL,'New','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',NULL,'2026-05-30',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-004','CND-004','Neha Sharma','+919800000004','neha.s@test.com','Female',NULL,'Screening','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Job Portal',NULL,'2026-05-20',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-005','CND-005','Suresh Babu','+919800000005','suresh.b@test.com','Male',NULL,'Screening','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Referral',NULL,'2026-05-18',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-006','CND-006','Kavitha Rao','+919800000006','kavitha.r@test.com','Female',NULL,'Interview','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','LinkedIn',NULL,'2026-05-15',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-007','CND-007','Praveen Nair','+919800000007','praveen.n@test.com','Male',NULL,'Interview','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',NULL,'2026-05-22',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-008','CND-008','Divya Menon','+919800000008','divya.m@test.com','Female',NULL,'Interview','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',NULL,'2026-05-25',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-009','CND-009','Rohit Singh','+919800000009','rohit.s@test.com','Male',NULL,'Offered','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Naukri',NULL,'2026-05-10',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL),('cand-010','CND-010','Priti Malhotra','+919800000010','priti.m@test.com','Female',NULL,'Offered','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','LinkedIn',NULL,'2026-05-08',NULL,NULL,1,'2026-06-01 13:24:04','2026-06-01 13:24:04',NULL,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'registered',NULL,NULL,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `ats_candidate` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ats_candidate_stage_log`
--

DROP TABLE IF EXISTS `ats_candidate_stage_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_candidate_stage_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `candidate_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_stage` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_stage` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stage_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `updated_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `interview_slot_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_stage_log_cand` (`candidate_id`),
  CONSTRAINT `ats_candidate_stage_log_ibfk_1` FOREIGN KEY (`candidate_id`) REFERENCES `ats_candidate` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ats_candidate_stage_log`
--

LOCK TABLES `ats_candidate_stage_log` WRITE;
/*!40000 ALTER TABLE `ats_candidate_stage_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `ats_candidate_stage_log` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-04  2:27:49
