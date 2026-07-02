mysqldump: [Warning] Using a password on the command line interface can be insecure.
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
-- Table structure for table `account_control_log`
--

DROP TABLE IF EXISTS `account_control_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `account_control_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'employee user_id from Supabase/MySQL',
  `action` enum('password_reset_requested','password_reset_sent','password_reset_completed','force_change_set','account_locked','account_unlocked','account_disabled','account_enabled','session_revoked') COLLATE utf8mb4_unicode_ci NOT NULL,
  `initiated_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'admin user_id who performed the action',
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `metadata_json` json DEFAULT NULL COMMENT 'token hash / partial ref — never plaintext password',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_acl_user_id` (`user_id`),
  KEY `idx_acl_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Audit trail for admin-initiated account control actions';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `action_plan`
--

DROP TABLE IF EXISTS `action_plan`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `action_plan` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `process_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metric_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_level` enum('analyst','tl','process_manager','branch_head') COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `due_date` date NOT NULL,
  `status` enum('planned','in_progress','done','delayed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'planned',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ap_process` (`process_id`),
  KEY `metric_id` (`metric_id`),
  CONSTRAINT `action_plan_ibfk_1` FOREIGN KEY (`metric_id`) REFERENCES `kpi_metric_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `adherence_alert`
--

DROP TABLE IF EXISTS `adherence_alert`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `adherence_alert` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `alert_date` date NOT NULL,
  `alert_type` enum('no_show','late_arrival','early_exit','break_breach','low_adherence','coverage_breach','shrinkage_spike') COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` enum('info','warning','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'warning',
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `threshold_pct` decimal(5,2) DEFAULT NULL,
  `actual_pct` decimal(5,2) DEFAULT NULL,
  `breach_minutes` int DEFAULT NULL,
  `recon_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `coverage_snapshot_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('open','acknowledged','resolved','suppressed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `acknowledged_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acknowledged_at` datetime DEFAULT NULL,
  `resolved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `resolution_note` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_alert_date` (`alert_date`),
  KEY `idx_alert_type` (`alert_type`),
  KEY `idx_alert_status` (`status`),
  KEY `idx_alert_employee` (`employee_id`),
  CONSTRAINT `adherence_alert_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `appraisal_cycle`
--

DROP TABLE IF EXISTS `appraisal_cycle`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `appraisal_cycle` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cycle_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` enum('draft','active','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `appraisal_rating`
--

DROP TABLE IF EXISTS `appraisal_rating`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `appraisal_rating` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cycle_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `self_rating` decimal(3,1) DEFAULT NULL,
  `manager_rating` decimal(3,1) DEFAULT NULL,
  `final_rating` decimal(3,1) DEFAULT NULL,
  `self_comments` text COLLATE utf8mb4_unicode_ci,
  `manager_comments` text COLLATE utf8mb4_unicode_ci,
  `status` enum('pending','self_done','manager_done','calibrated','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `rated_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_appraisal` (`cycle_id`,`employee_id`),
  KEY `idx_appr_emp` (`employee_id`),
  CONSTRAINT `appraisal_rating_ibfk_1` FOREIGN KEY (`cycle_id`) REFERENCES `appraisal_cycle` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `approval_action_log`
--

DROP TABLE IF EXISTS `approval_action_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `approval_action_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `request_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `step_order` int NOT NULL,
  `actor_user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` enum('approved','rejected','withdrawn','delegated','comment') COLLATE utf8mb4_unicode_ci NOT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `acted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aal_request` (`request_id`),
  CONSTRAINT `approval_action_log_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `approval_request` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `approval_request`
--

DROP TABLE IF EXISTS `approval_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `approval_request` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `workflow_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `current_step` int NOT NULL DEFAULT '1',
  `status` enum('pending','approved','rejected','withdrawn','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `requested_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary_text` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ar_entity` (`entity_type`,`entity_id`),
  KEY `idx_ar_status` (`status`),
  KEY `workflow_id` (`workflow_id`),
  CONSTRAINT `approval_request_ibfk_1` FOREIGN KEY (`workflow_id`) REFERENCES `approval_workflow_master` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `approval_workflow_master`
--

DROP TABLE IF EXISTS `approval_workflow_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `approval_workflow_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `workflow_code` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `workflow_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workflow_code` (`workflow_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `approval_workflow_step`
--

DROP TABLE IF EXISTS `approval_workflow_step`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `approval_workflow_step` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `workflow_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `step_order` int NOT NULL,
  `step_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `approver_role` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `auto_approve` tinyint(1) NOT NULL DEFAULT '0',
  `sla_hours` int DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_step` (`workflow_id`,`step_order`),
  CONSTRAINT `approval_workflow_step_ibfk_1` FOREIGN KEY (`workflow_id`) REFERENCES `approval_workflow_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `asset_assignment`
--

DROP TABLE IF EXISTS `asset_assignment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `asset_assignment` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `asset_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `assigned_date` date NOT NULL,
  `returned_date` date DEFAULT NULL,
  `assigned_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `return_condition` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_asset_assign_asset` (`asset_id`),
  KEY `idx_asset_assign_emp` (`employee_id`),
  CONSTRAINT `asset_assignment_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `asset_master` (`id`) ON DELETE CASCADE,
  CONSTRAINT `asset_assignment_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `asset_master`
--

DROP TABLE IF EXISTS `asset_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `asset_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `asset_code` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `asset_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `asset_category` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `asset_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `serial_number` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `purchase_date` date DEFAULT NULL,
  `purchase_cost` decimal(12,2) DEFAULT NULL,
  `vendor` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `warranty_expiry` date DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('available','assigned','maintenance','repair','retired','lost') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'available',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `asset_code` (`asset_code`),
  KEY `idx_asset_branch` (`branch_id`),
  KEY `idx_asset_status` (`status`),
  CONSTRAINT `asset_master_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `asset_service_log`
--

DROP TABLE IF EXISTS `asset_service_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `asset_service_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `asset_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `service_type` enum('maintenance','repair','inspection') COLLATE utf8mb4_unicode_ci NOT NULL,
  `service_date` date NOT NULL,
  `service_notes` text COLLATE utf8mb4_unicode_ci,
  `cost` decimal(10,2) DEFAULT NULL,
  `performed_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `asset_id` (`asset_id`),
  CONSTRAINT `asset_service_log_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `asset_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

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
-- Table structure for table `ats_duplicate_log`
--

DROP TABLE IF EXISTS `ats_duplicate_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_duplicate_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `candidate_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `matched_with_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `match_reason` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `match_score` tinyint DEFAULT NULL,
  `resolved` tinyint(1) NOT NULL DEFAULT '0',
  `resolution_note` text COLLATE utf8mb4_unicode_ci,
  `detected_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `candidate_id` (`candidate_id`),
  KEY `matched_with_id` (`matched_with_id`),
  CONSTRAINT `ats_duplicate_log_ibfk_1` FOREIGN KEY (`candidate_id`) REFERENCES `ats_candidate` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ats_duplicate_log_ibfk_2` FOREIGN KEY (`matched_with_id`) REFERENCES `ats_candidate` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ats_email_log`
--

DROP TABLE IF EXISTS `ats_email_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_email_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `candidate_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email_type` enum('registration','selected','rejected','token_sent','offer_review','approved','welcome') COLLATE utf8mb4_unicode_ci NOT NULL,
  `sent_to` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('sent','failed','skipped') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'sent',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_email_log_cand` (`candidate_id`),
  KEY `idx_email_log_type` (`email_type`),
  CONSTRAINT `ats_email_log_ibfk_1` FOREIGN KEY (`candidate_id`) REFERENCES `ats_candidate` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ats_employment_offer`
--

DROP TABLE IF EXISTS `ats_employment_offer`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_employment_offer` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `onboarding_request_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `candidate_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `emp_type` enum('OnRoll','OffRoll') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OnRoll',
  `date_of_joining` date NOT NULL,
  `date_of_salary` date DEFAULT NULL,
  `profile` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cost_centre` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reporting_manager_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role_type` enum('Analyst','SupportStaff') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `salary_band` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `offered_ctc` decimal(12,2) NOT NULL,
  `basic` decimal(12,2) DEFAULT NULL,
  `hra` decimal(12,2) DEFAULT NULL,
  `conveyance` decimal(12,2) DEFAULT NULL,
  `da` decimal(12,2) DEFAULT NULL,
  `special_allowance` decimal(12,2) DEFAULT NULL,
  `other_allowance` decimal(12,2) DEFAULT NULL,
  `bonus` decimal(12,2) DEFAULT NULL,
  `gross` decimal(12,2) DEFAULT NULL,
  `pf_employee` decimal(12,2) DEFAULT NULL,
  `pf_employer` decimal(12,2) DEFAULT NULL,
  `esic_employee` decimal(12,2) DEFAULT NULL,
  `esic_employer` decimal(12,2) DEFAULT NULL,
  `professional_tax` decimal(12,2) DEFAULT NULL,
  `gratuity` decimal(12,2) DEFAULT NULL,
  `admin_charges` decimal(12,2) DEFAULT NULL,
  `net_in_hand` decimal(12,2) DEFAULT NULL,
  `status` enum('draft','submitted') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `onboarding_request_id` (`onboarding_request_id`),
  KEY `candidate_id` (`candidate_id`),
  KEY `department_id` (`department_id`),
  KEY `designation_id` (`designation_id`),
  KEY `reporting_manager_id` (`reporting_manager_id`),
  CONSTRAINT `ats_employment_offer_ibfk_1` FOREIGN KEY (`onboarding_request_id`) REFERENCES `ats_onboarding_request` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ats_employment_offer_ibfk_2` FOREIGN KEY (`candidate_id`) REFERENCES `ats_candidate` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ats_employment_offer_ibfk_3` FOREIGN KEY (`department_id`) REFERENCES `department_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ats_employment_offer_ibfk_4` FOREIGN KEY (`designation_id`) REFERENCES `designation_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ats_employment_offer_ibfk_5` FOREIGN KEY (`reporting_manager_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ats_form_config`
--

DROP TABLE IF EXISTS `ats_form_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_form_config` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `config_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_label` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_type` enum('option_list','field_schema') COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_value` json NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `updated_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_form_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ats_interview_slot`
--

DROP TABLE IF EXISTS `ats_interview_slot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_interview_slot` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `slot_date` date NOT NULL,
  `slot_time` time DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_capacity` int NOT NULL DEFAULT '20',
  `registered` int NOT NULL DEFAULT '0',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `branch_id` (`branch_id`),
  KEY `process_id` (`process_id`),
  KEY `idx_slot_date` (`slot_date`),
  CONSTRAINT `ats_interview_slot_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ats_interview_slot_ibfk_2` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ats_offer`
--

DROP TABLE IF EXISTS `ats_offer`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_offer` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `candidate_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `requisition_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `offered_ctc` decimal(12,2) DEFAULT NULL,
  `offered_designation` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `offered_process` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `offered_branch` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `offer_date` date NOT NULL,
  `offer_expiry_date` date DEFAULT NULL,
  `joining_date` date DEFAULT NULL,
  `status` enum('draft','sent','accepted','rejected','withdrawn','expired','lapsed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `rejection_reason` text COLLATE utf8mb4_unicode_ci,
  `prepared_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `candidate_id` (`candidate_id`),
  CONSTRAINT `ats_offer_ibfk_1` FOREIGN KEY (`candidate_id`) REFERENCES `ats_candidate` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ats_offer_approval`
--

DROP TABLE IF EXISTS `ats_offer_approval`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_offer_approval` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `offer_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `approver_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` enum('approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `action_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_offer_approval_offer` (`offer_id`),
  CONSTRAINT `ats_offer_approval_ibfk_1` FOREIGN KEY (`offer_id`) REFERENCES `ats_employment_offer` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

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
-- Table structure for table `ats_recruiter`
--

DROP TABLE IF EXISTS `ats_recruiter`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_recruiter` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recruiter_active` (`active_status`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ats_sourcing_channel`
--

DROP TABLE IF EXISTS `ats_sourcing_channel`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_sourcing_channel` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `channel_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_code` (`channel_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attendance_daily_record`
--

DROP TABLE IF EXISTS `attendance_daily_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_daily_record` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `record_date` date NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attendance_source` enum('dialler','biometric') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'biometric',
  `dialler_minutes` int DEFAULT NULL,
  `biometric_minutes` int DEFAULT NULL,
  `raw_minutes` int NOT NULL DEFAULT '0',
  `attendance_status` enum('present','half_day','absent','leave_approved','holiday','week_off','unreconciled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unreconciled',
  `lwp_value` decimal(4,2) NOT NULL DEFAULT '0.00',
  `late_mark` tinyint(1) NOT NULL DEFAULT '0',
  `late_by_minutes` int NOT NULL DEFAULT '0',
  `rule_config_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `regularization_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `override_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `override_reason` text COLLATE utf8mb4_unicode_ci,
  `is_locked` tinyint(1) NOT NULL DEFAULT '0',
  `processed_at` datetime DEFAULT NULL,
  `created_by` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_date` (`employee_id`,`record_date`),
  KEY `idx_adr_date` (`record_date`),
  KEY `idx_adr_status` (`attendance_status`),
  KEY `idx_adr_process` (`process_id`),
  KEY `idx_adr_locked` (`is_locked`),
  KEY `branch_id` (`branch_id`),
  KEY `rule_config_id` (`rule_config_id`),
  KEY `regularization_id` (`regularization_id`),
  CONSTRAINT `attendance_daily_record_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `attendance_daily_record_ibfk_2` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `attendance_daily_record_ibfk_3` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `attendance_daily_record_ibfk_4` FOREIGN KEY (`rule_config_id`) REFERENCES `attendance_rule_config` (`id`) ON DELETE SET NULL,
  CONSTRAINT `attendance_daily_record_ibfk_5` FOREIGN KEY (`regularization_id`) REFERENCES `attendance_regularization` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attendance_reconciliation_record`
--

DROP TABLE IF EXISTS `attendance_reconciliation_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_reconciliation_record` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `roster_date` date NOT NULL,
  `roster_cycle_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `planned_shift_start` time DEFAULT NULL,
  `planned_shift_end` time DEFAULT NULL,
  `required_minutes` int NOT NULL DEFAULT '0',
  `actual_login_time` datetime DEFAULT NULL,
  `actual_logout_time` datetime DEFAULT NULL,
  `actual_minutes` int NOT NULL DEFAULT '0',
  `break_minutes` int NOT NULL DEFAULT '0',
  `productive_minutes` int NOT NULL DEFAULT '0',
  `attendance_status` enum('present','absent','half_day','late','early_exit','leave_approved','holiday','week_off','unreconciled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unreconciled',
  `adherence_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `late_by_minutes` int NOT NULL DEFAULT '0',
  `early_exit_minutes` int NOT NULL DEFAULT '0',
  `regularization_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reconciled_at` datetime DEFAULT NULL,
  `reconciled_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recon_emp_date` (`employee_id`,`roster_date`),
  KEY `idx_recon_date` (`roster_date`),
  KEY `idx_recon_status` (`attendance_status`),
  CONSTRAINT `attendance_reconciliation_record_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attendance_regularization`
--

DROP TABLE IF EXISTS `attendance_regularization`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_regularization` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_date` date NOT NULL,
  `reason` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `supporting_note` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reviewed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `reviewer_note` text COLLATE utf8mb4_unicode_ci,
  `applied_to_session_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reg_employee` (`employee_id`),
  KEY `idx_reg_status` (`status`),
  CONSTRAINT `attendance_regularization_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attendance_rule_config`
--

DROP TABLE IF EXISTS `attendance_rule_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_rule_config` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `rule_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_type` enum('designation','process','branch','process_designation','branch_process','global') COLLATE utf8mb4_unicode_ci NOT NULL,
  `designation_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attendance_source` enum('dialler','biometric') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'biometric',
  `full_day_minutes` int NOT NULL DEFAULT '540',
  `half_day_minutes` int NOT NULL DEFAULT '270',
  `grace_minutes` int NOT NULL DEFAULT '15',
  `effective_from` date NOT NULL DEFAULT (curdate()),
  `effective_to` date DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_arc_designation` (`designation_id`),
  KEY `idx_arc_process` (`process_id`),
  KEY `idx_arc_branch` (`branch_id`),
  KEY `idx_arc_active` (`active_status`,`effective_from`,`effective_to`),
  CONSTRAINT `attendance_rule_config_ibfk_1` FOREIGN KEY (`designation_id`) REFERENCES `designation_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `attendance_rule_config_ibfk_2` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `attendance_rule_config_ibfk_3` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attrition_record`
--

DROP TABLE IF EXISTS `attrition_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attrition_record` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exit_date` date NOT NULL,
  `exit_type` enum('voluntary','involuntary','absconding','contract_end','other') COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenure_days` int DEFAULT NULL,
  `recorded_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `exit_request_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_provisional` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_attr_process` (`process_id`),
  KEY `idx_attr_date` (`exit_date`),
  KEY `employee_id` (`employee_id`),
  KEY `branch_id` (`branch_id`),
  CONSTRAINT `attrition_record_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `attrition_record_ibfk_2` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `attrition_record_ibfk_3` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attrition_snapshot`
--

DROP TABLE IF EXISTS `attrition_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attrition_snapshot` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `snapshot_month` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `opening_headcount` int NOT NULL DEFAULT '0',
  `closing_headcount` int NOT NULL DEFAULT '0',
  `voluntary_exits` int NOT NULL DEFAULT '0',
  `involuntary_exits` int NOT NULL DEFAULT '0',
  `total_exits` int NOT NULL DEFAULT '0',
  `new_joiners` int NOT NULL DEFAULT '0',
  `attrition_rate` decimal(6,2) NOT NULL DEFAULT '0.00',
  `computed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_snap_month_branch_process` (`snapshot_month`,`branch_id`,`process_id`),
  KEY `idx_snap_month` (`snapshot_month`),
  KEY `branch_id` (`branch_id`),
  KEY `process_id` (`process_id`),
  CONSTRAINT `attrition_snapshot_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `attrition_snapshot_ibfk_2` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `auth_password_reset`
--

DROP TABLE IF EXISTS `auth_password_reset`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_password_reset` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `idx_prt_token` (`token_hash`),
  KEY `idx_prt_user` (`user_id`),
  CONSTRAINT `auth_password_reset_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `auth_refresh_token`
--

DROP TABLE IF EXISTS `auth_refresh_token`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_refresh_token` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `revoked` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `idx_rt_user_active` (`user_id`,`revoked`),
  KEY `idx_rt_token` (`token_hash`),
  CONSTRAINT `auth_refresh_token_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `auth_user`
--

DROP TABLE IF EXISTS `auth_user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_user` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_blocked` tinyint(1) NOT NULL DEFAULT '0',
  `last_login_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `must_change_password` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_auth_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Employee login credentials — replaces Supabase auth.users';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `benefit_enrollment`
--

DROP TABLE IF EXISTS `benefit_enrollment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `benefit_enrollment` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `enrolled_date` date NOT NULL,
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `status` enum('active','inactive','pending') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_enrollment` (`employee_id`,`plan_id`),
  KEY `idx_enroll_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `benefit_plan`
--

DROP TABLE IF EXISTS `benefit_plan`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `benefit_plan` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `plan_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_type` enum('insurance','transport','meal','wellness','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `description` text COLLATE utf8mb4_unicode_ci,
  `eligibility_rule` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `billing_invoice`
--

DROP TABLE IF EXISTS `billing_invoice`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_invoice` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `invoice_ref` varchar(32) NOT NULL,
  `process_id` char(36) NOT NULL,
  `billing_unit_id` char(36) DEFAULT NULL,
  `period_from` date NOT NULL,
  `period_to` date NOT NULL,
  `billable_units` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT 'Seats/transactions/hours',
  `rate` decimal(10,2) NOT NULL,
  `gross_amount` decimal(12,2) NOT NULL,
  `adjustments` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT 'SLA credits, penalties',
  `net_amount` decimal(12,2) NOT NULL,
  `gst_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(12,2) NOT NULL,
  `status` enum('draft','sent','acknowledged','paid','disputed') NOT NULL DEFAULT 'draft',
  `notes` text,
  `prepared_by` char(36) DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invoice_ref` (`invoice_ref`),
  KEY `idx_inv_process` (`process_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `billing_unit`
--

DROP TABLE IF EXISTS `billing_unit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_unit` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `process_id` char(36) NOT NULL,
  `contract_id` char(36) DEFAULT NULL COMMENT 'Links to contract_master',
  `billing_type` enum('per_seat','per_transaction','fixed_monthly','revenue_share') NOT NULL DEFAULT 'per_seat',
  `rate` decimal(10,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(3) NOT NULL DEFAULT 'INR',
  `billing_period` enum('weekly','monthly','quarterly') NOT NULL DEFAULT 'monthly',
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_bu_process` (`process_id`),
  KEY `idx_bu_contract` (`contract_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bonus_calculation`
--

DROP TABLE IF EXISTS `bonus_calculation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bonus_calculation` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `financial_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g. 2025-2026',
  `monthly_salary` decimal(10,2) NOT NULL,
  `annual_salary` decimal(12,2) NOT NULL,
  `eligible` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 if salary ≤ ₹21,000/month',
  `allocable_surplus_pct` decimal(5,2) NOT NULL DEFAULT '8.33',
  `calculated_bonus` decimal(12,2) NOT NULL DEFAULT '0.00',
  `min_bonus` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '8.33% of ₹7,000 or min wage',
  `max_bonus` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '20% of salary',
  `status` enum('calculated','approved','paid') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'calculated',
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bonus` (`employee_id`,`financial_year`),
  KEY `idx_bonus_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `branch_master`
--

DROP TABLE IF EXISTS `branch_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `branch_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `branch_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `branch_code` (`branch_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `campaign_master`
--

DROP TABLE IF EXISTS `campaign_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `campaign_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `campaign_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `campaign_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lob_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `campaign_code` (`campaign_code`),
  KEY `process_id` (`process_id`),
  KEY `lob_id` (`lob_id`),
  CONSTRAINT `campaign_master_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `campaign_master_ibfk_2` FOREIGN KEY (`lob_id`) REFERENCES `lob_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `career_path`
--

DROP TABLE IF EXISTS `career_path`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `career_path` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `current_role` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_role` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_timeline` date DEFAULT NULL,
  `readiness_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `skills_gap` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `reviewed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_career_emp` (`employee_id`),
  KEY `idx_career_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `client_master`
--

DROP TABLE IF EXISTS `client_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `client_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `client_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `client_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `client_code` (`client_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `client_user`
--

DROP TABLE IF EXISTS `client_user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `client_user` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `client_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `designation` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_ids` json NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `client_id` (`client_id`),
  CONSTRAINT `client_user_ibfk_1` FOREIGN KEY (`client_id`) REFERENCES `client_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `coaching_session`
--

DROP TABLE IF EXISTS `coaching_session`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `coaching_session` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `coach_user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_date` date NOT NULL,
  `session_type` enum('performance','quality','development','pip') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'performance',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `action_items` json DEFAULT NULL,
  `status` enum('scheduled','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'scheduled',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_coach_emp` (`employee_id`),
  KEY `idx_coach_date` (`session_date`),
  CONSTRAINT `coaching_session_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `communication_template`
--

DROP TABLE IF EXISTS `communication_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `communication_template` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body_html` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `body_text` text COLLATE utf8mb4_unicode_ci,
  `category` enum('onboarding','payroll','attendance','leave','performance','alerts','announcements','custom') COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel` enum('email','sms','whatsapp','multi') COLLATE utf8mb4_unicode_ci NOT NULL,
  `variables_schema` json DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `is_critical` tinyint(1) DEFAULT '0',
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category_active` (`category`,`is_active`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `communication_template_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `competency_master`
--

DROP TABLE IF EXISTS `competency_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `competency_master` (
  `competency_id` int NOT NULL AUTO_INCREMENT,
  `competency_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `category` enum('core','leadership','technical','behavioral') COLLATE utf8mb4_unicode_ci DEFAULT 'core',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`competency_id`),
  UNIQUE KEY `competency_name` (`competency_name`),
  KEY `idx_category` (`category`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `consent_text_version`
--

DROP TABLE IF EXISTS `consent_text_version`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `consent_text_version` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `version_code` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g. v1.0, v1.1, v2.0',
  `purpose_code` enum('employment','payroll','communication','lms','portal','recruitment','health') COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `consent_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `text_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SHA-256 of consent_text for tamper-detection',
  `language` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'en',
  `status` enum('draft','legal_review','approved','active','superseded') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `legal_reviewed_by` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Name of legal counsel who reviewed',
  `legal_reviewed_at` datetime DEFAULT NULL,
  `activated_at` datetime DEFAULT NULL,
  `superseded_at` datetime DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `version_code` (`version_code`),
  KEY `idx_ctv_purpose` (`purpose_code`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `contract_master`
--

DROP TABLE IF EXISTS `contract_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contract_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `contract_code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendor_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `client_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contract_type` enum('sow','msa','nda','po','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'sow',
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `value` decimal(14,2) DEFAULT NULL,
  `status` enum('draft','active','expired','terminated') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `contract_code` (`contract_code`),
  KEY `idx_contract_vendor` (`vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cost_centre_master`
--

DROP TABLE IF EXISTS `cost_centre_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cost_centre_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cost_centre_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cost_centre_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_cost_centre_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cost_centre_head_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `budget_annual` decimal(16,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cost_centre_code` (`cost_centre_code`),
  KEY `branch_id` (`branch_id`),
  KEY `department_id` (`department_id`),
  KEY `fk_cc_parent` (`parent_cost_centre_id`),
  CONSTRAINT `cost_centre_master_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cost_centre_master_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `department_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cc_parent` FOREIGN KEY (`parent_cost_centre_id`) REFERENCES `cost_centre_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `creche_facility`
--

DROP TABLE IF EXISTS `creche_facility`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `creche_facility` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `facility_type` enum('on_premises','employer_funded_offsite','contracted') COLLATE utf8mb4_unicode_ci NOT NULL,
  `facility_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `capacity` int NOT NULL DEFAULT '0',
  `current_enrolled` int NOT NULL DEFAULT '0',
  `subsidy_per_child_monthly` decimal(10,2) DEFAULT NULL,
  `operational_since` date DEFAULT NULL,
  `status` enum('active','inactive','planned') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_creche_branch` (`branch_id`),
  CONSTRAINT `creche_facility_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `customization_application_log`
--

DROP TABLE IF EXISTS `customization_application_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customization_application_log` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rule_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `applied_config` json NOT NULL COMMENT 'Final config after rule applied',
  `application_source` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'api, cron, manual',
  `applied_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_rule` (`rule_id`),
  KEY `idx_entity` (`entity_type`,`entity_id`),
  KEY `idx_applied` (`applied_at` DESC),
  KEY `idx_employee_entity` (`employee_id`,`entity_type`),
  CONSTRAINT `customization_application_log_ibfk_1` FOREIGN KEY (`rule_id`) REFERENCES `customization_rule` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Audit log of customization rule applications';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `customization_cache`
--

DROP TABLE IF EXISTS `customization_cache`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customization_cache` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cache_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'employeeId:entityType:entityId hash',
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effective_config` json NOT NULL,
  `cached_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NOT NULL COMMENT 'TTL for cache entry',
  `hit_count` int DEFAULT '0' COMMENT 'Cache hit counter',
  PRIMARY KEY (`id`),
  UNIQUE KEY `cache_key` (`cache_key`),
  KEY `idx_cache_key` (`cache_key`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_expires` (`expires_at`),
  KEY `idx_entity` (`entity_type`,`entity_id`),
  KEY `idx_employee_expires` (`employee_id`,`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Performance cache for effective customization configs';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `customization_dimension`
--

DROP TABLE IF EXISTS `customization_dimension`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customization_dimension` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dimension_key` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'branch, process, department, designation, role, employee',
  `dimension_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) DEFAULT '1',
  `priority` int DEFAULT '0' COMMENT 'Higher priority = applies first',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `dimension_key` (`dimension_key`),
  KEY `idx_active` (`is_active`),
  KEY `idx_priority` (`priority` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Customization dimensions (branch, process, department, etc.)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `customization_rule`
--

DROP TABLE IF EXISTS `customization_rule`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customization_rule` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rule_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'leave_type, attendance_policy, approval_workflow, etc.',
  `entity_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Specific entity (optional)',
  `branch_ids` json DEFAULT NULL COMMENT '["branch-uuid-1", "branch-uuid-2"]',
  `process_ids` json DEFAULT NULL,
  `department_ids` json DEFAULT NULL,
  `designation_ids` json DEFAULT NULL,
  `role_ids` json DEFAULT NULL,
  `employee_ids` json DEFAULT NULL,
  `config_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'override, merge, extend, disable',
  `config_data` json NOT NULL COMMENT 'Actual customization values',
  `priority` int DEFAULT '0' COMMENT 'Rule precedence (higher = applies last = wins)',
  `is_active` tinyint(1) DEFAULT '1',
  `effective_from` date DEFAULT NULL COMMENT 'Start date',
  `effective_to` date DEFAULT NULL COMMENT 'End date',
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_entity` (`entity_type`,`entity_id`),
  KEY `idx_active` (`is_active`,`effective_from`,`effective_to`),
  KEY `idx_priority` (`priority` DESC),
  KEY `idx_created` (`created_at` DESC),
  KEY `idx_entity_active` (`entity_type`,`is_active`,`priority` DESC),
  CONSTRAINT `chk_config_type` CHECK ((`config_type` in (_utf8mb4'override',_utf8mb4'merge',_utf8mb4'extend',_utf8mb4'disable')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Customization rules for multi-dimensional configuration';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `data_breach_log`
--

DROP TABLE IF EXISTS `data_breach_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_breach_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `breach_ref` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `detected_at` datetime NOT NULL,
  `breach_type` enum('unauthorized_access','data_leak','system_breach','insider_threat','ransomware','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `affected_records_count` int NOT NULL DEFAULT '0',
  `affected_data_types` json DEFAULT NULL COMMENT 'Array: ["name","email","salary","aadhaar",...]',
  `severity` enum('low','medium','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `immediate_action_taken` text COLLATE utf8mb4_unicode_ci,
  `notified_authority_at` datetime DEFAULT NULL COMMENT 'CERT-In / DPDP Authority notification (within 72 hours)',
  `notified_principals_at` datetime DEFAULT NULL COMMENT 'Affected data principals notified',
  `authority_ref` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Reference number from authority',
  `remediation_notes` text COLLATE utf8mb4_unicode_ci,
  `status` enum('detected','investigating','contained','resolved','reported') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'detected',
  `reported_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `breach_ref` (`breach_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `data_consent`
--

DROP TABLE IF EXISTS `data_consent`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_consent` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `data_principal_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Supabase user_id or candidate identifier',
  `principal_type` enum('employee','candidate','client_user','portal_user') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'employee',
  `purpose_code` enum('employment','payroll','communication','lms','portal','recruitment','health') COLLATE utf8mb4_unicode_ci NOT NULL,
  `consent_text_version` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g. v1.0, v1.1',
  `consent_text_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SHA-256 of consent text shown',
  `consented_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `withdrawn_at` datetime DEFAULT NULL,
  `ip_address` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `channel` enum('web','api','import','manual') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'web',
  PRIMARY KEY (`id`),
  KEY `idx_consent_principal` (`data_principal_id`,`purpose_code`),
  KEY `idx_consent_purpose` (`purpose_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `data_retention_policy`
--

DROP TABLE IF EXISTS `data_retention_policy`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_retention_policy` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `entity_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g. ats_candidate, employees, leave_request',
  `retention_days` int NOT NULL,
  `action_on_expiry` enum('anonymize','delete','archive','notify_admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'notify_admin',
  `legal_basis` text COLLATE utf8mb4_unicode_ci COMMENT 'Indian law reference: IT Act, Labour Law, DPDP',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `entity_type` (`entity_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `data_rights_request`
--

DROP TABLE IF EXISTS `data_rights_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_rights_request` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `principal_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `principal_type` enum('employee','candidate','client_user') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'employee',
  `request_type` enum('access','correction','erasure','nomination','grievance') COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `field_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'For correction requests',
  `current_value` text COLLATE utf8mb4_unicode_ci COMMENT 'For correction requests',
  `requested_value` text COLLATE utf8mb4_unicode_ci COMMENT 'For correction requests',
  `status` enum('pending','in_review','resolved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `assigned_to` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `response_notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_drr_principal` (`principal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `department_master`
--

DROP TABLE IF EXISTS `department_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `department_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `dept_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dept_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parent_department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dept_head_employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `dept_code` (`dept_code`),
  KEY `branch_id` (`branch_id`),
  KEY `fk_dept_parent` (`parent_department_id`),
  CONSTRAINT `department_master_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_dept_parent` FOREIGN KEY (`parent_department_id`) REFERENCES `department_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `designation_master`
--

DROP TABLE IF EXISTS `designation_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `designation_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `designation_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `designation_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `grade` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `grade_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `designation_code` (`designation_code`),
  KEY `fk_desig_grade` (`grade_id`),
  CONSTRAINT `fk_desig_grade` FOREIGN KEY (`grade_id`) REFERENCES `grade_band_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `development_plan`
--

DROP TABLE IF EXISTS `development_plan`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `development_plan` (
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `report_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `manager_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_start_date` date NOT NULL,
  `plan_end_date` date NOT NULL,
  `status` enum('draft','active','completed','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'draft',
  `overall_notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`plan_id`),
  KEY `report_id` (`report_id`),
  KEY `manager_id` (`manager_id`),
  KEY `idx_employee_status` (`employee_id`,`status`),
  KEY `idx_dates` (`plan_start_date`,`plan_end_date`),
  CONSTRAINT `development_plan_ibfk_1` FOREIGN KEY (`report_id`) REFERENCES `performance_feedback_report` (`report_id`) ON DELETE CASCADE,
  CONSTRAINT `development_plan_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `development_plan_ibfk_3` FOREIGN KEY (`manager_id`) REFERENCES `employees` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `development_plan_goal`
--

DROP TABLE IF EXISTS `development_plan_goal`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `development_plan_goal` (
  `goal_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `competency_id` int DEFAULT NULL,
  `goal_description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_steps` text COLLATE utf8mb4_unicode_ci,
  `success_criteria` text COLLATE utf8mb4_unicode_ci,
  `target_date` date DEFAULT NULL,
  `status` enum('not-started','in-progress','completed','deferred') COLLATE utf8mb4_unicode_ci DEFAULT 'not-started',
  `progress_notes` text COLLATE utf8mb4_unicode_ci,
  `training_need_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`goal_id`),
  KEY `competency_id` (`competency_id`),
  KEY `training_need_id` (`training_need_id`),
  KEY `idx_plan_status` (`plan_id`,`status`),
  KEY `idx_target_date` (`target_date`),
  CONSTRAINT `development_plan_goal_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `development_plan` (`plan_id`) ON DELETE CASCADE,
  CONSTRAINT `development_plan_goal_ibfk_2` FOREIGN KEY (`competency_id`) REFERENCES `competency_master` (`competency_id`) ON DELETE SET NULL,
  CONSTRAINT `development_plan_goal_ibfk_3` FOREIGN KEY (`training_need_id`) REFERENCES `training_need` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dialer_session_log`
--

DROP TABLE IF EXISTS `dialer_session_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dialer_session_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `session_date` date NOT NULL,
  `integration_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dialer_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `login_minutes` int NOT NULL DEFAULT '0',
  `process_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `run_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_system` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'e.g. dialer_db.vicidial_agent_log_249',
  `imported_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dialer_emp_date_key` (`employee_code`,`session_date`,`integration_key`),
  UNIQUE KEY `uq_emp_date_integration` (`employee_code`,`session_date`,`integration_key`,`process_name`(50)),
  KEY `idx_dialer_emp` (`employee_code`),
  KEY `idx_dialer_date` (`session_date`),
  KEY `idx_dialer_key` (`integration_key`),
  KEY `employee_id` (`employee_id`),
  CONSTRAINT `dialer_session_log_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dispatch_log`
--

DROP TABLE IF EXISTS `dispatch_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dispatch_log` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `template_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_employee_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_contact` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel` enum('email','sms','whatsapp') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('queued','sent','delivered','opened','clicked','bounced','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'queued',
  `subject` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body_preview` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sent_at` timestamp NULL DEFAULT NULL,
  `delivered_at` timestamp NULL DEFAULT NULL,
  `opened_at` timestamp NULL DEFAULT NULL,
  `clicked_at` timestamp NULL DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `is_critical` tinyint(1) DEFAULT '0',
  `retention_category` enum('critical','standard','routine') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'standard',
  `retry_count` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `template_id` (`template_id`),
  KEY `idx_recipient_channel` (`recipient_employee_id`,`channel`,`sent_at` DESC),
  KEY `idx_status_retry` (`status`,`retry_count`),
  KEY `idx_retention_cleanup` (`is_critical`,`retention_category`,`sent_at`),
  CONSTRAINT `dispatch_log_ibfk_1` FOREIGN KEY (`template_id`) REFERENCES `communication_template` (`id`) ON DELETE SET NULL,
  CONSTRAINT `dispatch_log_ibfk_2` FOREIGN KEY (`recipient_employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dpdp_config`
--

DROP TABLE IF EXISTS `dpdp_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dpdp_config` (
  `config_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_value` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_address`
--

DROP TABLE IF EXISTS `employee_address`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_address` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address_type` enum('permanent','current','correspondence') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'current',
  `address_line1` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address_line2` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `state` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pincode` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `country` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'India',
  `is_verified` tinyint(1) NOT NULL DEFAULT '0',
  `same_as_type` enum('permanent','current') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_address_type` (`employee_id`,`address_type`),
  KEY `idx_ea_emp` (`employee_id`),
  CONSTRAINT `employee_address_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_badge_earned`
--

DROP TABLE IF EXISTS `employee_badge_earned`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_badge_earned` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `badge_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `earned_date` date NOT NULL,
  `awarded_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'system or admin employee_id',
  `reason` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_badge_date` (`employee_id`,`badge_id`,`earned_date`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_badge` (`badge_id`),
  KEY `idx_earned_date` (`earned_date`),
  CONSTRAINT `employee_badge_earned_ibfk_1` FOREIGN KEY (`badge_id`) REFERENCES `gamification_badge_master` (`id`) ON DELETE CASCADE,
  CONSTRAINT `employee_badge_earned_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_bank_detail`
--

DROP TABLE IF EXISTS `employee_bank_detail`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_bank_detail` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT '1',
  `account_seq` tinyint NOT NULL DEFAULT '1',
  `bank_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_number` varbinary(500) DEFAULT NULL,
  `ifsc_code` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Savings',
  `upi_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verified` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bank_seq` (`employee_id`,`account_seq`),
  KEY `idx_bank_emp` (`employee_id`),
  CONSTRAINT `fk_bank_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_client_mapping`
--

DROP TABLE IF EXISTS `employee_client_mapping`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_client_mapping` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `client_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cost_center` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_for` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effective_from` date DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_client` (`employee_id`),
  KEY `idx_client_map_emp` (`employee_id`),
  CONSTRAINT `employee_client_mapping_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_contract`
--

DROP TABLE IF EXISTS `employee_contract`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_contract` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contract_type` enum('fixed_term','project_based','internship','consultant','retainer') COLLATE utf8mb4_unicode_ci NOT NULL,
  `contract_start_date` date NOT NULL,
  `contract_end_date` date NOT NULL,
  `notice_period_days` int NOT NULL DEFAULT '30',
  `contract_value` decimal(14,2) DEFAULT NULL,
  `auto_renewal` tinyint(1) NOT NULL DEFAULT '0',
  `renewal_notice_days` int DEFAULT NULL,
  `vendor_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','active','expired','terminated','renewed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `terminated_on` date DEFAULT NULL,
  `termination_reason` text COLLATE utf8mb4_unicode_ci,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contract_emp` (`employee_id`),
  KEY `idx_contract_status` (`status`,`contract_end_date`),
  CONSTRAINT `employee_contract_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_document_access_log`
--

DROP TABLE IF EXISTS `employee_document_access_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_document_access_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `document_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `accessed_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `access_type` enum('view','download','verify','delete') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'view',
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accessed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_doc_access_doc` (`document_id`),
  KEY `idx_doc_access_user` (`accessed_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_documents`
--

DROP TABLE IF EXISTS `employee_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_documents` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `doc_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `doc_category` enum('identity','address_proof','education','experience','pan','aadhaar','passport','visa','driving_license','medical','contract','offer_letter','bank','tax','statutory','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `doc_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verified` tinyint(1) NOT NULL DEFAULT '0',
  `uploaded_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiry_date` date DEFAULT NULL,
  `verified_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verification_date` datetime DEFAULT NULL,
  `verification_remarks` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_emp_doc_emp` (`employee_id`),
  CONSTRAINT `employee_documents_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_emergency_contact`
--

DROP TABLE IF EXISTS `employee_emergency_contact`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_emergency_contact` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contact_seq` tinyint NOT NULL DEFAULT '1',
  `is_primary` tinyint(1) NOT NULL DEFAULT '0',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `relationship` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_emergency_seq` (`employee_id`,`contact_seq`),
  KEY `idx_eec_emp` (`employee_id`),
  CONSTRAINT `fk_eec_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_gamification_tier`
--

DROP TABLE IF EXISTS `employee_gamification_tier`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_gamification_tier` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `current_tier_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_points` int NOT NULL DEFAULT '0',
  `last_calculated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_id` (`employee_id`),
  KEY `idx_tier` (`current_tier_id`),
  KEY `idx_points` (`total_points`),
  CONSTRAINT `employee_gamification_tier_ibfk_1` FOREIGN KEY (`current_tier_id`) REFERENCES `gamification_tier` (`id`),
  CONSTRAINT `employee_gamification_tier_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_job_history`
--

DROP TABLE IF EXISTS `employee_job_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_job_history` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `effective_date` date NOT NULL,
  `change_type` enum('initial_assignment','promotion','demotion','lateral_transfer','designation_change','department_change','branch_change','process_change','lob_change','grade_change','cost_centre_change','manager_change','salary_revision','employment_type_change','confirmation','probation_extension') COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_designation_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_lob_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_cost_centre_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_grade_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_manager_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_ctc_annual` decimal(14,2) DEFAULT NULL,
  `to_designation_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_lob_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_cost_centre_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_grade_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_manager_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_ctc_annual` decimal(14,2) DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `reference_letter_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ejh_emp` (`employee_id`,`effective_date` DESC),
  KEY `idx_ejh_type` (`change_type`),
  KEY `from_manager_id` (`from_manager_id`),
  KEY `to_manager_id` (`to_manager_id`),
  CONSTRAINT `employee_job_history_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `employee_job_history_ibfk_2` FOREIGN KEY (`from_manager_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL,
  CONSTRAINT `employee_job_history_ibfk_3` FOREIGN KEY (`to_manager_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_journey_log`
--

DROP TABLE IF EXISTS `employee_journey_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_journey_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_date` date NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `old_value` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_value` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `module` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `triggered_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_journey_emp` (`employee_id`),
  KEY `idx_journey_date` (`event_date`),
  CONSTRAINT `employee_journey_log_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_kpi_assignment`
--

DROP TABLE IF EXISTS `employee_kpi_assignment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_kpi_assignment` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `legacy_kpi_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `assign_date` date DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_kpi` (`employee_id`,`legacy_kpi_id`),
  KEY `idx_kpi_assign_emp` (`employee_id`),
  CONSTRAINT `employee_kpi_assignment_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_legacy_meta`
--

DROP TABLE IF EXISTS `employee_legacy_meta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_legacy_meta` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `father_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `relationship_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acc_holder_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `blood_group` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qualification` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `marital_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `permanent_address` text COLLATE utf8mb4_unicode_ci,
  `temporary_address` text COLLATE utf8mb4_unicode_ci,
  `land_line_p` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `land_line_t` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `passport_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dl_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `offer_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `box_file_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `appoint_print_date` date DEFAULT NULL,
  `document_done` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_flag` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ac_validation_date` date DEFAULT NULL,
  `ac_validated_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ac_rejection_remarks` text COLLATE utf8mb4_unicode_ci,
  `updated_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `official_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_id` (`employee_id`),
  KEY `idx_legacy_meta_emp` (`employee_id`),
  CONSTRAINT `employee_legacy_meta_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_lifecycle_event`
--

DROP TABLE IF EXISTS `employee_lifecycle_event`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_lifecycle_event` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_type` enum('confirmation','probation_extension','transfer','promotion','demotion','increment','role_change','designation_change','department_change','branch_change','process_change','reporting_change','status_change','other') COLLATE utf8mb4_unicode_ci NOT NULL,
  `effective_date` date NOT NULL,
  `old_value_json` json DEFAULT NULL,
  `new_value_json` json DEFAULT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `approval_request_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `initiated_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lifecycle_emp` (`employee_id`),
  KEY `idx_lifecycle_type` (`event_type`),
  CONSTRAINT `employee_lifecycle_event_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_nominee`
--

DROP TABLE IF EXISTS `employee_nominee`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_nominee` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nominee_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `relationship` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `share_percentage` decimal(5,2) NOT NULL DEFAULT '100.00',
  `nominee_for` set('gratuity','pf','esic','insurance','general') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'gratuity',
  `address` text COLLATE utf8mb4_unicode_ci,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_minor` tinyint(1) NOT NULL DEFAULT '0',
  `guardian_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `guardian_relation` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nominee_emp` (`employee_id`),
  CONSTRAINT `employee_nominee_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_pf_withdrawal`
--

DROP TABLE IF EXISTS `employee_pf_withdrawal`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_pf_withdrawal` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `uan` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `withdrawal_type` enum('partial','full','vpf_partial','eps_pension','advance_medical','advance_housing','advance_education','advance_marriage') COLLATE utf8mb4_unicode_ci NOT NULL,
  `withdrawal_reason` text COLLATE utf8mb4_unicode_ci,
  `amount_requested` decimal(12,2) NOT NULL,
  `amount_approved` decimal(12,2) DEFAULT NULL,
  `application_date` date NOT NULL,
  `approved_date` date DEFAULT NULL,
  `disbursed_date` date DEFAULT NULL,
  `status` enum('applied','under_review','approved','rejected','disbursed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'applied',
  `pf_office_reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pfwith_emp` (`employee_id`),
  CONSTRAINT `employee_pf_withdrawal_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_probation`
--

DROP TABLE IF EXISTS `employee_probation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_probation` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `probation_start_date` date NOT NULL,
  `probation_end_date` date NOT NULL,
  `actual_end_date` date DEFAULT NULL,
  `extended_end_date` date DEFAULT NULL,
  `status` enum('on_probation','confirmed','extended','terminated_during_probation') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'on_probation',
  `extension_reason` text COLLATE utf8mb4_unicode_ci,
  `confirmation_remarks` text COLLATE utf8mb4_unicode_ci,
  `confirmed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_id` (`employee_id`),
  KEY `idx_prob_emp` (`employee_id`),
  KEY `idx_prob_status` (`status`),
  CONSTRAINT `employee_probation_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_salary_assignment`
--

DROP TABLE IF EXISTS `employee_salary_assignment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_salary_assignment` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `structure_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ctc_annual` decimal(12,2) NOT NULL DEFAULT '0.00',
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `structure_id` (`structure_id`),
  KEY `idx_sal_emp` (`employee_id`),
  CONSTRAINT `employee_salary_assignment_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `employee_salary_assignment_ibfk_2` FOREIGN KEY (`structure_id`) REFERENCES `salary_structure_master` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_salary_snapshot`
--

DROP TABLE IF EXISTS `employee_salary_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_salary_snapshot` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `snapshot_date` date NOT NULL,
  `basic` decimal(12,2) DEFAULT '0.00',
  `hra` decimal(12,2) DEFAULT '0.00',
  `conveyance` decimal(12,2) DEFAULT '0.00',
  `da` decimal(12,2) DEFAULT '0.00',
  `portfolio_allowance` decimal(12,2) DEFAULT '0.00',
  `medical_allowance` decimal(12,2) DEFAULT '0.00',
  `lta` decimal(12,2) DEFAULT '0.00',
  `mobile_allowance` decimal(12,2) DEFAULT '0.00',
  `special_allowance` decimal(12,2) DEFAULT '0.00',
  `other_allowance` decimal(12,2) DEFAULT '0.00',
  `bonus` decimal(12,2) DEFAULT '0.00',
  `gross` decimal(12,2) DEFAULT '0.00',
  `net_in_hand` decimal(12,2) DEFAULT '0.00',
  `ctc_offered` decimal(12,2) DEFAULT '0.00',
  `package` decimal(12,2) DEFAULT '0.00',
  `epf_employee` decimal(12,2) DEFAULT '0.00',
  `esic_employee` decimal(12,2) DEFAULT '0.00',
  `epf_employer` decimal(12,2) DEFAULT '0.00',
  `esic_employer` decimal(12,2) DEFAULT '0.00',
  `professional_tax` decimal(12,2) DEFAULT '0.00',
  `gratuity` decimal(12,2) DEFAULT '0.00',
  `admin_charges` decimal(12,2) DEFAULT '0.00',
  `pli` decimal(12,2) DEFAULT '0.00',
  `pay_mode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `salary_payment_mode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `effective_date` date DEFAULT NULL,
  `offered_ctc` decimal(12,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_id` (`employee_id`),
  KEY `idx_salary_emp` (`employee_id`),
  CONSTRAINT `employee_salary_snapshot_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_skill`
--

DROP TABLE IF EXISTS `employee_skill`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_skill` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `skill_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `proficiency` enum('beginner','intermediate','advanced','expert') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'beginner',
  `certified` tinyint(1) NOT NULL DEFAULT '0',
  `assessed_date` date DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_skill` (`employee_id`,`skill_id`),
  KEY `idx_empskill_emp` (`employee_id`),
  KEY `skill_id` (`skill_id`),
  CONSTRAINT `employee_skill_ibfk_1` FOREIGN KEY (`skill_id`) REFERENCES `skill_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_statutory_info`
--

DROP TABLE IF EXISTS `employee_statutory_info`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_statutory_info` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `epf_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `esi_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uan_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pan_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `aadhaar_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pf_eligible` tinyint(1) NOT NULL DEFAULT '0',
  `esi_eligible` tinyint(1) NOT NULL DEFAULT '0',
  `epf_date` date DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_id` (`employee_id`),
  KEY `idx_statutory_emp` (`employee_id`),
  CONSTRAINT `employee_statutory_info_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_uan`
--

DROP TABLE IF EXISTS `employee_uan`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_uan` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `uan` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Universal Account Number',
  `member_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Employer-specific PF member ID',
  `epf_join_date` date DEFAULT NULL,
  `eps_eligible` tinyint(1) NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_id` (`employee_id`),
  KEY `idx_uan_emp` (`employee_id`),
  CONSTRAINT `fk_uan_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employees`
--

DROP TABLE IF EXISTS `employees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employees` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (concat(`first_name`,_utf8mb4' ',coalesce(`last_name`,_utf8mb4''))) STORED,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pan_number` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pan_verified_on` date DEFAULT NULL,
  `aadhaar_last4` char(4) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `aadhaar_verified_on` date DEFAULT NULL,
  `gender` enum('Male','Female','Other') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `marital_status` enum('single','married','divorced','widowed') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `date_of_joining` date NOT NULL,
  `salary_start_date` date DEFAULT NULL,
  `date_of_exit` date DEFAULT NULL,
  `employment_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Full Time',
  `employee_category` enum('permanent','contract','intern','temporary','consultant') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'permanent',
  `employment_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Active',
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cost_centre_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lob_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `grade_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reporting_manager_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manager_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `photo_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `biometric_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `band` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stream` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `profile_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `legacy_emp_id` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_code` (`employee_code`),
  KEY `idx_emp_code` (`employee_code`),
  KEY `idx_emp_user` (`user_id`),
  KEY `idx_emp_branch` (`branch_id`),
  KEY `idx_emp_process` (`process_id`),
  KEY `department_id` (`department_id`),
  KEY `designation_id` (`designation_id`),
  KEY `idx_emp_cc` (`cost_centre_id`),
  KEY `fk_emp_grade` (`grade_id`),
  KEY `idx_emp_location` (`location_id`),
  KEY `idx_emp_manager` (`manager_id`),
  KEY `idx_emp_lob` (`lob_id`),
  CONSTRAINT `employees_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `employees_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `department_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `employees_ibfk_3` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `employees_ibfk_4` FOREIGN KEY (`designation_id`) REFERENCES `designation_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_emp_cost_centre` FOREIGN KEY (`cost_centre_id`) REFERENCES `cost_centre_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_emp_grade` FOREIGN KEY (`grade_id`) REFERENCES `grade_band_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_emp_lob` FOREIGN KEY (`lob_id`) REFERENCES `lob_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_emp_manager` FOREIGN KEY (`manager_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `esic_contribution_summary`
--

DROP TABLE IF EXISTS `esic_contribution_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esic_contribution_summary` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `run_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_count` int NOT NULL DEFAULT '0',
  `total_wages` decimal(14,2) NOT NULL DEFAULT '0.00',
  `employee_contribution` decimal(14,2) NOT NULL DEFAULT '0.00',
  `employer_contribution` decimal(14,2) NOT NULL DEFAULT '0.00',
  `challan_status` enum('pending','generated','filed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `challan_ref` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `run_id` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

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
-- Table structure for table `expense_claim`
--

DROP TABLE IF EXISTS `expense_claim`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expense_claim` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expense_date` date NOT NULL,
  `category` enum('travel','accommodation','meals','transport','communication','office','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `amount` decimal(10,2) NOT NULL,
  `currency` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INR',
  `description` text COLLATE utf8mb4_unicode_ci,
  `receipt_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `project_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cost_centre_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','submitted','approved','rejected','paid') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `reviewed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expense_emp` (`employee_id`),
  KEY `idx_expense_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `expense_policy`
--

DROP TABLE IF EXISTS `expense_policy`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expense_policy` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `category` enum('travel','accommodation','meals','transport','communication','office','other') NOT NULL,
  `max_amount` decimal(10,2) NOT NULL,
  `requires_receipt_above` decimal(10,2) DEFAULT '0.00',
  `approval_required` tinyint(1) NOT NULL DEFAULT '1',
  `notes` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_exp_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `full_final_calculation`
--

DROP TABLE IF EXISTS `full_final_calculation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `full_final_calculation` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `exit_request_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `calculation_date` date NOT NULL,
  `notice_period_days` int NOT NULL DEFAULT '0',
  `notice_shortfall_days` int NOT NULL DEFAULT '0',
  `notice_recovery` decimal(12,2) NOT NULL DEFAULT '0.00',
  `earned_leave_encashment` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gratuity_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `salary_hold` decimal(12,2) NOT NULL DEFAULT '0.00',
  `advances_recovery` decimal(12,2) NOT NULL DEFAULT '0.00',
  `net_payable` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` enum('draft','verified','approved','paid') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `prepared_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_ff_provisional` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1 = draft/unverified; 0 = statutory fields verified',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ff_exit` (`exit_request_id`),
  KEY `idx_ff_employee` (`employee_id`),
  CONSTRAINT `fk_ff_exit_request` FOREIGN KEY (`exit_request_id`) REFERENCES `exit_request` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gamification_badge_master`
--

DROP TABLE IF EXISTS `gamification_badge_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gamification_badge_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `badge_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `badge_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `badge_description` text COLLATE utf8mb4_unicode_ci,
  `badge_icon_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'performance, activity, tenure, social',
  `point_value` int NOT NULL DEFAULT '0',
  `criteria_json` json DEFAULT NULL COMMENT 'Auto-award criteria rules',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `badge_code` (`badge_code`),
  KEY `idx_category` (`category`),
  KEY `idx_active` (`active_status`),
  CONSTRAINT `chk_point_value_non_negative` CHECK ((`point_value` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gamification_point_log`
--

DROP TABLE IF EXISTS `gamification_point_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gamification_point_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `points_earned` int NOT NULL,
  `points_source` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'badge, kudos_received, kpi_bonus, attendance_bonus, survey_complete, etc',
  `source_ref_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Reference ID to source entity',
  `awarded_date` date NOT NULL,
  `awarded_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'system or admin employee_id',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_source` (`points_source`),
  KEY `idx_date` (`awarded_date`),
  CONSTRAINT `gamification_point_log_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gamification_tier`
--

DROP TABLE IF EXISTS `gamification_tier`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gamification_tier` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `tier_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tier_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tier_level` int NOT NULL,
  `min_points` int NOT NULL,
  `tier_icon_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `perks_json` json DEFAULT NULL COMMENT 'Benefits and perks for this tier',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tier_code` (`tier_code`),
  KEY `idx_level` (`tier_level`),
  KEY `idx_min_points` (`min_points`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `generated_letter`
--

DROP TABLE IF EXISTS `generated_letter`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `generated_letter` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `letter_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `generated_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `generated_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `issued_date` date DEFAULT NULL,
  `acknowledged_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_letter_emp` (`employee_id`),
  KEY `template_id` (`template_id`),
  CONSTRAINT `generated_letter_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `generated_letter_ibfk_2` FOREIGN KEY (`template_id`) REFERENCES `letter_template` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `glide_path_commitment`
--

DROP TABLE IF EXISTS `glide_path_commitment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `glide_path_commitment` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `process_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metric_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `month` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `committed_value` decimal(12,4) NOT NULL,
  `committed_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_locked` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_glide` (`process_id`,`metric_id`,`month`),
  KEY `idx_glide_process` (`process_id`),
  KEY `metric_id` (`metric_id`),
  CONSTRAINT `glide_path_commitment_ibfk_1` FOREIGN KEY (`metric_id`) REFERENCES `kpi_metric_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `goal`
--

DROP TABLE IF EXISTS `goal`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `goal_type` enum('individual','team','department','company') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'individual',
  `period` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Format: YYYY-MM or YYYY-Q1',
  `target_value` decimal(10,2) DEFAULT NULL,
  `actual_value` decimal(10,2) DEFAULT NULL,
  `weightage` decimal(5,2) NOT NULL DEFAULT '100.00',
  `status` enum('draft','active','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_goal_emp` (`employee_id`),
  KEY `idx_goal_period` (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `governance_activity_master`
--

DROP TABLE IF EXISTS `governance_activity_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `governance_activity_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `activity_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `level` enum('analyst','tl','process_manager','branch_head') COLLATE utf8mb4_unicode_ci NOT NULL,
  `frequency` enum('daily','weekly','monthly') COLLATE utf8mb4_unicode_ci NOT NULL,
  `required_count` int NOT NULL DEFAULT '1',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `governance_checklist_log`
--

DROP TABLE IF EXISTS `governance_checklist_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `governance_checklist_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `process_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activity_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `completed_count` int NOT NULL DEFAULT '0',
  `updated_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gov_log` (`process_id`,`period`,`activity_id`),
  KEY `activity_id` (`activity_id`),
  CONSTRAINT `governance_checklist_log_ibfk_1` FOREIGN KEY (`activity_id`) REFERENCES `governance_activity_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `grade_band_master`
--

DROP TABLE IF EXISTS `grade_band_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `grade_band_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `grade_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `grade_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `band` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `min_ctc` decimal(12,2) DEFAULT NULL,
  `max_ctc` decimal(12,2) DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `grade_code` (`grade_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gratuity_accrual_ledger`
--

DROP TABLE IF EXISTS `gratuity_accrual_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gratuity_accrual_ledger` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `accrual_month` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `basic_salary` decimal(12,2) NOT NULL,
  `years_of_service` decimal(5,2) NOT NULL,
  `daily_rate` decimal(10,4) NOT NULL,
  `monthly_accrual` decimal(12,2) NOT NULL,
  `cumulative_accrual` decimal(14,2) NOT NULL,
  `is_eligible` tinyint(1) NOT NULL DEFAULT '1',
  `payroll_run_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gratuity_emp_month` (`employee_id`,`accrual_month`),
  KEY `idx_gratl_emp` (`employee_id`),
  KEY `idx_gratl_month` (`accrual_month`),
  CONSTRAINT `gratuity_accrual_ledger_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `grievance`
--

DROP TABLE IF EXISTS `grievance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `grievance` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `grievance_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_anonymous` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('submitted','under_review','resolved','closed','escalated') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  `assigned_to` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resolution_note` text COLLATE utf8mb4_unicode_ci,
  `resolved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `grievance_code` (`grievance_code`),
  KEY `idx_grievance_emp` (`employee_id`),
  KEY `idx_grievance_status` (`status`),
  CONSTRAINT `grievance_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `helpdesk_ticket`
--

DROP TABLE IF EXISTS `helpdesk_ticket`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `helpdesk_ticket` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `ticket_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('hr','payroll','it','general','asset','leave','attendance') COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `priority` enum('low','medium','high','urgent') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `status` enum('open','in_progress','pending_info','resolved','closed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `assigned_to` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `resolution_note` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ticket_code` (`ticket_code`),
  KEY `idx_ticket_emp` (`employee_id`),
  KEY `idx_ticket_status` (`status`),
  KEY `idx_ticket_category` (`category`),
  CONSTRAINT `helpdesk_ticket_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `helpdesk_ticket_comment`
--

DROP TABLE IF EXISTS `helpdesk_ticket_comment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `helpdesk_ticket_comment` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `ticket_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `comment_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_internal` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_comment` (`ticket_id`),
  CONSTRAINT `helpdesk_ticket_comment_ibfk_1` FOREIGN KEY (`ticket_id`) REFERENCES `helpdesk_ticket` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `integration_config`
--

DROP TABLE IF EXISTS `integration_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_config` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `integration_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `integration_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `integration_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendor_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `base_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `auth_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `secret_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `config_json` json DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `integration_key` (`integration_key`),
  KEY `idx_integration_key` (`integration_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `integration_connector_run`
--

DROP TABLE IF EXISTS `integration_connector_run`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_connector_run` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `integration_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `triggered_by` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'schedule',
  `triggered_user` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'running',
  `rows_fetched` int NOT NULL DEFAULT '0',
  `rows_staged` int NOT NULL DEFAULT '0',
  `rows_promoted` int NOT NULL DEFAULT '0',
  `rows_failed` int NOT NULL DEFAULT '0',
  `duration_ms` int DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_run_key` (`integration_key`),
  KEY `idx_run_started` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `integration_event_log`
--

DROP TABLE IF EXISTS `integration_event_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_event_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `integration_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `triggered_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `metadata` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_event_key` (`integration_key`),
  KEY `idx_event_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `integration_field_map`
--

DROP TABLE IF EXISTS `integration_field_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_field_map` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `integration_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_field` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_table` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_column` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `transform` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confirmed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confirmed_at` datetime DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_map_key_field` (`integration_key`,`source_field`),
  KEY `idx_map_key` (`integration_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `integration_field_map_suggestion`
--

DROP TABLE IF EXISTS `integration_field_map_suggestion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_field_map_suggestion` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `integration_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_field` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `suggested_table` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `suggested_column` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confidence_score` decimal(5,2) NOT NULL DEFAULT '0.00',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_suggest_key` (`integration_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `integration_raw_payload`
--

DROP TABLE IF EXISTS `integration_raw_payload`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_raw_payload` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `run_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `integration_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `row_count` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payload_run` (`run_id`),
  CONSTRAINT `integration_raw_payload_ibfk_1` FOREIGN KEY (`run_id`) REFERENCES `integration_connector_run` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `integration_schedule`
--

DROP TABLE IF EXISTS `integration_schedule`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_schedule` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `integration_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cron_expression` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0 */15 * * * *',
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `last_run_at` datetime DEFAULT NULL,
  `next_run_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `integration_key` (`integration_key`),
  CONSTRAINT `integration_schedule_ibfk_1` FOREIGN KEY (`integration_key`) REFERENCES `integration_config` (`integration_key`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `integration_schema_snapshot`
--

DROP TABLE IF EXISTS `integration_schema_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_schema_snapshot` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `integration_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `run_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `detected_fields` json NOT NULL,
  `snapshot_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_schema_key` (`integration_key`),
  KEY `run_id` (`run_id`),
  CONSTRAINT `integration_schema_snapshot_ibfk_1` FOREIGN KEY (`run_id`) REFERENCES `integration_connector_run` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ispark_employee_staging`
--

DROP TABLE IF EXISTS `ispark_employee_staging`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ispark_employee_staging` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `batch_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `raw_json` json NOT NULL,
  `emp_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date_of_joining` date DEFAULT NULL,
  `validation_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `validation_errors` json DEFAULT NULL,
  `promoted_employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `promoted_at` datetime DEFAULT NULL,
  `uploaded_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `promoted_employee_id` (`promoted_employee_id`),
  KEY `idx_ispark_batch` (`batch_id`),
  KEY `idx_ispark_status` (`validation_status`),
  CONSTRAINT `ispark_employee_staging_ibfk_1` FOREIGN KEY (`batch_id`) REFERENCES `ispark_migration_batch` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ispark_employee_staging_ibfk_2` FOREIGN KEY (`promoted_employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ispark_migration_batch`
--

DROP TABLE IF EXISTS `ispark_migration_batch`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ispark_migration_batch` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `batch_ref` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_file` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_rows` int NOT NULL DEFAULT '0',
  `valid_rows` int NOT NULL DEFAULT '0',
  `invalid_rows` int NOT NULL DEFAULT '0',
  `promoted_rows` int NOT NULL DEFAULT '0',
  `batch_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'uploaded',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `batch_ref` (`batch_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `job_posting`
--

DROP TABLE IF EXISTS `job_posting`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_posting` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `posting_code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vacancies` int NOT NULL DEFAULT '1',
  `job_type` enum('full_time','part_time','contract','internship') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'full_time',
  `experience_min` int NOT NULL DEFAULT '0' COMMENT 'months',
  `experience_max` int NOT NULL DEFAULT '0' COMMENT '0 = no limit',
  `description` text COLLATE utf8mb4_unicode_ci,
  `requirements` text COLLATE utf8mb4_unicode_ci,
  `salary_min` decimal(10,2) DEFAULT NULL,
  `salary_max` decimal(10,2) DEFAULT NULL,
  `posted_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','active','paused','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `closing_date` date DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `posting_code` (`posting_code`),
  KEY `idx_job_process` (`process_id`),
  KEY `idx_job_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_assignment`
--

DROP TABLE IF EXISTS `kpi_assignment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_assignment` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `template_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `designation_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `template_id` (`template_id`),
  KEY `idx_kpi_asgn_emp` (`employee_id`),
  KEY `idx_kpi_asgn_desig` (`designation_id`),
  KEY `idx_kpi_asgn_dept` (`department_id`),
  CONSTRAINT `kpi_assignment_ibfk_1` FOREIGN KEY (`template_id`) REFERENCES `kpi_template` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_metric_master`
--

DROP TABLE IF EXISTS `kpi_metric_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_metric_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `metric_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metric_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `family` enum('operations','quality','performance','custom') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'performance',
  `category` enum('operations','quality','sales','hr','custom') COLLATE utf8mb4_unicode_ci NOT NULL,
  `unit` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `direction` enum('higher_is_better','lower_is_better') COLLATE utf8mb4_unicode_ci NOT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `metric_code` (`metric_code`),
  KEY `idx_kpi_metric_cat` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_process_config`
--

DROP TABLE IF EXISTS `kpi_process_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_process_config` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `process_id` char(36) NOT NULL,
  `metric_id` char(36) NOT NULL,
  `target_value` decimal(12,4) NOT NULL,
  `min_threshold` decimal(12,4) DEFAULT NULL COMMENT 'Below this = red/critical',
  `max_achievement` decimal(12,4) DEFAULT '120.0000' COMMENT 'Cap (% of target) for scoring',
  `weightage` decimal(5,2) NOT NULL DEFAULT '100.00',
  `effective_from` date NOT NULL DEFAULT (curdate()),
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_process_metric` (`process_id`,`metric_id`),
  KEY `idx_kpc_process` (`process_id`),
  KEY `idx_kpc_metric` (`metric_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_rating_config`
--

DROP TABLE IF EXISTS `kpi_rating_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_rating_config` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `process_id` char(36) DEFAULT NULL COMMENT 'NULL = global default applies to all processes',
  `rating_label` varchar(32) NOT NULL,
  `min_score_pct` decimal(5,2) NOT NULL,
  `max_score_pct` decimal(5,2) NOT NULL,
  `color_code` varchar(16) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_krc_process` (`process_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_score`
--

DROP TABLE IF EXISTS `kpi_score`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_score` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metric_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actual_value` decimal(12,4) NOT NULL,
  `source` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kpi_score` (`employee_id`,`metric_id`,`period`),
  KEY `metric_id` (`metric_id`),
  KEY `idx_kpi_score_period` (`period`),
  KEY `idx_kpi_score_emp` (`employee_id`),
  CONSTRAINT `kpi_score_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `kpi_score_ibfk_2` FOREIGN KEY (`metric_id`) REFERENCES `kpi_metric_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_target_master`
--

DROP TABLE IF EXISTS `kpi_target_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_target_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `role_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kpi_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kpi_code` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_value` decimal(10,4) DEFAULT NULL,
  `unit` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kpi_role_code` (`role_key`,`kpi_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_template`
--

DROP TABLE IF EXISTS `kpi_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_template` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `template_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_template_metric`
--

DROP TABLE IF EXISTS `kpi_template_metric`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_template_metric` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `template_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metric_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_value` decimal(12,4) NOT NULL,
  `weight_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tpl_metric` (`template_id`,`metric_id`),
  KEY `metric_id` (`metric_id`),
  CONSTRAINT `kpi_template_metric_ibfk_1` FOREIGN KEY (`template_id`) REFERENCES `kpi_template` (`id`) ON DELETE CASCADE,
  CONSTRAINT `kpi_template_metric_ibfk_2` FOREIGN KEY (`metric_id`) REFERENCES `kpi_metric_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kudos_giver_limit`
--

DROP TABLE IF EXISTS `kudos_giver_limit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kudos_giver_limit` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period_month` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'YYYY-MM format',
  `kudos_given` int NOT NULL DEFAULT '0',
  `kudos_limit` int NOT NULL DEFAULT '5',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_month` (`employee_id`,`period_month`),
  KEY `idx_period` (`period_month`),
  CONSTRAINT `kudos_giver_limit_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kudos_recognition`
--

DROP TABLE IF EXISTS `kudos_recognition`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kudos_recognition` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `from_employee_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `to_employee_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kudos_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `kudos_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'teamwork, innovation, customer_service, leadership, etc',
  `points_awarded` int NOT NULL DEFAULT '10',
  `is_public` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_from` (`from_employee_id`),
  KEY `idx_to` (`to_employee_id`),
  KEY `idx_to_employee_date` (`to_employee_id`,`created_at`),
  KEY `idx_type` (`kudos_type`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `kudos_recognition_ibfk_1` FOREIGN KEY (`from_employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `kudos_recognition_ibfk_2` FOREIGN KEY (`to_employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_points_awarded_non_negative` CHECK ((`points_awarded` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leave_approval_log`
--

DROP TABLE IF EXISTS `leave_approval_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_approval_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `leave_request_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `approval_level` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `leave_request_id` (`leave_request_id`),
  CONSTRAINT `leave_approval_log_ibfk_1` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_request` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leave_balance_ledger`
--

DROP TABLE IF EXISTS `leave_balance_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_balance_ledger` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leave_type_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `balance_year` int NOT NULL,
  `allocated_days` decimal(6,2) NOT NULL DEFAULT '0.00',
  `used_days` decimal(6,2) NOT NULL DEFAULT '0.00',
  `adjusted_days` decimal(6,2) NOT NULL DEFAULT '0.00',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_leave_year` (`employee_id`,`leave_type_id`,`balance_year`),
  KEY `leave_type_id` (`leave_type_id`),
  CONSTRAINT `leave_balance_ledger_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `leave_balance_ledger_ibfk_2` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_type_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leave_el_credit_log`
--

DROP TABLE IF EXISTS `leave_el_credit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_el_credit_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `credit_year` int NOT NULL,
  `completed_months` int NOT NULL,
  `credited_days` decimal(6,2) NOT NULL,
  `capped` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_el_credit` (`employee_id`,`credit_year`),
  KEY `idx_el_credit_year` (`credit_year`),
  CONSTRAINT `leave_el_credit_log_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leave_holiday_master`
--

DROP TABLE IF EXISTS `leave_holiday_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_holiday_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `holiday_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `holiday_date` date NOT NULL,
  `holiday_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'national',
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `branch_id` (`branch_id`),
  KEY `idx_holiday_date` (`holiday_date`),
  CONSTRAINT `leave_holiday_master_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leave_policy_config`
--

DROP TABLE IF EXISTS `leave_policy_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_policy_config` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `policy_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `policy_value` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value_type` enum('number','boolean','string') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'number',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `policy_key` (`policy_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leave_request`
--

DROP TABLE IF EXISTS `leave_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_request` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leave_type_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_date` date NOT NULL,
  `to_date` date NOT NULL,
  `total_days` decimal(6,2) NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `applied_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `approval_level` enum('normal','branch_head') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `exception_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `el_occurrence_no` int DEFAULT NULL,
  `applied_against_code` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `document_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_leave_req` (`employee_id`,`leave_type_id`,`from_date`,`to_date`),
  KEY `leave_type_id` (`leave_type_id`),
  KEY `idx_leave_emp` (`employee_id`),
  KEY `idx_leave_status` (`status`),
  CONSTRAINT `leave_request_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `leave_request_ibfk_2` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_type_master` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leave_roster_impact`
--

DROP TABLE IF EXISTS `leave_roster_impact`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_roster_impact` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `leave_request_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `impact_date` date NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `required_hc` int NOT NULL DEFAULT '0',
  `planned_hc` int NOT NULL DEFAULT '0',
  `leave_count` int NOT NULL DEFAULT '1',
  `coverage_after_leave` int NOT NULL DEFAULT '0',
  `coverage_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `impact_level` enum('none','low','medium','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none',
  `substitute_rostered` tinyint(1) NOT NULL DEFAULT '0',
  `substitute_emp_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_leave_impact` (`leave_request_id`,`impact_date`),
  KEY `idx_li_date` (`impact_date`),
  KEY `idx_li_process` (`process_id`),
  KEY `employee_id` (`employee_id`),
  CONSTRAINT `leave_roster_impact_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leave_type_master`
--

DROP TABLE IF EXISTS `leave_type_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_type_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `leave_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leave_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `max_days_per_year` int NOT NULL DEFAULT '0',
  `carry_forward` tinyint(1) NOT NULL DEFAULT '0',
  `requires_approval` tinyint(1) NOT NULL DEFAULT '1',
  `paid_leave` tinyint(1) NOT NULL DEFAULT '1',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `leave_code` (`leave_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `letter_template`
--

DROP TABLE IF EXISTS `letter_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `letter_template` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `template_code` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `letter_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body_template` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `template_code` (`template_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lms_certification_snapshot`
--

DROP TABLE IF EXISTS `lms_certification_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lms_certification_snapshot` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `certification_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `issued_date` date DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `status` enum('active','expired','revoked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `synced_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lms_cert_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lms_employee_mapping`
--

DROP TABLE IF EXISTS `lms_employee_mapping`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lms_employee_mapping` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lms_learner_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mapped_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lms_emp` (`employee_id`),
  KEY `idx_lms_learner` (`lms_learner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lms_learning_progress_snapshot`
--

DROP TABLE IF EXISTS `lms_learning_progress_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lms_learning_progress_snapshot` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lms_learner_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `course_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `course_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `completion_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `score` decimal(5,2) DEFAULT NULL,
  `status` enum('not_started','in_progress','completed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_started',
  `last_accessed` datetime DEFAULT NULL,
  `synced_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lms_prog_emp` (`employee_id`),
  KEY `idx_lms_prog_synced` (`synced_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lms_sync_audit_log`
--

DROP TABLE IF EXISTS `lms_sync_audit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lms_sync_audit_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `sync_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `records_synced` int NOT NULL DEFAULT '0',
  `errors_count` int NOT NULL DEFAULT '0',
  `status` enum('success','partial','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'success',
  `initiated_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lob_master`
--

DROP TABLE IF EXISTS `lob_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lob_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `lob_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lob_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `lob_code` (`lob_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `location_master`
--

DROP TABLE IF EXISTS `location_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `location_master` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `location_name` varchar(128) NOT NULL,
  `location_code` varchar(32) DEFAULT NULL,
  `address` text,
  `city` varchar(64) DEFAULT NULL,
  `state` varchar(64) DEFAULT NULL,
  `pincode` varchar(10) DEFAULT NULL,
  `branch_id` char(36) DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `management_commentary`
--

DROP TABLE IF EXISTS `management_commentary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `management_commentary` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `process_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_designation` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `published_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `acknowledged_at` datetime DEFAULT NULL,
  `acknowledged_by_client_user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_commentary` (`process_id`,`period`),
  KEY `idx_commentary_process` (`process_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `management_commentary_reply`
--

DROP TABLE IF EXISTS `management_commentary_reply`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `management_commentary_reply` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `commentary_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `replied_by_client_user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reply_text` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `commentary_id` (`commentary_id`),
  CONSTRAINT `management_commentary_reply_ibfk_1` FOREIGN KEY (`commentary_id`) REFERENCES `management_commentary` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `management_kpi_summary`
--

DROP TABLE IF EXISTS `management_kpi_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `management_kpi_summary` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `overall_score` decimal(5,2) DEFAULT NULL,
  `rank_position` int DEFAULT NULL,
  `trend` enum('up','down','stable') COLLATE utf8mb4_unicode_ci DEFAULT 'stable',
  `computed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mks` (`employee_id`,`period`,`template_id`),
  KEY `idx_mks_emp_period` (`employee_id`,`period`),
  CONSTRAINT `management_kpi_summary_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `manpower_requisition`
--

DROP TABLE IF EXISTS `manpower_requisition`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `manpower_requisition` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `req_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_count` int NOT NULL DEFAULT '1',
  `fulfilled_count` int NOT NULL DEFAULT '0',
  `priority` enum('low','medium','high','urgent') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `reason` text COLLATE utf8mb4_unicode_ci,
  `expected_joining` date DEFAULT NULL,
  `status` enum('draft','open','in_progress','fulfilled','cancelled','on_hold') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `raised_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `req_code` (`req_code`),
  KEY `idx_mr_process` (`process_id`),
  KEY `idx_mr_status` (`status`),
  KEY `branch_id` (`branch_id`),
  KEY `department_id` (`department_id`),
  KEY `designation_id` (`designation_id`),
  CONSTRAINT `manpower_requisition_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `manpower_requisition_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `manpower_requisition_ibfk_3` FOREIGN KEY (`department_id`) REFERENCES `department_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `manpower_requisition_ibfk_4` FOREIGN KEY (`designation_id`) REFERENCES `designation_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `maternity_benefit_record`
--

DROP TABLE IF EXISTS `maternity_benefit_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `maternity_benefit_record` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `record_type` enum('delivery','adoption','miscarriage','surrogacy') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'delivery',
  `child_birth_order` tinyint NOT NULL DEFAULT '1' COMMENT '1=first child, 2=second, 3=third+ (affects entitlement weeks)',
  `entitled_weeks` tinyint NOT NULL DEFAULT '26' COMMENT 'Computed: 26 for 1st/2nd delivery, 12 for 3rd+, 8 adoption, 6 miscarriage',
  `expected_delivery_date` date DEFAULT NULL,
  `actual_delivery_date` date DEFAULT NULL,
  `leave_start_date` date NOT NULL,
  `leave_end_date` date DEFAULT NULL,
  `paid_weeks` int NOT NULL DEFAULT '26' COMMENT 'Standard 26 weeks',
  `nursing_break_weeks` int NOT NULL DEFAULT '0',
  `complications` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 if additional 4 weeks granted',
  `status` enum('applied','approved','active','completed','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'applied',
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `leave_request_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Auto-created leave_request when status moves to approved',
  `nursing_break_granted` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Two nursing breaks of 15 min per day for 15 months post-delivery',
  `nursing_break_end_date` date DEFAULT NULL,
  `work_from_home_option` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'MBA 2017: WFH option per employer policy',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_maternity_emp` (`employee_id`),
  KEY `idx_mat_leave_req` (`leave_request_id`),
  KEY `idx_mat_type` (`record_type`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `migration_row_log`
--

DROP TABLE IF EXISTS `migration_row_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `migration_row_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `run_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_table` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_table` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'written',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_migrow_run` (`run_id`),
  KEY `idx_migrow_status` (`status`),
  CONSTRAINT `migration_row_log_ibfk_1` FOREIGN KEY (`run_id`) REFERENCES `migration_run` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `migration_run`
--

DROP TABLE IF EXISTS `migration_run`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `migration_run` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `module` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'running',
  `rows_read` int NOT NULL DEFAULT '0',
  `rows_written` int NOT NULL DEFAULT '0',
  `rows_failed` int NOT NULL DEFAULT '0',
  `source_count` int DEFAULT NULL,
  `target_count` int DEFAULT NULL,
  `triggered_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  `error_log` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `idx_migration_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `minimum_wage_master`
--

DROP TABLE IF EXISTS `minimum_wage_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `minimum_wage_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `state_code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('unskilled','semi_skilled','skilled','highly_skilled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unskilled',
  `daily_rate` decimal(8,2) NOT NULL,
  `monthly_rate` decimal(10,2) NOT NULL,
  `effective_from` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_mw_state` (`state_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notification_preferences`
--

DROP TABLE IF EXISTS `notification_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_preferences` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('onboarding','payroll','attendance','leave','performance','alerts','announcements') COLLATE utf8mb4_unicode_ci NOT NULL,
  `preferred_channel` enum('email','sms','whatsapp') COLLATE utf8mb4_unicode_ci DEFAULT 'email',
  `enabled` tinyint(1) DEFAULT '1',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_employee_category` (`employee_id`,`category`),
  KEY `idx_employee_enabled` (`employee_id`,`enabled`),
  CONSTRAINT `notification_preferences_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_disbursement`
--

DROP TABLE IF EXISTS `payroll_disbursement`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_disbursement` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `run_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_ref` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `disbursed_at` datetime DEFAULT NULL,
  `disbursed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `employee_count` int NOT NULL DEFAULT '0',
  `status` enum('pending','processing','completed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_disbursement_run` (`run_id`),
  CONSTRAINT `fk_disbursement_run` FOREIGN KEY (`run_id`) REFERENCES `salary_prep_run` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_readiness_flag`
--

DROP TABLE IF EXISTS `payroll_readiness_flag`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_readiness_flag` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `roster_cycle_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `period_start` date NOT NULL,
  `period_end` date NOT NULL,
  `working_days` int NOT NULL DEFAULT '0',
  `present_days` int NOT NULL DEFAULT '0',
  `absent_days` int NOT NULL DEFAULT '0',
  `leave_days` int NOT NULL DEFAULT '0',
  `half_days` int NOT NULL DEFAULT '0',
  `lwp_days` decimal(4,1) NOT NULL DEFAULT '0.0',
  `total_productive_mins` int NOT NULL DEFAULT '0',
  `status` enum('pending','ready','sent_to_payroll','processed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `readiness_notes` text COLLATE utf8mb4_unicode_ci,
  `flagged_at` datetime DEFAULT NULL,
  `flagged_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pr_flag` (`employee_id`,`period_start`),
  KEY `idx_pr_status` (`status`),
  CONSTRAINT `payroll_readiness_flag_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `performance_alert`
--

DROP TABLE IF EXISTS `performance_alert`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_alert` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `alert_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` enum('low','medium','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `message` text COLLATE utf8mb4_unicode_ci,
  `acknowledged` tinyint(1) NOT NULL DEFAULT '0',
  `acknowledged_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acknowledged_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_alert_emp` (`employee_id`),
  KEY `idx_alert_severity` (`severity`),
  CONSTRAINT `performance_alert_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `performance_feedback_cycle`
--

DROP TABLE IF EXISTS `performance_feedback_cycle`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_feedback_cycle` (
  `cycle_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cycle_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period` varchar(9) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Format: YYYY-MM or YYYY-Q1',
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `deadline` date DEFAULT NULL COMMENT 'Manager submission deadline',
  `status` enum('draft','active','closed') COLLATE utf8mb4_unicode_ci DEFAULT 'draft',
  `feedback_type` enum('360','manager-only','peer-only','self') COLLATE utf8mb4_unicode_ci DEFAULT '360',
  `appraisal_cycle_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`cycle_id`),
  KEY `idx_status` (`status`),
  KEY `idx_dates` (`start_date`,`end_date`),
  KEY `created_by` (`created_by`),
  KEY `appraisal_cycle_id` (`appraisal_cycle_id`),
  KEY `idx_cycle_period` (`period`),
  CONSTRAINT `performance_feedback_cycle_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `employees` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `performance_feedback_cycle_ibfk_2` FOREIGN KEY (`appraisal_cycle_id`) REFERENCES `appraisal_cycle` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `performance_feedback_report`
--

DROP TABLE IF EXISTS `performance_feedback_report`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_feedback_report` (
  `report_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cycle_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `overall_score` decimal(3,2) DEFAULT NULL,
  `strengths` text COLLATE utf8mb4_unicode_ci,
  `development_areas` text COLLATE utf8mb4_unicode_ci,
  `total_reviewers` int DEFAULT '0',
  `manager_feedback` text COLLATE utf8mb4_unicode_ci,
  `report_generated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `shared_with_employee_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`report_id`),
  UNIQUE KEY `unique_report` (`cycle_id`,`employee_id`),
  KEY `employee_id` (`employee_id`),
  KEY `idx_cycle_employee` (`cycle_id`,`employee_id`),
  KEY `idx_overall_score` (`overall_score`),
  CONSTRAINT `performance_feedback_report_ibfk_1` FOREIGN KEY (`cycle_id`) REFERENCES `performance_feedback_cycle` (`cycle_id`) ON DELETE CASCADE,
  CONSTRAINT `performance_feedback_report_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `performance_feedback_request`
--

DROP TABLE IF EXISTS `performance_feedback_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_feedback_request` (
  `request_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cycle_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reviewer_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reviewer_type` enum('manager','peer','direct-report','self') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','completed','declined','expired') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `requested_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  `reminder_sent_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  UNIQUE KEY `unique_review` (`cycle_id`,`employee_id`,`reviewer_id`),
  KEY `employee_id` (`employee_id`),
  KEY `idx_cycle_employee` (`cycle_id`,`employee_id`),
  KEY `idx_reviewer_status` (`reviewer_id`,`status`),
  CONSTRAINT `performance_feedback_request_ibfk_1` FOREIGN KEY (`cycle_id`) REFERENCES `performance_feedback_cycle` (`cycle_id`) ON DELETE CASCADE,
  CONSTRAINT `performance_feedback_request_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `performance_feedback_request_ibfk_3` FOREIGN KEY (`reviewer_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `performance_feedback_response`
--

DROP TABLE IF EXISTS `performance_feedback_response`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_feedback_response` (
  `response_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `request_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `competency_id` int NOT NULL,
  `rating` tinyint NOT NULL,
  `comments` text COLLATE utf8mb4_unicode_ci,
  `submitted_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`response_id`),
  UNIQUE KEY `unique_response` (`request_id`,`competency_id`),
  KEY `idx_request` (`request_id`),
  KEY `idx_competency` (`competency_id`),
  CONSTRAINT `performance_feedback_response_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `performance_feedback_request` (`request_id`) ON DELETE CASCADE,
  CONSTRAINT `performance_feedback_response_ibfk_2` FOREIGN KEY (`competency_id`) REFERENCES `competency_master` (`competency_id`) ON DELETE RESTRICT,
  CONSTRAINT `performance_feedback_response_chk_1` CHECK ((`rating` between 1 and 5))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pip_checkpoint`
--

DROP TABLE IF EXISTS `pip_checkpoint`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pip_checkpoint` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `pip_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `checkpoint_date` date NOT NULL,
  `rating` enum('on_track','at_risk','off_track') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'on_track',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `recorded_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pip_check` (`pip_id`),
  CONSTRAINT `pip_checkpoint_ibfk_1` FOREIGN KEY (`pip_id`) REFERENCES `pip_record` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pip_record`
--

DROP TABLE IF EXISTS `pip_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pip_record` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `initiated_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `goals` json DEFAULT NULL,
  `status` enum('active','completed','extended','terminated') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `outcome` enum('improved','not_improved','resigned','terminated') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `review_notes` text COLLATE utf8mb4_unicode_ci,
  `closed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pip_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `policy_master`
--

DROP TABLE IF EXISTS `policy_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `policy_master` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `policy_name` varchar(128) NOT NULL,
  `policy_code` varchar(32) DEFAULT NULL,
  `description` text,
  `effective_date` date DEFAULT NULL,
  `version` varchar(16) DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `portal_access_log`
--

DROP TABLE IF EXISTS `portal_access_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `portal_access_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `client_user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `page` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pal_user` (`client_user_id`),
  KEY `idx_pal_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `portal_data_approval_queue`
--

DROP TABLE IF EXISTS `portal_data_approval_queue`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `portal_data_approval_queue` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `process_id` char(36) NOT NULL,
  `snapshot_type` enum('kpi','governance','attrition','staffing','quality') NOT NULL,
  `period` varchar(7) NOT NULL,
  `prepared_data` json NOT NULL,
  `prepared_by` char(36) DEFAULT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reviewed_by` char(36) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `rejection_reason` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `portal_otp`
--

DROP TABLE IF EXISTS `portal_otp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `portal_otp` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `otp_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_portal_otp_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `portal_published_snapshot`
--

DROP TABLE IF EXISTS `portal_published_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `portal_published_snapshot` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `process_id` char(36) NOT NULL,
  `snapshot_type` enum('kpi','governance','attrition','staffing','quality') NOT NULL,
  `period` varchar(7) NOT NULL COMMENT 'YYYY-MM',
  `snapshot_data` json NOT NULL COMMENT 'Pre-aggregated, masked data approved for client view',
  `approved_by` char(36) NOT NULL,
  `approved_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `notes` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pps_process` (`process_id`,`snapshot_type`,`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `portal_roster_aggregate`
--

DROP TABLE IF EXISTS `portal_roster_aggregate`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `portal_roster_aggregate` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cycle_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `week_start_date` date NOT NULL,
  `required_hc` int NOT NULL DEFAULT '0',
  `rostered_hc` int NOT NULL DEFAULT '0',
  `coverage_pct` decimal(5,2) DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pra` (`cycle_id`,`process_id`),
  KEY `process_id` (`process_id`),
  CONSTRAINT `portal_roster_aggregate_ibfk_1` FOREIGN KEY (`cycle_id`) REFERENCES `weekly_roster_cycle` (`id`) ON DELETE CASCADE,
  CONSTRAINT `portal_roster_aggregate_ibfk_2` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `posh_complaint`
--

DROP TABLE IF EXISTS `posh_complaint`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `posh_complaint` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `complaint_ref` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `complainant_anon_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Anonymised — no real name stored in this field',
  `respondent_anon_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Anonymised',
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date_of_complaint` date NOT NULL,
  `nature_of_complaint` text COLLATE utf8mb4_unicode_ci,
  `icc_members` json DEFAULT NULL COMMENT 'Array of user_ids of ICC committee members',
  `status` enum('received','under_inquiry','settled','closed','referred_to_police') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'received',
  `outcome` enum('substantiated','not_substantiated','malicious_complaint','conciliation') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `closure_date` date DEFAULT NULL,
  `annual_report_year` int DEFAULT NULL COMMENT 'For annual report aggregation',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `complaint_ref` (`complaint_ref`),
  KEY `idx_posh_year` (`annual_report_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `process_master`
--

DROP TABLE IF EXISTS `process_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `process_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `process_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_lob` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `client_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `process_code` (`process_code`),
  KEY `branch_id` (`branch_id`),
  KEY `fk_process_client` (`client_id`),
  CONSTRAINT `fk_process_client` FOREIGN KEY (`client_id`) REFERENCES `client_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `process_master_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `process_weekoff_capacity`
--

DROP TABLE IF EXISTS `process_weekoff_capacity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `process_weekoff_capacity` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `day_of_week` int NOT NULL COMMENT '0=Sunday, 1=Monday, ... 6=Saturday',
  `max_weekoff_count` int NOT NULL COMMENT 'Max employees who can take this day off',
  `max_weekoff_percentage` decimal(5,2) DEFAULT NULL COMMENT 'Max % of process strength',
  `auto_approve_enabled` tinyint(1) DEFAULT '0',
  `auto_approve_threshold` int DEFAULT NULL COMMENT 'Auto-approve until this many slots filled',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_process_day` (`process_id`,`day_of_week`),
  KEY `idx_process_day` (`process_id`,`day_of_week`),
  CONSTRAINT `process_weekoff_capacity_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE CASCADE,
  CONSTRAINT `process_weekoff_capacity_chk_1` CHECK ((`day_of_week` between 0 and 6)),
  CONSTRAINT `process_weekoff_capacity_chk_2` CHECK ((`max_weekoff_count` >= 0)),
  CONSTRAINT `process_weekoff_capacity_chk_3` CHECK (((`max_weekoff_percentage` is null) or (`max_weekoff_percentage` between 0 and 100)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `procurement_request`
--

DROP TABLE IF EXISTS `procurement_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `procurement_request` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `req_code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `requested_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `item_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `estimated_cost` decimal(10,2) DEFAULT NULL,
  `vendor_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `required_by` date DEFAULT NULL,
  `justification` text COLLATE utf8mb4_unicode_ci,
  `status` enum('draft','submitted','approved','ordered','received','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `req_code` (`req_code`),
  KEY `idx_proc_req` (`requested_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `promotion_record`
--

DROP TABLE IF EXISTS `promotion_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `promotion_record` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_designation` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_designation` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_grade` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_grade` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effective_date` date NOT NULL,
  `salary_revision` decimal(12,2) DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','approved','rejected','completed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `initiated_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_promo_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pt_slab_master`
--

DROP TABLE IF EXISTS `pt_slab_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pt_slab_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `state_code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `state_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `income_from` decimal(10,2) NOT NULL DEFAULT '0.00',
  `income_to` decimal(10,2) DEFAULT NULL COMMENT 'NULL = no upper limit',
  `pt_amount` decimal(8,2) NOT NULL DEFAULT '0.00',
  `frequency` enum('monthly','half_yearly','annually') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'monthly',
  `effective_from` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_pt_state` (`state_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pulse_check`
--

DROP TABLE IF EXISTS `pulse_check`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pulse_check` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `pulse_question` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `pulse_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'mood, stress, workload, satisfaction',
  `response_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'emoji_5' COMMENT 'emoji_5, rating_5, yes_no',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_type` (`pulse_type`),
  KEY `idx_active` (`active_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pulse_response`
--

DROP TABLE IF EXISTS `pulse_response`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pulse_response` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `pulse_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `response_value` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `response_date` date NOT NULL,
  `response_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pulse_employee_date` (`pulse_id`,`employee_id`,`response_date`),
  KEY `idx_pulse` (`pulse_id`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_date` (`response_date`),
  CONSTRAINT `pulse_response_ibfk_1` FOREIGN KEY (`pulse_id`) REFERENCES `pulse_check` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pulse_response_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reimbursement_claim`
--

DROP TABLE IF EXISTS `reimbursement_claim`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reimbursement_claim` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `claim_type` enum('travel','medical','meal','equipment','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `amount` decimal(10,2) NOT NULL,
  `claim_date` date NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `receipt_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','submitted','approved','rejected','paid') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `reviewed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_claim_emp` (`employee_id`),
  KEY `idx_claim_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reporting_hierarchy`
--

DROP TABLE IF EXISTS `reporting_hierarchy`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reporting_hierarchy` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reports_to_employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `hierarchy_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'direct',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_hierarchy` (`employee_id`,`hierarchy_type`,`effective_from`),
  KEY `idx_rh_employee` (`employee_id`),
  KEY `reports_to_employee_id` (`reports_to_employee_id`),
  CONSTRAINT `reporting_hierarchy_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reporting_hierarchy_ibfk_2` FOREIGN KEY (`reports_to_employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `role_kpi_snapshot`
--

DROP TABLE IF EXISTS `role_kpi_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_kpi_snapshot` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `snapshot_date` date NOT NULL,
  `role_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kpi_code` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actual_value` decimal(10,4) DEFAULT NULL,
  `target_value` decimal(10,4) DEFAULT NULL,
  `achievement_pct` decimal(6,2) DEFAULT NULL,
  `source` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kpi_snap` (`employee_id`,`snapshot_date`,`kpi_code`),
  KEY `idx_kpi_snap_emp` (`employee_id`),
  KEY `idx_kpi_snap_date` (`snapshot_date`),
  CONSTRAINT `role_kpi_snapshot_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `role_page_access`
--

DROP TABLE IF EXISTS `role_page_access`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_page_access` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `role_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `page_code` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `can_view` tinyint(1) NOT NULL DEFAULT '0',
  `can_create` tinyint(1) NOT NULL DEFAULT '0',
  `can_edit` tinyint(1) NOT NULL DEFAULT '0',
  `can_delete` tinyint(1) NOT NULL DEFAULT '0',
  `can_export` tinyint(1) NOT NULL DEFAULT '0',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_page` (`role_key`,`page_code`),
  KEY `idx_role_page_role` (`role_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `roster_assignment`
--

DROP TABLE IF EXISTS `roster_assignment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roster_assignment` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `roster_date` date NOT NULL,
  `shift_template_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_week_off` tinyint(1) DEFAULT '0',
  `acknowledgement_status` enum('pending','acknowledged','disputed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `acknowledged_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_employee_date` (`employee_id`,`roster_date`),
  KEY `idx_date` (`roster_date`),
  KEY `idx_shift` (`shift_template_id`),
  KEY `idx_status` (`acknowledgement_status`),
  CONSTRAINT `roster_assignment_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `roster_assignment_ibfk_2` FOREIGN KEY (`shift_template_id`) REFERENCES `wfm_shift_template` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `roster_change_log`
--

DROP TABLE IF EXISTS `roster_change_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roster_change_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cycle_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `change_type` enum('shift_change','week_off_change','swap','addition','removal') COLLATE utf8mb4_unicode_ci NOT NULL,
  `old_value_json` json DEFAULT NULL,
  `new_value_json` json DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `change_date` date NOT NULL,
  `changed_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rcl_cycle` (`cycle_id`),
  CONSTRAINT `roster_change_log_ibfk_1` FOREIGN KEY (`cycle_id`) REFERENCES `weekly_roster_cycle` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `roster_coverage_action`
--

DROP TABLE IF EXISTS `roster_coverage_action`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roster_coverage_action` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cycle_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_date` date NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `coverage_gap` int NOT NULL DEFAULT '0',
  `root_cause` text COLLATE utf8mb4_unicode_ci,
  `recovery_plan` text COLLATE utf8mb4_unicode_ci,
  `owner_user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `due_by` date DEFAULT NULL,
  `status` enum('open','in_progress','resolved','escalated') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `resolved_at` datetime DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rca_cycle` (`cycle_id`),
  KEY `idx_rca_status` (`status`),
  CONSTRAINT `roster_coverage_action_ibfk_1` FOREIGN KEY (`cycle_id`) REFERENCES `weekly_roster_cycle` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `roster_daily_assignment`
--

DROP TABLE IF EXISTS `roster_daily_assignment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roster_daily_assignment` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `cycle_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `roster_date` date NOT NULL,
  `shift_template_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_week_off` tinyint(1) NOT NULL DEFAULT '0',
  `is_holiday` tinyint(1) NOT NULL DEFAULT '0',
  `acknowledgement_status` enum('pending','acknowledged','disputed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `acknowledged_at` datetime DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rda` (`cycle_id`,`employee_id`,`roster_date`),
  KEY `idx_rda_employee` (`employee_id`),
  KEY `idx_rda_date` (`roster_date`),
  KEY `shift_template_id` (`shift_template_id`),
  CONSTRAINT `roster_daily_assignment_ibfk_1` FOREIGN KEY (`cycle_id`) REFERENCES `weekly_roster_cycle` (`id`) ON DELETE CASCADE,
  CONSTRAINT `roster_daily_assignment_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `roster_daily_assignment_ibfk_3` FOREIGN KEY (`shift_template_id`) REFERENCES `wfm_shift_template` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `roster_generation_log`
--

DROP TABLE IF EXISTS `roster_generation_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roster_generation_log` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `employee_count` int NOT NULL,
  `assignments_created` int NOT NULL,
  `assignments_skipped` int NOT NULL,
  `errors_count` int DEFAULT '0',
  `error_details` json DEFAULT NULL,
  `generated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `generated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_template` (`template_id`),
  KEY `idx_process` (`process_id`),
  KEY `idx_date_range` (`start_date`,`end_date`),
  KEY `idx_generated_by` (`generated_by`),
  CONSTRAINT `roster_generation_log_ibfk_1` FOREIGN KEY (`template_id`) REFERENCES `roster_template` (`id`) ON DELETE CASCADE,
  CONSTRAINT `roster_generation_log_ibfk_2` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE CASCADE,
  CONSTRAINT `roster_generation_log_ibfk_3` FOREIGN KEY (`generated_by`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `roster_template`
--

DROP TABLE IF EXISTS `roster_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roster_template` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pattern_type` enum('fixed','rotation','custom') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'fixed',
  `cycle_days` int NOT NULL DEFAULT '7' COMMENT '7=weekly, 14=bi-weekly, 28=monthly',
  `pattern_json` json NOT NULL COMMENT 'Roster pattern definition',
  `support_ratio_min` decimal(5,2) DEFAULT NULL COMMENT 'Minimum on-duty percentage',
  `support_ratio_max` decimal(5,2) DEFAULT NULL COMMENT 'Maximum on-duty percentage',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_process_active` (`process_id`,`is_active`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `roster_template_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE CASCADE,
  CONSTRAINT `roster_template_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salary_advance_log`
--

DROP TABLE IF EXISTS `salary_advance_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_advance_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `advance_date` date NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `recovery_months` int NOT NULL DEFAULT '1',
  `recovered_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `employee_id` (`employee_id`),
  CONSTRAINT `salary_advance_log_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salary_band_master`
--

DROP TABLE IF EXISTS `salary_band_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_band_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `band_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `band_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `min_ctc` decimal(12,2) NOT NULL,
  `max_ctc` decimal(12,2) NOT NULL,
  `basic_pct` decimal(5,2) NOT NULL DEFAULT '40.00',
  `hra_pct` decimal(5,2) NOT NULL DEFAULT '40.00',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `band_code` (`band_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salary_component_master`
--

DROP TABLE IF EXISTS `salary_component_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_component_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `component_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `component_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `component_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `taxable` tinyint(1) NOT NULL DEFAULT '1',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `component_code` (`component_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salary_deduction_rule`
--

DROP TABLE IF EXISTS `salary_deduction_rule`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_deduction_rule` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `rule_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rule_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `applies_to` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'all',
  `value` decimal(10,4) NOT NULL DEFAULT '0.0000',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salary_payslip`
--

DROP TABLE IF EXISTS `salary_payslip`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_payslip` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `prep_line_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `run_month` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `generated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `generated_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acknowledged_at` datetime DEFAULT NULL,
  `payslip_ref` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `prep_line_id` (`prep_line_id`),
  KEY `employee_id` (`employee_id`),
  CONSTRAINT `salary_payslip_ibfk_1` FOREIGN KEY (`prep_line_id`) REFERENCES `salary_prep_line` (`id`) ON DELETE CASCADE,
  CONSTRAINT `salary_payslip_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salary_prep_line`
--

DROP TABLE IF EXISTS `salary_prep_line`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_prep_line` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `run_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `working_days` decimal(6,2) NOT NULL DEFAULT '0.00',
  `present_days` decimal(6,2) NOT NULL DEFAULT '0.00',
  `leave_days` decimal(6,2) NOT NULL DEFAULT '0.00',
  `lwp_days` decimal(6,2) NOT NULL DEFAULT '0.00',
  `late_marks` int NOT NULL DEFAULT '0',
  `dialer_hours` decimal(8,2) DEFAULT NULL,
  `gross_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_deductions` decimal(12,2) NOT NULL DEFAULT '0.00',
  `net_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
  `pf_employee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `pf_employer` decimal(10,2) NOT NULL DEFAULT '0.00',
  `esic_employee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `esic_employer` decimal(10,2) NOT NULL DEFAULT '0.00',
  `professional_tax` decimal(10,2) NOT NULL DEFAULT '0.00',
  `tds` decimal(10,2) NOT NULL DEFAULT '0.00',
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `tds_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `lwp_deduction` decimal(10,2) NOT NULL DEFAULT '0.00',
  `advance_recovery` decimal(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_run_emp` (`run_id`,`employee_id`),
  KEY `employee_id` (`employee_id`),
  CONSTRAINT `salary_prep_line_ibfk_1` FOREIGN KEY (`run_id`) REFERENCES `salary_prep_run` (`id`) ON DELETE CASCADE,
  CONSTRAINT `salary_prep_line_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salary_prep_run`
--

DROP TABLE IF EXISTS `salary_prep_run`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_prep_run` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `run_month` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_filter` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_filter` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `total_employees` int NOT NULL DEFAULT '0',
  `total_gross` decimal(14,2) NOT NULL DEFAULT '0.00',
  `total_deductions` decimal(14,2) NOT NULL DEFAULT '0.00',
  `total_net` decimal(14,2) NOT NULL DEFAULT '0.00',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `disbursed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `disbursed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_run_month_branch_process` (`run_month`,`branch_filter`,`process_filter`),
  KEY `idx_run_month` (`run_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salary_structure_component`
--

DROP TABLE IF EXISTS `salary_structure_component`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_structure_component` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `structure_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `component_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `calc_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'fixed',
  `value` decimal(10,4) NOT NULL DEFAULT '0.0000',
  `sequence` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_struct_comp` (`structure_id`,`component_id`),
  KEY `component_id` (`component_id`),
  CONSTRAINT `salary_structure_component_ibfk_1` FOREIGN KEY (`structure_id`) REFERENCES `salary_structure_master` (`id`) ON DELETE CASCADE,
  CONSTRAINT `salary_structure_component_ibfk_2` FOREIGN KEY (`component_id`) REFERENCES `salary_component_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salary_structure_master`
--

DROP TABLE IF EXISTS `salary_structure_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_structure_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `structure_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `structure_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `basic_pct` decimal(5,2) NOT NULL DEFAULT '40.00',
  `hra_pct` decimal(5,2) NOT NULL DEFAULT '20.00',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `structure_code` (`structure_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `schema_migrations`
--

DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `applied_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sensitive_action_log`
--

DROP TABLE IF EXISTS `sensitive_action_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sensitive_action_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `actor_user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `change_summary` json DEFAULT NULL,
  `acted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sal_actor` (`actor_user_id`),
  KEY `idx_sal_action` (`action_type`),
  KEY `idx_sal_entity` (`entity_type`,`entity_id`),
  KEY `idx_sal_time` (`acted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shrinkage_daily_snapshot`
--

DROP TABLE IF EXISTS `shrinkage_daily_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shrinkage_daily_snapshot` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `snapshot_date` date NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rostered_hc` int NOT NULL DEFAULT '0',
  `present_hc` int NOT NULL DEFAULT '0',
  `absent_hc` int NOT NULL DEFAULT '0',
  `on_leave_hc` int NOT NULL DEFAULT '0',
  `late_count` int NOT NULL DEFAULT '0',
  `planned_shrinkage_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `unplanned_shrinkage_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `total_shrinkage_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `avg_adherence_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `avg_productive_mins` int NOT NULL DEFAULT '0',
  `total_break_mins` int NOT NULL DEFAULT '0',
  `break_breach_count` int NOT NULL DEFAULT '0',
  `attendance_locked` tinyint(1) NOT NULL DEFAULT '0',
  `locked_at` datetime DEFAULT NULL,
  `locked_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_shr_date_proc` (`snapshot_date`,`process_id`,`branch_id`),
  KEY `idx_shr_date` (`snapshot_date`),
  KEY `process_id` (`process_id`),
  KEY `branch_id` (`branch_id`),
  CONSTRAINT `shrinkage_daily_snapshot_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `shrinkage_daily_snapshot_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `skill_master`
--

DROP TABLE IF EXISTS `skill_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `skill_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `skill_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `skill_category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `skill_name` (`skill_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `statutory_config`
--

DROP TABLE IF EXISTS `statutory_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `statutory_config` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `config_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_value` decimal(10,4) NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effective_from` date DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `support_role_ratio`
--

DROP TABLE IF EXISTS `support_role_ratio`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `support_role_ratio` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'FK process_master.id; NULL = global default',
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'FK branch_master.id; NULL = all branches',
  `support_role` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'team_leader|qa|rtm_rta|sme|am|trainer|wfm|mis|hr|it',
  `ratio_type` enum('per_agents','per_tl','per_batch','per_trainee_count') COLLATE utf8mb4_unicode_ci NOT NULL,
  `ratio_value` decimal(6,2) NOT NULL COMMENT '15 = 1 support per 15 agents',
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Ratio rules mapping support roles to production headcount or batch sizes';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `survey_question`
--

DROP TABLE IF EXISTS `survey_question`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `survey_question` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `survey_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'text, rating_5, rating_10, multiple_choice, yes_no',
  `options_json` json DEFAULT NULL COMMENT 'For multiple choice questions',
  `is_required` tinyint(1) NOT NULL DEFAULT '1',
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_survey` (`survey_id`),
  KEY `idx_order` (`display_order`),
  CONSTRAINT `survey_question_ibfk_1` FOREIGN KEY (`survey_id`) REFERENCES `survey_template` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `survey_response`
--

DROP TABLE IF EXISTS `survey_response`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `survey_response` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `survey_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `response_value` text COLLATE utf8mb4_unicode_ci,
  `response_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_survey_question_employee` (`survey_id`,`question_id`,`employee_id`),
  KEY `question_id` (`question_id`),
  KEY `idx_survey` (`survey_id`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_survey_employee` (`survey_id`,`employee_id`),
  KEY `idx_date` (`response_date`),
  CONSTRAINT `survey_response_ibfk_1` FOREIGN KEY (`survey_id`) REFERENCES `survey_template` (`id`) ON DELETE CASCADE,
  CONSTRAINT `survey_response_ibfk_2` FOREIGN KEY (`question_id`) REFERENCES `survey_question` (`id`) ON DELETE CASCADE,
  CONSTRAINT `survey_response_ibfk_3` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `survey_template`
--

DROP TABLE IF EXISTS `survey_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `survey_template` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `survey_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `survey_title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `survey_description` text COLLATE utf8mb4_unicode_ci,
  `survey_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'engagement, satisfaction, exit, onboarding, etc',
  `target_audience` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'all, department, process, branch, custom',
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `survey_code` (`survey_code`),
  KEY `idx_type` (`survey_type`),
  KEY `idx_active` (`active_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tax_declaration`
--

DROP TABLE IF EXISTS `tax_declaration`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tax_declaration` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `financial_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Format: YYYY-YYYY e.g. 2026-2027',
  `regime` enum('old','new') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new',
  `total_investment` decimal(12,2) NOT NULL DEFAULT '0.00',
  `declared_hra` decimal(12,2) NOT NULL DEFAULT '0.00',
  `declared_80c` decimal(12,2) NOT NULL DEFAULT '0.00',
  `declared_80d` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tds_projected` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT 'Projected annual TDS — provisional only',
  `submitted_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_taxdecl_emp_year` (`employee_id`,`financial_year`),
  KEY `idx_taxdecl_employee` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tenant_config`
--

DROP TABLE IF EXISTS `tenant_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_config` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `tenant_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'default',
  `company_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `config_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tenant_key` (`tenant_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tenant_module_config`
--

DROP TABLE IF EXISTS `tenant_module_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_module_config` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `tenant_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'default',
  `module_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `config_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_module` (`tenant_key`,`module_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `training_need`
--

DROP TABLE IF EXISTS `training_need`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_need` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metric_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'KPI metric that triggered the need',
  `coaching_session_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Source coaching session if auto-created',
  `need_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'product_knowledge,soft_skills,compliance,technical,process',
  `description` text COLLATE utf8mb4_unicode_ci,
  `priority` enum('low','medium','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `status` enum('identified','mapped_to_lms','in_training','completed','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'identified',
  `identified_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tni_emp` (`employee_id`),
  KEY `idx_tni_metric` (`metric_id`),
  KEY `idx_tni_coaching` (`coaching_session_id`),
  KEY `idx_tni_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `transfer_record`
--

DROP TABLE IF EXISTS `transfer_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transfer_record` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `transfer_type` enum('branch','department','process','location','reporting') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'department',
  `from_value` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `to_value` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `effective_date` date NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','approved','rejected','completed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `initiated_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transfer_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `upload_batch`
--

DROP TABLE IF EXISTS `upload_batch`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `upload_batch` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `upload_batch_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `upload_type_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size_bytes` int DEFAULT NULL,
  `total_rows` int NOT NULL DEFAULT '0',
  `valid_rows` int NOT NULL DEFAULT '0',
  `error_rows` int NOT NULL DEFAULT '0',
  `imported_rows` int NOT NULL DEFAULT '0',
  `batch_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `error_summary` text COLLATE utf8mb4_unicode_ci,
  `metadata` json DEFAULT NULL,
  `uploaded_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `validated_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `validated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `upload_batch_no` (`upload_batch_no`),
  KEY `idx_batch_no` (`upload_batch_no`),
  KEY `idx_batch_status` (`batch_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `upload_batch_row`
--

DROP TABLE IF EXISTS `upload_batch_row`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `upload_batch_row` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `upload_batch_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `row_no` int NOT NULL,
  `raw_data` json DEFAULT NULL,
  `normalized_data` json DEFAULT NULL,
  `row_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `error_messages` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_batch_row` (`upload_batch_id`,`row_no`),
  CONSTRAINT `upload_batch_row_ibfk_1` FOREIGN KEY (`upload_batch_id`) REFERENCES `upload_batch` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_assignment_scope`
--

DROP TABLE IF EXISTS `user_assignment_scope`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_assignment_scope` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lob_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manager_employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scope_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_roles`
--

DROP TABLE IF EXISTS `user_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_roles` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_role` (`user_id`,`role_key`),
  KEY `idx_user_roles_user` (`user_id`),
  KEY `role_key` (`role_key`),
  CONSTRAINT `user_roles_ibfk_1` FOREIGN KEY (`role_key`) REFERENCES `workforce_role_catalog` (`role_key`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `v_active_customization_rules`
--

DROP TABLE IF EXISTS `v_active_customization_rules`;
/*!50001 DROP VIEW IF EXISTS `v_active_customization_rules`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_active_customization_rules` AS SELECT 
 1 AS `id`,
 1 AS `rule_name`,
 1 AS `entity_type`,
 1 AS `entity_id`,
 1 AS `branch_ids`,
 1 AS `process_ids`,
 1 AS `department_ids`,
 1 AS `designation_ids`,
 1 AS `role_ids`,
 1 AS `employee_ids`,
 1 AS `config_type`,
 1 AS `config_data`,
 1 AS `priority`,
 1 AS `effective_from`,
 1 AS `effective_to`,
 1 AS `created_by`,
 1 AS `created_at`,
 1 AS `updated_at`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_customization_application_summary`
--

DROP TABLE IF EXISTS `v_customization_application_summary`;
/*!50001 DROP VIEW IF EXISTS `v_customization_application_summary`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_customization_application_summary` AS SELECT 
 1 AS `entity_type`,
 1 AS `unique_employees`,
 1 AS `total_applications`,
 1 AS `application_date`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_customization_cache_stats`
--

DROP TABLE IF EXISTS `v_customization_cache_stats`;
/*!50001 DROP VIEW IF EXISTS `v_customization_cache_stats`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_customization_cache_stats` AS SELECT 
 1 AS `entity_type`,
 1 AS `total_cached`,
 1 AS `total_hits`,
 1 AS `avg_hits_per_entry`,
 1 AS `oldest_cache`,
 1 AS `newest_cache`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `vendor_master`
--

DROP TABLE IF EXISTS `vendor_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `vendor_code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendor_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendor_type` enum('supplier','service','contractor','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'supplier',
  `contact_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `gst_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pan_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payment_terms` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `vendor_code` (`vendor_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `walkin_queue`
--

DROP TABLE IF EXISTS `walkin_queue`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `walkin_queue` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `token_number` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `candidate_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `applied_role` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `registered_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `called_at` datetime DEFAULT NULL,
  `status` enum('waiting','called','in_interview','completed','no_show') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'waiting',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `recruiter_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_walkin_branch` (`branch_id`),
  KEY `idx_walkin_status` (`status`),
  KEY `idx_walkin_date` (`registered_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `week_off_preference`
--

DROP TABLE IF EXISTS `week_off_preference`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `week_off_preference` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `preferred_day` int NOT NULL COMMENT '0=Sunday, 1=Monday, ... 6=Saturday',
  `alternate_day` int DEFAULT NULL COMMENT 'Alternate week-off day',
  `approved` tinyint(1) DEFAULT '0',
  `approved_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `submission_order` int DEFAULT NULL COMMENT 'FCFS submission sequence per process',
  `auto_approved` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_approved` (`approved`,`approved_by`),
  KEY `approved_by` (`approved_by`),
  KEY `idx_submission_order` (`employee_id`,`submission_order`),
  CONSTRAINT `week_off_preference_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `week_off_preference_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `employees` (`id`) ON DELETE SET NULL,
  CONSTRAINT `week_off_preference_chk_1` CHECK ((`preferred_day` between 0 and 6)),
  CONSTRAINT `week_off_preference_chk_2` CHECK (((`alternate_day` is null) or (`alternate_day` between 0 and 6)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `weekly_roster_cycle`
--

DROP TABLE IF EXISTS `weekly_roster_cycle`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `weekly_roster_cycle` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `process_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `week_start_date` date NOT NULL,
  `week_end_date` date NOT NULL,
  `status` enum('draft','submitted','reviewed','published','acknowledged','active','variance_review','attendance_locked','payroll_input_ready','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `required_hc_json` json DEFAULT NULL,
  `published_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  `locked_at` datetime DEFAULT NULL,
  `payroll_ready_at` datetime DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cycle` (`process_id`,`week_start_date`),
  KEY `idx_cycle_process` (`process_id`),
  KEY `idx_cycle_status` (`status`),
  KEY `branch_id` (`branch_id`),
  CONSTRAINT `weekly_roster_cycle_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE CASCADE,
  CONSTRAINT `weekly_roster_cycle_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `weekoff_allocation_log`
--

DROP TABLE IF EXISTS `weekoff_allocation_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `weekoff_allocation_log` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `day_of_week` int NOT NULL,
  `allocation_date` date NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `preference_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `allocation_sequence` int NOT NULL COMMENT 'FCFS sequence number',
  `allocation_status` enum('allocated','waitlisted','denied') COLLATE utf8mb4_unicode_ci DEFAULT 'allocated',
  `auto_approved` tinyint(1) DEFAULT '0',
  `allocated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_process_date` (`process_id`,`allocation_date`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_sequence` (`process_id`,`day_of_week`,`allocation_sequence`),
  KEY `preference_id` (`preference_id`),
  CONSTRAINT `weekoff_allocation_log_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE CASCADE,
  CONSTRAINT `weekoff_allocation_log_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `weekoff_allocation_log_ibfk_3` FOREIGN KEY (`preference_id`) REFERENCES `week_off_preference` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `weekoff_preference_notification`
--

DROP TABLE IF EXISTS `weekoff_preference_notification`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `weekoff_preference_notification` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `preference_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `notification_type` enum('approved','denied','waitlisted','capacity_full') COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `roster_date` date DEFAULT NULL COMMENT 'Date when preference could not be fulfilled',
  `is_read` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_employee_read` (`employee_id`,`is_read`),
  KEY `idx_preference` (`preference_id`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `weekoff_preference_notification_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `weekoff_preference_notification_ibfk_2` FOREIGN KEY (`preference_id`) REFERENCES `week_off_preference` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_attendance_session`
--

DROP TABLE IF EXISTS `wfm_attendance_session`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_attendance_session` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `roster_assignment_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `session_date` date NOT NULL,
  `login_time` datetime DEFAULT NULL,
  `logout_time` datetime DEFAULT NULL,
  `total_login_minutes` int NOT NULL DEFAULT '0',
  `current_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Rostered',
  `punch_source` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MANUAL',
  `external_punch_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `facial_device_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `biometric_user_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `regularization_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_session_date` (`employee_id`,`session_date`),
  KEY `idx_session_date` (`session_date`),
  KEY `idx_session_status` (`current_status`),
  CONSTRAINT `wfm_attendance_session_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_break_log`
--

DROP TABLE IF EXISTS `wfm_break_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_break_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `session_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `break_start` datetime NOT NULL,
  `break_end` datetime DEFAULT NULL,
  `duration_minutes` int NOT NULL DEFAULT '0',
  `break_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Break',
  `punch_source` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MANUAL',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `employee_id` (`employee_id`),
  KEY `idx_break_session` (`session_id`),
  CONSTRAINT `wfm_break_log_ibfk_1` FOREIGN KEY (`session_id`) REFERENCES `wfm_attendance_session` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wfm_break_log_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_client_slot_requirement`
--

DROP TABLE IF EXISTS `wfm_client_slot_requirement`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_client_slot_requirement` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requirement_date` date DEFAULT NULL,
  `day_of_week` tinyint DEFAULT NULL,
  `slot_start` time NOT NULL,
  `slot_end` time NOT NULL,
  `required_hc` int NOT NULL DEFAULT '0',
  `shrinkage_pct` decimal(5,2) DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wfm_slot_req_process_date` (`process_id`,`requirement_date`),
  KEY `idx_wfm_slot_req_branch_date` (`branch_id`,`requirement_date`),
  KEY `idx_wfm_slot_req_day` (`process_id`,`branch_id`,`day_of_week`,`active_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_coverage_snapshot`
--

DROP TABLE IF EXISTS `wfm_coverage_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_coverage_snapshot` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `snapshot_date` date NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `planned_headcount` int NOT NULL DEFAULT '0',
  `actual_headcount` int NOT NULL DEFAULT '0',
  `absent_count` int NOT NULL DEFAULT '0',
  `leave_count` int NOT NULL DEFAULT '0',
  `shrinkage_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `coverage_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coverage_date_proc` (`snapshot_date`,`process_id`,`branch_id`),
  KEY `process_id` (`process_id`),
  KEY `branch_id` (`branch_id`),
  CONSTRAINT `wfm_coverage_snapshot_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `wfm_coverage_snapshot_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_external_punch_staging`
--

DROP TABLE IF EXISTS `wfm_external_punch_staging`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_external_punch_staging` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `device_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `external_punch_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employee_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `punch_time` datetime NOT NULL,
  `punch_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'IN',
  `raw_data` json DEFAULT NULL,
  `apply_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `applied_session_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `device_id` (`device_id`),
  KEY `idx_punch_staging_status` (`apply_status`),
  KEY `idx_punch_staging_code` (`employee_code`),
  CONSTRAINT `wfm_external_punch_staging_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `wfm_facial_device_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_facial_device_master`
--

DROP TABLE IF EXISTS `wfm_facial_device_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_facial_device_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `device_code` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `device_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `secret_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `device_code` (`device_code`),
  KEY `branch_id` (`branch_id`),
  CONSTRAINT `wfm_facial_device_master_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_acknowledgement`
--

DROP TABLE IF EXISTS `wfm_roster_acknowledgement`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_acknowledgement` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `assignment_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `change_request_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `acknowledgement_type` enum('publish','change') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'publish',
  `acknowledged_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `remarks` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wfm_roster_ack_assignment_change` (`assignment_id`,`change_request_id`),
  KEY `idx_wfm_roster_ack_employee` (`employee_id`,`acknowledged_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_approval_log`
--

DROP TABLE IF EXISTS `wfm_roster_approval_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_approval_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` enum('submitted','approved','rejected','published','locked','returned') COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_role` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remarks` varchar(700) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `coverage_snapshot_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wfm_approval_plan` (`plan_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_assignment`
--

DROP TABLE IF EXISTS `wfm_roster_assignment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_assignment` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `shift_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `roster_date` date NOT NULL,
  `roster_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Rostered',
  `shift_start_time` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'HH:MM override',
  `shift_end_time` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'HH:MM override',
  `branch_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manager_employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `team_leader_employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `publish_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_date` (`employee_id`,`roster_date`),
  KEY `shift_id` (`shift_id`),
  KEY `plan_id` (`plan_id`),
  KEY `idx_roster_date` (`roster_date`),
  CONSTRAINT `wfm_roster_assignment_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wfm_roster_assignment_ibfk_2` FOREIGN KEY (`shift_id`) REFERENCES `wfm_shift_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `wfm_roster_assignment_ibfk_3` FOREIGN KEY (`plan_id`) REFERENCES `wfm_roster_plan` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_assignment_control`
--

DROP TABLE IF EXISTS `wfm_roster_assignment_control`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_assignment_control` (
  `assignment_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `change_lock_status` enum('draft_editable','pm_change_only','attendance_locked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft_editable',
  `last_change_request_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acknowledgement_required` tinyint(1) NOT NULL DEFAULT '0',
  `acknowledgement_status` enum('not_required','pending','acknowledged') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_required',
  `last_notification_status` enum('pending','queued','sent','failed','not_required') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_required',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`assignment_id`),
  KEY `idx_wfm_assignment_control_plan` (`plan_id`,`change_lock_status`,`acknowledgement_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_change_request`
--

DROP TABLE IF EXISTS `wfm_roster_change_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_change_request` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `assignment_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `roster_date` date NOT NULL,
  `old_shift_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_shift_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `old_shift_start_time` time DEFAULT NULL,
  `old_shift_end_time` time DEFAULT NULL,
  `new_shift_start_time` time DEFAULT NULL,
  `new_shift_end_time` time DEFAULT NULL,
  `old_roster_status` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_roster_status` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `change_category` enum('shift_change','weekoff_change','leave_adjustment','emergency','support_staff_update') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'shift_change',
  `change_reason` varchar(700) COLLATE utf8mb4_unicode_ci NOT NULL,
  `impact_summary_json` json DEFAULT NULL,
  `requested_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('requested','approved','rejected','applied') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'applied',
  `notification_locked` tinyint(1) NOT NULL DEFAULT '1',
  `notification_status` enum('pending','queued','sent','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `approved_at` datetime DEFAULT NULL,
  `applied_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wfm_change_plan` (`plan_id`,`status`,`created_at`),
  KEY `idx_wfm_change_employee` (`employee_id`,`roster_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_conflict_log`
--

DROP TABLE IF EXISTS `wfm_roster_conflict_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_conflict_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `conflict_date` date NOT NULL,
  `conflict_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `resolved` tinyint(1) NOT NULL DEFAULT '0',
  `detected_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conflict_emp` (`employee_id`),
  CONSTRAINT `wfm_roster_conflict_log_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_coverage_matrix`
--

DROP TABLE IF EXISTS `wfm_roster_coverage_matrix`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_coverage_matrix` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `roster_date` date NOT NULL,
  `slot_start` time NOT NULL,
  `slot_end` time NOT NULL,
  `required_hc` int NOT NULL DEFAULT '0',
  `planned_hc` int NOT NULL DEFAULT '0',
  `buffer_hc` int NOT NULL DEFAULT '0',
  `gap_hc` int NOT NULL DEFAULT '0',
  `coverage_pct` decimal(7,2) NOT NULL DEFAULT '0.00',
  `shrinkage_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wfm_coverage_plan_date` (`plan_id`,`roster_date`),
  KEY `idx_wfm_coverage_gap` (`plan_id`,`gap_hc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_event_log`
--

DROP TABLE IF EXISTS `wfm_roster_event_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_event_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `assignment_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_type` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_message` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` enum('info','medium','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'info',
  `target_role` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wfm_event_plan` (`plan_id`,`created_at`),
  KEY `idx_wfm_event_target` (`target_role`,`target_employee_id`,`is_read`),
  KEY `idx_wfm_event_scope` (`process_id`,`branch_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_manager_task`
--

DROP TABLE IF EXISTS `wfm_roster_manager_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_manager_task` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `manager_employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manager_name` varchar(180) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `support_staff_count` int NOT NULL DEFAULT '0',
  `due_at` datetime DEFAULT NULL,
  `status` enum('pending','email_queued','submitted','approved','overdue','not_required') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `last_email_sent_at` datetime DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `notes` varchar(700) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wfm_manager_task_plan` (`plan_id`,`status`),
  KEY `idx_wfm_manager_task_manager` (`manager_employee_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_notification_log`
--

DROP TABLE IF EXISTS `wfm_roster_notification_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_notification_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `assignment_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `change_request_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employee_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notification_type` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body_preview` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','queued','sent','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `locked` tinyint(1) NOT NULL DEFAULT '1',
  `retry_count` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wfm_notification_plan` (`plan_id`,`notification_type`,`status`),
  KEY `idx_wfm_notification_employee` (`employee_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_plan`
--

DROP TABLE IF EXISTS `wfm_roster_plan`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_plan` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `plan_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `shift_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_date` date NOT NULL,
  `to_date` date NOT NULL,
  `required_headcount` int NOT NULL DEFAULT '0',
  `assigned_headcount` int NOT NULL DEFAULT '0',
  `plan_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `process_id` (`process_id`),
  KEY `branch_id` (`branch_id`),
  KEY `shift_id` (`shift_id`),
  KEY `idx_roster_plan_dates` (`from_date`,`to_date`),
  CONSTRAINT `wfm_roster_plan_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `wfm_roster_plan_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `wfm_roster_plan_ibfk_3` FOREIGN KEY (`shift_id`) REFERENCES `wfm_shift_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_plan_control`
--

DROP TABLE IF EXISTS `wfm_roster_plan_control`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_plan_control` (
  `plan_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `planning_mode` enum('manual','auto') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'auto',
  `shrinkage_pct` decimal(5,2) NOT NULL DEFAULT '15.00',
  `approval_status` enum('draft','generated','submitted','approved','rejected','published','locked','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `submitted_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `approved_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_remarks` varchar(700) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `publish_lock_status` enum('unlocked','published_locked','attendance_locked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unlocked',
  `notification_lock_required` tinyint(1) NOT NULL DEFAULT '1',
  `notification_status` enum('pending','queued','sent','failed','not_required') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `last_coverage_score` decimal(7,2) NOT NULL DEFAULT '0.00',
  `generated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`plan_id`),
  KEY `idx_wfm_plan_control_status` (`approval_status`,`publish_lock_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_roster_swap_request`
--

DROP TABLE IF EXISTS `wfm_roster_swap_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_roster_swap_request` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `requester_emp_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `swap_with_emp_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `swap_date` date NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `status` enum('pending','approved','rejected','withdrawn') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reviewed_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_swap_requester` (`requester_emp_id`),
  KEY `idx_swap_date` (`swap_date`),
  KEY `swap_with_emp_id` (`swap_with_emp_id`),
  CONSTRAINT `wfm_roster_swap_request_ibfk_1` FOREIGN KEY (`requester_emp_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wfm_roster_swap_request_ibfk_2` FOREIGN KEY (`swap_with_emp_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `wfm_shift`
--

DROP TABLE IF EXISTS `wfm_shift`;
/*!50001 DROP VIEW IF EXISTS `wfm_shift`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `wfm_shift` AS SELECT 
 1 AS `id`,
 1 AS `shift_code`,
 1 AS `shift_name`,
 1 AS `start_time`,
 1 AS `end_time`,
 1 AS `required_minutes`,
 1 AS `branch_name`,
 1 AS `process_name`,
 1 AS `active_status`,
 1 AS `created_at`,
 1 AS `updated_at`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `wfm_shift_master`
--

DROP TABLE IF EXISTS `wfm_shift_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_shift_master` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `shift_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `shift_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `required_minutes` int NOT NULL DEFAULT '540',
  `branch_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `process_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `shift_code` (`shift_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wfm_shift_template`
--

DROP TABLE IF EXISTS `wfm_shift_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wfm_shift_template` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `shift_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `version` int NOT NULL DEFAULT '1',
  `shift_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `productive_minutes` int NOT NULL DEFAULT '420',
  `grace_minutes` int NOT NULL DEFAULT '5',
  `break_entitlement` int NOT NULL DEFAULT '30',
  `weekly_off_pattern` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'sunday',
  `night_shift` tinyint(1) NOT NULL DEFAULT '0',
  `eligibility_rules` json DEFAULT NULL,
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_shift_version` (`shift_code`,`version`),
  KEY `idx_st_process` (`process_id`),
  KEY `branch_id` (`branch_id`),
  CONSTRAINT `wfm_shift_template_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `process_master` (`id`) ON DELETE SET NULL,
  CONSTRAINT `wfm_shift_template_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branch_master` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `work_inbox_item`
--

DROP TABLE IF EXISTS `work_inbox_item`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `work_inbox_item` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'leave_approval, exit_clearance, workflow_request, pip_checkpoint, asset_return, etc.',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `entity_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `priority` enum('low','normal','high','urgent') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `is_actioned` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inbox_user` (`user_id`),
  KEY `idx_inbox_unread` (`user_id`,`is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `workforce_mandate`
--

DROP TABLE IF EXISTS `workforce_mandate`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `workforce_mandate` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `client_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'client reference; NULL = internal',
  `process_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'FK process_master.id',
  `branch_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'FK branch_master.id',
  `lob` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'line of business',
  `role_group` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'e.g. inbound_agents, outbound_agents, support',
  `hc_type` enum('production','support') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'production',
  `mandated_hc` int NOT NULL DEFAULT '0',
  `buffer_pct` decimal(5,2) NOT NULL DEFAULT '10.00',
  `shrinkage_pct` decimal(5,2) NOT NULL DEFAULT '15.00',
  `attrition_buffer_pct` decimal(5,2) NOT NULL DEFAULT '5.00',
  `training_buffer_pct` decimal(5,2) NOT NULL DEFAULT '5.00',
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wm_process_branch_role_eff` (`process_id`,`branch_id`,`role_group`,`effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Per-process/branch headcount mandates with buffer and shrinkage parameters';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `workforce_role_catalog`
--

DROP TABLE IF EXISTS `workforce_role_catalog`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `workforce_role_catalog` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `role_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `active_status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_key` (`role_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping routines for database 'mas_hrms'
--

--
-- Final view structure for view `v_active_customization_rules`
--

/*!50001 DROP VIEW IF EXISTS `v_active_customization_rules`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`shivam_user`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_active_customization_rules` AS select `customization_rule`.`id` AS `id`,`customization_rule`.`rule_name` AS `rule_name`,`customization_rule`.`entity_type` AS `entity_type`,`customization_rule`.`entity_id` AS `entity_id`,`customization_rule`.`branch_ids` AS `branch_ids`,`customization_rule`.`process_ids` AS `process_ids`,`customization_rule`.`department_ids` AS `department_ids`,`customization_rule`.`designation_ids` AS `designation_ids`,`customization_rule`.`role_ids` AS `role_ids`,`customization_rule`.`employee_ids` AS `employee_ids`,`customization_rule`.`config_type` AS `config_type`,`customization_rule`.`config_data` AS `config_data`,`customization_rule`.`priority` AS `priority`,`customization_rule`.`effective_from` AS `effective_from`,`customization_rule`.`effective_to` AS `effective_to`,`customization_rule`.`created_by` AS `created_by`,`customization_rule`.`created_at` AS `created_at`,`customization_rule`.`updated_at` AS `updated_at` from `customization_rule` where ((`customization_rule`.`is_active` = 1) and ((`customization_rule`.`effective_from` is null) or (`customization_rule`.`effective_from` <= curdate())) and ((`customization_rule`.`effective_to` is null) or (`customization_rule`.`effective_to` >= curdate()))) order by `customization_rule`.`priority` desc */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_customization_application_summary`
--

/*!50001 DROP VIEW IF EXISTS `v_customization_application_summary`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`shivam_user`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_customization_application_summary` AS select `customization_application_log`.`entity_type` AS `entity_type`,count(distinct `customization_application_log`.`employee_id`) AS `unique_employees`,count(0) AS `total_applications`,cast(`customization_application_log`.`applied_at` as date) AS `application_date` from `customization_application_log` where (`customization_application_log`.`applied_at` >= (now() - interval 7 day)) group by `customization_application_log`.`entity_type`,cast(`customization_application_log`.`applied_at` as date) order by `application_date` desc,`customization_application_log`.`entity_type` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_customization_cache_stats`
--

/*!50001 DROP VIEW IF EXISTS `v_customization_cache_stats`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`shivam_user`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_customization_cache_stats` AS select `customization_cache`.`entity_type` AS `entity_type`,count(0) AS `total_cached`,sum(`customization_cache`.`hit_count`) AS `total_hits`,avg(`customization_cache`.`hit_count`) AS `avg_hits_per_entry`,min(`customization_cache`.`cached_at`) AS `oldest_cache`,max(`customization_cache`.`cached_at`) AS `newest_cache` from `customization_cache` where (`customization_cache`.`expires_at` > now()) group by `customization_cache`.`entity_type` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `wfm_shift`
--

/*!50001 DROP VIEW IF EXISTS `wfm_shift`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`shivam_user`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `wfm_shift` AS select `wfm_shift_master`.`id` AS `id`,`wfm_shift_master`.`shift_code` AS `shift_code`,`wfm_shift_master`.`shift_name` AS `shift_name`,`wfm_shift_master`.`start_time` AS `start_time`,`wfm_shift_master`.`end_time` AS `end_time`,`wfm_shift_master`.`required_minutes` AS `required_minutes`,`wfm_shift_master`.`branch_name` AS `branch_name`,`wfm_shift_master`.`process_name` AS `process_name`,`wfm_shift_master`.`active_status` AS `active_status`,`wfm_shift_master`.`created_at` AS `created_at`,`wfm_shift_master`.`updated_at` AS `updated_at` from `wfm_shift_master` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-04  1:04:44
