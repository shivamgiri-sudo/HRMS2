-- backend/sql/139_ats_enhanced_journey_safe.sql
-- Safe migration: adds only missing columns, creates only missing tables.
-- Every compatibility check uses the active database rather than the historical
-- hard-coded `mas_hrms` schema so disposable, staging and tenant schemas behave
-- correctly. Where migration 138 already owns a canonical table, this migration
-- extends or seeds that canonical shape instead of defining a competing model.
USE mas_hrms;

-- ── 1. Add columns to ats_queue_token (safe checks) ───────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='token_number') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN token_number VARCHAR(50) NULL COMMENT ''Human-readable token number''',
  'SELECT ''token_number already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='branch_name') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN branch_name VARCHAR(255) NULL COMMENT ''Branch for this queue entry''',
  'SELECT ''branch_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='queue_status') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN queue_status ENUM(''waiting'',''called'',''in_interview'',''completed'',''no_show'') NULL DEFAULT ''waiting'' COMMENT ''Current queue status''',
  'SELECT ''queue_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='recruiter_id') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN recruiter_id CHAR(36) NULL COMMENT ''Assigned recruiter''',
  'SELECT ''recruiter_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='estimated_wait_time') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN estimated_wait_time INT NULL COMMENT ''Estimated wait time in minutes''',
  'SELECT ''estimated_wait_time already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='called_at') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN called_at DATETIME NULL COMMENT ''When candidate was called''',
  'SELECT ''called_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='interview_started_at') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN interview_started_at DATETIME NULL COMMENT ''Interview start time''',
  'SELECT ''interview_started_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='interview_completed_at') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN interview_completed_at DATETIME NULL COMMENT ''Interview completion time''',
  'SELECT ''interview_completed_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. Create interview_result table when migration 138 is absent ─────────────
-- The fallback definition matches migration 138 so later indexes and services
-- see one stable schema.
CREATE TABLE IF NOT EXISTS ats_interview_result (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  recruiter_id CHAR(36) NOT NULL,
  interview_status ENUM('selected','rejected','hold','callback','no_show','walkout') NOT NULL,
  communication_rating INT NULL COMMENT '1-5 rating',
  stability_rating INT NULL COMMENT '1-5 rating',
  salary_fit TINYINT(1) DEFAULT 0,
  shift_fit TINYINT(1) DEFAULT 0,
  location_fit TINYINT(1) DEFAULT 0,
  role_fit TINYINT(1) DEFAULT 0,
  remarks TEXT NULL,
  rejection_reason VARCHAR(255) NULL,
  next_step VARCHAR(255) NULL,
  documents_pending TINYINT(1) DEFAULT 0,
  joining_interest TINYINT(1) DEFAULT 0,
  expected_joining_date DATE NULL,
  recruiter_recommendation TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_recruiter (recruiter_id),
  INDEX idx_status (interview_status),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Create payroll_hr_validation when migration 138 is absent ──────────────
CREATE TABLE IF NOT EXISTS ats_payroll_hr_validation (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  branch_id VARCHAR(36) NOT NULL,
  payroll_hr_id CHAR(36) NULL,
  validation_status ENUM('pending','validated','rejected','correction_requested') DEFAULT 'pending',
  employment_type ENUM('onroll','offrole') NULL,
  company_id CHAR(36) NULL,
  designation_id CHAR(36) NULL,
  department_id CHAR(36) NULL,
  process_id CHAR(36) NULL,
  cost_centre_id CHAR(36) NULL,
  reporting_manager_id CHAR(36) NULL,
  salary_slab_id CHAR(36) NULL,
  gross_salary DECIMAL(10,2) NULL,
  salary_components JSON NULL,
  joining_date DATE NULL,
  salary_start_date DATE NULL,
  shift_id CHAR(36) NULL,
  remarks TEXT NULL,
  validated_at DATETIME NULL,
  notified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_payroll_hr (payroll_hr_id),
  INDEX idx_status (validation_status),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Reuse the canonical employee_code_sequence from migration 138 ──────────
CREATE TABLE IF NOT EXISTS employee_code_sequence (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_prefix VARCHAR(10) NOT NULL UNIQUE COMMENT 'MAS, IDC',
  last_sequence_number INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO employee_code_sequence (company_prefix, last_sequence_number) VALUES
  ('MAS', 99999),
  ('IDC', 99999)
ON DUPLICATE KEY UPDATE last_sequence_number = last_sequence_number;

-- ── 5. Reuse canonical module_access_control from migration 138 ────────────────
CREATE TABLE IF NOT EXISTS module_access_control (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  module_code VARCHAR(100) NOT NULL,
  module_name VARCHAR(255) NOT NULL,
  access_granted TINYINT(1) DEFAULT 1,
  granted_by CHAR(36) NULL,
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  INDEX idx_employee (employee_id),
  INDEX idx_module (module_code),
  UNIQUE KEY uk_emp_module (employee_id, module_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed only when the configured super-admin employee exists. Fresh schemas have
-- no employee rows, so this remains a deterministic no-op instead of inserting
-- an employee code into an employee-ID column.
INSERT INTO module_access_control
  (id, employee_id, module_code, module_name, access_granted, granted_by)
SELECT UUID(), e.id, seed.module_code, seed.module_name, 1, NULL
FROM employees e
JOIN (
  SELECT 'ATS_DASHBOARD' AS module_code, 'ATS Dashboard' AS module_name
  UNION ALL SELECT 'PAYROLL_HR_VALIDATION', 'Payroll HR Validation'
  UNION ALL SELECT 'RECRUITER_PORTAL', 'Recruiter Portal'
  UNION ALL SELECT 'COMMAND_CENTRE', 'ATS Command Centre'
) seed
WHERE e.employee_code = 'MAS47814'
ON DUPLICATE KEY UPDATE
  module_name = VALUES(module_name),
  access_granted = 1,
  revoked_at = NULL;

-- ── 6. Create recruiter_assignment_log when migration 138 is absent ───────────
CREATE TABLE IF NOT EXISTS ats_recruiter_assignment_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  old_recruiter_id CHAR(36) NULL,
  new_recruiter_id CHAR(36) NULL,
  assignment_reason VARCHAR(255) NOT NULL,
  assigned_by VARCHAR(50) DEFAULT 'SYSTEM',
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_recruiter (new_recruiter_id),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. Reuse canonical cost_centre_master from migration 138 ──────────────────
CREATE TABLE IF NOT EXISTS cost_centre_master (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cost_centre_code VARCHAR(50) NOT NULL UNIQUE,
  cost_centre_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  branch_id VARCHAR(36) NULL,
  process_id CHAR(36) NULL,
  company_id CHAR(36) NULL,
  active_status TINYINT(1) DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (cost_centre_code),
  INDEX idx_active (active_status),
  FOREIGN KEY (branch_id) REFERENCES branch_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 8. Add indexes for performance ────────────────────────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND INDEX_NAME='idx_queue_branch_status') = 0,
  'CREATE INDEX idx_queue_branch_status ON ats_queue_token(branch_name, queue_status)',
  'SELECT ''idx_queue_branch_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_queue_token' AND INDEX_NAME='idx_queue_created_at') = 0,
  'CREATE INDEX idx_queue_created_at ON ats_queue_token(created_at)',
  'SELECT ''idx_queue_created_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Migration 138 names the interview timestamp `created_at`, not `interviewed_at`.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_interview_result' AND INDEX_NAME='idx_interview_date') = 0,
  'CREATE INDEX idx_interview_date ON ats_interview_result(created_at)',
  'SELECT ''idx_interview_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 139 complete: ATS enhanced journey reconciled' AS result;
