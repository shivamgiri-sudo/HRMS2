-- Fix missing tables required for CEO metrics and other admin features
-- Migration: 999_fix_missing_ceo_metrics_tables.sql
-- This migration ensures all tables referenced in CEO metrics and other admin queries exist

-- 1. Ensure salary_prep_run exists (Payroll)
CREATE TABLE IF NOT EXISTS `salary_prep_run` (
  `id` CHAR(36) PRIMARY KEY,
  `run_month` VARCHAR(7) NOT NULL,
  `status` ENUM('draft', 'processing', 'completed', 'failed', 'cancelled') DEFAULT 'draft',
  `created_by` VARCHAR(255),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_run_month` (`run_month`),
  INDEX `idx_status` (`status`)
);

-- 2. Ensure salary_prep_line exists (Payroll)
CREATE TABLE IF NOT EXISTS `salary_prep_line` (
  `id` CHAR(36) PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `employee_id` CHAR(36) NOT NULL,
  `gross_salary` DECIMAL(12, 2) DEFAULT 0,
  `net_salary` DECIMAL(12, 2) DEFAULT 0,
  `pf_employer` DECIMAL(12, 2) DEFAULT 0,
  `esic_employer` DECIMAL(12, 2) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`run_id`) REFERENCES `salary_prep_run`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE,
  INDEX `idx_run_id` (`run_id`),
  INDEX `idx_employee_id` (`employee_id`)
);

-- 3. Ensure workforce_mandate exists (WFM)
CREATE TABLE IF NOT EXISTS `workforce_mandate` (
  `id` CHAR(36) PRIMARY KEY,
  `process_id` CHAR(36) NOT NULL,
  `mandated_hc` INT DEFAULT 0,
  `buffer_pct` DECIMAL(5, 2) DEFAULT 10,
  `shrinkage_pct` DECIMAL(5, 2) DEFAULT 15,
  `attrition_buffer_pct` DECIMAL(5, 2) DEFAULT 5,
  `training_buffer_pct` DECIMAL(5, 2) DEFAULT 3,
  `active_status` TINYINT DEFAULT 1,
  `effective_from` DATE,
  `effective_to` DATE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`process_id`) REFERENCES `process_master`(`id`) ON DELETE CASCADE,
  INDEX `idx_process_id` (`process_id`),
  INDEX `idx_effective_dates` (`effective_from`, `effective_to`),
  INDEX `idx_active_status` (`active_status`)
);

-- 4. Ensure shrinkage_daily_snapshot exists (RTA)
CREATE TABLE IF NOT EXISTS `shrinkage_daily_snapshot` (
  `id` CHAR(36) PRIMARY KEY,
  `process_id` CHAR(36),
  `snapshot_date` DATE NOT NULL,
  `rostered_hc` INT DEFAULT 0,
  `absent_hc` INT DEFAULT 0,
  `total_shrinkage_pct` DECIMAL(5, 2) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`process_id`) REFERENCES `process_master`(`id`) ON DELETE SET NULL,
  INDEX `idx_process_id` (`process_id`),
  INDEX `idx_snapshot_date` (`snapshot_date`),
  INDEX `idx_process_date` (`process_id`, `snapshot_date`)
);

-- 5. Ensure billing_invoice exists (Billing)
CREATE TABLE IF NOT EXISTS `billing_invoice` (
  `id` CHAR(36) PRIMARY KEY,
  `process_id` CHAR(36),
  `period_from` DATE NOT NULL,
  `period_to` DATE NOT NULL,
  `net_amount` DECIMAL(15, 2) DEFAULT 0,
  `gross_amount` DECIMAL(15, 2) DEFAULT 0,
  `status` ENUM('draft', 'approved', 'paid', 'cancelled') DEFAULT 'draft',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`process_id`) REFERENCES `process_master`(`id`) ON DELETE SET NULL,
  INDEX `idx_process_id` (`process_id`),
  INDEX `idx_period_from` (`period_from`),
  INDEX `idx_status` (`status`)
);

-- 6. Ensure employee_exit_record exists (Exit)
CREATE TABLE IF NOT EXISTS `employee_exit_record` (
  `id` CHAR(36) PRIMARY KEY,
  `employee_id` CHAR(36) NOT NULL,
  `exit_date` DATE NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE,
  INDEX `idx_employee_id` (`employee_id`),
  INDEX `idx_exit_date` (`exit_date`),
  INDEX `idx_last_30d` (`exit_date`)
);

-- 7. Ensure applicant table exists (ATS)
CREATE TABLE IF NOT EXISTS `applicant` (
  `id` CHAR(36) PRIMARY KEY,
  `job_id` CHAR(36),
  `current_stage` VARCHAR(100) DEFAULT 'new',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_job_id` (`job_id`),
  INDEX `idx_current_stage` (`current_stage`)
);

-- 8. Ensure employee_salary_assignment exists (Payroll)
CREATE TABLE IF NOT EXISTS `employee_salary_assignment` (
  `id` CHAR(36) PRIMARY KEY,
  `employee_id` CHAR(36) NOT NULL,
  `ctc_annual` DECIMAL(15, 2) DEFAULT 0,
  `effective_from` DATE,
  `effective_to` DATE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE,
  INDEX `idx_employee_id` (`employee_id`),
  INDEX `idx_effective_dates` (`effective_from`, `effective_to`)
);

-- Mark migration as complete
INSERT IGNORE INTO migrations (name, run_on) VALUES ('999_fix_missing_ceo_metrics_tables', NOW());
