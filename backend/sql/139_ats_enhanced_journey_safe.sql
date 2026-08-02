-- backend/sql/139_ats_enhanced_journey_safe.sql
-- Safe migration: adds only missing columns, creates only missing tables
USE mas_hrms;

-- ── 1. Add columns to ats_queue_token (safe checks) ───────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='token_number') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN token_number VARCHAR(50) NULL COMMENT ''Human-readable token number''',
  'SELECT ''token_number already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='branch_name') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN branch_name VARCHAR(255) NULL COMMENT ''Branch for this queue entry''',
  'SELECT ''branch_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='queue_status') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN queue_status ENUM(''waiting'',''called'',''in_interview'',''completed'',''no_show'') NULL DEFAULT ''waiting'' COMMENT ''Current queue status''',
  'SELECT ''queue_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='recruiter_id') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN recruiter_id CHAR(36) NULL COMMENT ''Assigned recruiter''',
  'SELECT ''recruiter_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='estimated_wait_time') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN estimated_wait_time INT NULL COMMENT ''Estimated wait time in minutes''',
  'SELECT ''estimated_wait_time already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='called_at') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN called_at DATETIME NULL COMMENT ''When candidate was called''',
  'SELECT ''called_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='interview_started_at') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN interview_started_at DATETIME NULL COMMENT ''Interview start time''',
  'SELECT ''interview_started_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND COLUMN_NAME='interview_completed_at') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN interview_completed_at DATETIME NULL COMMENT ''Interview completion time''',
  'SELECT ''interview_completed_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. Create interview_result table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_interview_result (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  recruiter_id CHAR(36) NOT NULL,
  interview_status ENUM('selected', 'rejected', 'hold', 'callback', 'no_show', 'walkout') NOT NULL,
  communication_rating INT NULL CHECK (communication_rating BETWEEN 1 AND 5),
  stability_rating INT NULL CHECK (stability_rating BETWEEN 1 AND 5),
  salary_fit BOOLEAN DEFAULT TRUE,
  shift_fit BOOLEAN DEFAULT TRUE,
  location_fit BOOLEAN DEFAULT TRUE,
  role_fit BOOLEAN DEFAULT TRUE,
  remarks TEXT NULL,
  rejection_reason VARCHAR(255) NULL,
  next_step VARCHAR(500) NULL,
  interviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_recruiter (recruiter_id),
  INDEX idx_status (interview_status),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 3. Create payroll_hr_validation table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_payroll_hr_validation (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  employment_type ENUM('onroll', 'offrole') NOT NULL,
  gross_salary DECIMAL(10,2) NOT NULL,
  joining_date DATE NOT NULL,
  salary_start_date DATE NULL COMMENT 'If NULL, defaults to joining_date',
  basic_salary DECIMAL(10,2) NULL,
  hra DECIMAL(10,2) NULL,
  conveyance DECIMAL(10,2) NULL,
  special_allowance DECIMAL(10,2) NULL,
  pf_amount DECIMAL(10,2) NULL,
  esic_amount DECIMAL(10,2) NULL,
  training_period_days INT DEFAULT 0,
  training_end_date DATE NULL,
  validated_by CHAR(36) NULL,
  validation_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  validated_at DATETIME NULL,
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_status (validation_status),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 4. Create employee_code_sequence table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_code_sequence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_prefix ENUM('MAS', 'IDC') NOT NULL,
  is_offrole BOOLEAN DEFAULT FALSE,
  current_sequence INT NOT NULL DEFAULT 0,
  last_generated_code VARCHAR(50) NULL,
  last_generated_at DATETIME NULL,
  UNIQUE KEY unique_sequence (company_prefix, is_offrole)
);

