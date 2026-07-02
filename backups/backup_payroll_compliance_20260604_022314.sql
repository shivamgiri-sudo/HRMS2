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
-- Dumping data for table `salary_prep_run`
--

LOCK TABLES `salary_prep_run` WRITE;
/*!40000 ALTER TABLE `salary_prep_run` DISABLE KEYS */;
INSERT INTO `salary_prep_run` VALUES ('payrun-may26-001','2026-05',NULL,NULL,'draft',11,1236250.00,185437.00,1050813.00,'emp-finance-001',NULL,NULL,NULL,'2026-06-01 13:24:04','2026-06-01 13:24:04');
/*!40000 ALTER TABLE `salary_prep_run` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `salary_prep_line`
--

LOCK TABLES `salary_prep_line` WRITE;
/*!40000 ALTER TABLE `salary_prep_line` DISABLE KEYS */;
/*!40000 ALTER TABLE `salary_prep_line` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `employee_salary_assignment`
--

LOCK TABLES `employee_salary_assignment` WRITE;
/*!40000 ALTER TABLE `employee_salary_assignment` DISABLE KEYS */;
INSERT INTO `employee_salary_assignment` VALUES ('sal-admin-001','emp-admin-001','ss-mgr-001',1800000.00,'2020-01-01',NULL,1,'2026-06-01 13:18:19'),('sal-ceo-001','emp-ceo-001','ss-mgr-001',4800000.00,'2015-01-01',NULL,1,'2026-06-01 13:18:19'),('sal-emp-001','emp-employee-001','ss-std-001',360000.00,'2023-03-01',NULL,1,'2026-06-01 13:18:19'),('sal-fin-001','emp-finance-001','ss-std-001',720000.00,'2020-04-01',NULL,1,'2026-06-01 13:18:19'),('sal-hr-001','emp-hr-001','ss-mgr-001',900000.00,'2021-03-15',NULL,1,'2026-06-01 13:18:19'),('sal-mgr-001','emp-manager-001','ss-mgr-001',1200000.00,'2019-08-01',NULL,1,'2026-06-01 13:18:19'),('sal-qa-001','emp-qa-001','ss-std-001',540000.00,'2022-02-14',NULL,1,'2026-06-01 13:18:19'),('sal-rec-001','emp-recruiter-001','ss-std-001',480000.00,'2022-06-01',NULL,1,'2026-06-01 13:18:19'),('sal-tl-001','emp-tl-001','ss-std-001',720000.00,'2021-01-15',NULL,1,'2026-06-01 13:18:19'),('sal-trainer-001','emp-trainer-001','ss-std-001',600000.00,'2021-07-01',NULL,1,'2026-06-01 13:18:19'),('sal-wfm-001','emp-wfm-001','ss-std-001',660000.00,'2020-09-01',NULL,1,'2026-06-01 13:18:19');
/*!40000 ALTER TABLE `employee_salary_assignment` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-04  2:23:15