-- Initialize sequences
SET @has_is_offrole_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_code_sequence' AND COLUMN_NAME = 'is_offrole'
);
SET @sql = IF(@has_is_offrole_1 > 0,
  'INSERT IGNORE INTO employee_code_sequence (company_prefix, is_offrole, current_sequence) VALUES
(''MAS'', FALSE, 47814),
(''MAS'', TRUE, 0),
(''IDC'', FALSE, 0),
(''IDC'', TRUE, 0)',
  'SELECT ''employee_code_sequence.is_offrole absent on this database; seed skipped'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- ── 5. Create module_access_control table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS module_access_control (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  module_name VARCHAR(100) NOT NULL,
  employee_code VARCHAR(50) NOT NULL,
  has_access BOOLEAN DEFAULT TRUE,
  granted_by CHAR(36) NULL,
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  remarks TEXT NULL,
  INDEX idx_module (module_name),
  INDEX idx_employee (employee_code),
  UNIQUE KEY unique_access (module_name, employee_code)
);

-- Grant super admin access to MAS47814.
--
-- UNRESOLVED SCHEMA CONFLICT — read before changing this.
--
-- Two migrations define module_access_control with incompatible shapes:
--
--   138_ats_complete_journey.sql   id, employee_id, module_code, module_name,
--                                  access_granted, granted_by, granted_at, revoked_at
--   139 (this file, just above)    module_name, employee_code, has_access, granted_by,
--                                  remarks
--
-- 138 runs first, so its CREATE wins and the CREATE TABLE IF NOT EXISTS above is a silent
-- no-op. The seed below then names employee_code, has_access and remarks — none of which
-- exist on the table that was actually created — and fails with "Unknown column" on any
-- fresh database.
--
-- Which shape is correct is a design decision, not a chain repair, and it is not made here:
-- picking one would either orphan the rows production holds or change what the ATS
-- authorisation code reads. Whichever shape a given database has, the seed now runs only if
-- that database can accept it, so the chain proceeds and the conflict stays visible instead
-- of being papered over by a rewritten column list.
SET @has_employee_code = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'module_access_control'
     AND COLUMN_NAME = 'employee_code'
);
SET @sql = IF(@has_employee_code > 0,
  "INSERT INTO module_access_control (module_name, employee_code, has_access, granted_by, remarks) VALUES
   ('ATS_DASHBOARD', 'MAS47814', TRUE, 'SYSTEM', 'Super admin full access'),
   ('PAYROLL_HR_VALIDATION', 'MAS47814', TRUE, 'SYSTEM', 'Super admin full access'),
   ('RECRUITER_PORTAL', 'MAS47814', TRUE, 'SYSTEM', 'Super admin full access'),
   ('COMMAND_CENTRE', 'MAS47814', TRUE, 'SYSTEM', 'Super admin full access')
   ON DUPLICATE KEY UPDATE has_access=TRUE",
  "SELECT 'module_access_control uses the 138 shape; skipping the 139 seed' AS n"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 6. Create recruiter_assignment_log table ──────────────────────────────────
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
);

-- ── 7. Create cost_centre_master table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_centre_master (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cost_centre_code VARCHAR(50) NOT NULL UNIQUE,
  cost_centre_name VARCHAR(255) NOT NULL,
  branch_name VARCHAR(255) NULL,
  process_name VARCHAR(255) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (cost_centre_code),
  INDEX idx_branch (branch_name),
  INDEX idx_process (process_name)
);

-- ── 8. Add indexes for performance ────────────────────────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND INDEX_NAME='idx_queue_branch_status') = 0,
  'CREATE INDEX idx_queue_branch_status ON ats_queue_token(branch_name, queue_status)',
  'SELECT ''idx_queue_branch_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_queue_token' AND INDEX_NAME='idx_queue_created_at') = 0,
  'CREATE INDEX idx_queue_created_at ON ats_queue_token(created_at)',
  'SELECT ''idx_queue_created_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Third table this file redefines and does not own.
--
-- 138 creates ats_interview_result first, without an interviewed_at column, so the
-- CREATE TABLE IF NOT EXISTS earlier in this file is a silent no-op and the index below
-- targets a column that does not exist:
--
--   Key column 'interviewed_at' doesn't exist in table
--
-- The guard checked whether the INDEX existed but not whether its COLUMN did — which on a
-- database built from scratch are different questions. Both are checked now.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_interview_result' AND INDEX_NAME='idx_interview_date') = 0
  AND
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_interview_result' AND COLUMN_NAME='interviewed_at') > 0,
  'CREATE INDEX idx_interview_date ON ats_interview_result(interviewed_at)',
  'SELECT ''idx_interview_date skipped: already present, or ats_interview_result uses the 138 shape'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '✅ Migration 139 complete: ATS Enhanced Journey tables created' AS result;
