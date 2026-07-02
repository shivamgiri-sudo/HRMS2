-- backend/sql/138_ats_complete_journey.sql
-- Complete ATS Journey Enhancement
USE mas_hrms;

-- ── 1. Add columns to ats_candidate (with IF NOT EXISTS check) ──────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_candidate' AND COLUMN_NAME='branch_display_name') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN branch_display_name VARCHAR(255) NULL AFTER applied_for_branch',
  'SELECT ''branch_display_name already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_candidate' AND COLUMN_NAME='preferred_recruiter_id') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN preferred_recruiter_id CHAR(36) NULL COMMENT ''Recruiter selected by candidate''',
  'SELECT ''preferred_recruiter_id already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_candidate' AND COLUMN_NAME='assigned_recruiter_id') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN assigned_recruiter_id CHAR(36) NULL COMMENT ''Actual assigned recruiter''',
  'SELECT ''assigned_recruiter_id already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_candidate' AND COLUMN_NAME='assignment_reason') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN assignment_reason VARCHAR(255) NULL COMMENT ''Reason for assignment/reassignment''',
  'SELECT ''assignment_reason already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_candidate' AND COLUMN_NAME='photo_url') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN photo_url VARCHAR(512) NULL COMMENT ''Candidate photo URL''',
  'SELECT ''photo_url already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_candidate' AND COLUMN_NAME='resume_parsed_json') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN resume_parsed_json JSON NULL COMMENT ''Parsed resume data''',
  'SELECT ''resume_parsed_json already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. Create recruiter_assignment_log table ──────────────────────────────────
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

-- ── 3. Enhance ats_queue_token table ─────────────────────────────────────────
-- NOTE: Migration runner handles "Duplicate column" errors as idempotent
ALTER TABLE ats_queue_token ADD COLUMN estimated_wait_time INT NULL COMMENT 'Estimated wait time in minutes';
ALTER TABLE ats_queue_token ADD COLUMN called_at DATETIME NULL COMMENT 'When candidate was called';
ALTER TABLE ats_queue_token ADD COLUMN interview_started_at DATETIME NULL COMMENT 'Interview start time';
ALTER TABLE ats_queue_token ADD COLUMN interview_completed_at DATETIME NULL COMMENT 'Interview completion time';

-- ── 4. Create interview_result table ──────────────────────────────────────────
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
);

-- ── 5. Create candidate_portal_login table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_candidate_portal_login (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  temp_password VARCHAR(255) NOT NULL COMMENT 'Hashed temp password',
  password_reset_required TINYINT(1) DEFAULT 1,
  password_reset_token VARCHAR(255) NULL,
  password_reset_expires DATETIME NULL,
  last_login DATETIME NULL,
  login_attempts INT DEFAULT 0,
  account_locked TINYINT(1) DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 6. Enhance candidate_onboarding_profile ───────────────────────────────────
-- NOTE: Migration runner handles "Duplicate column" errors as idempotent
ALTER TABLE candidate_onboarding_profile ADD COLUMN full_name_aadhaar VARCHAR(255) NULL COMMENT 'Name as per Aadhaar';
ALTER TABLE candidate_onboarding_profile ADD COLUMN father_name VARCHAR(255) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN mother_name VARCHAR(255) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN date_of_birth DATE NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN gender ENUM('male','female','other') NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN marital_status ENUM('single','married','divorced','widowed') NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN blood_group VARCHAR(10) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN alternate_mobile VARCHAR(20) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN current_address TEXT NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN permanent_address TEXT NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN city VARCHAR(100) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN state VARCHAR(100) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN pin_code VARCHAR(10) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN voter_id VARCHAR(50) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN driving_license VARCHAR(50) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN passport_number VARCHAR(50) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN uan_number VARCHAR(50) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN esic_number VARCHAR(50) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN emergency_contact_name VARCHAR(255) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN emergency_contact_relation VARCHAR(50) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN emergency_contact_number VARCHAR(20) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN emergency_contact_address TEXT NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN nominee_name VARCHAR(255) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN nominee_relation VARCHAR(50) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN nominee_dob DATE NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN nominee_contact VARCHAR(20) NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN declaration_accepted TINYINT(1) DEFAULT 0;
ALTER TABLE candidate_onboarding_profile ADD COLUMN bgv_consent TINYINT(1) DEFAULT 0;
ALTER TABLE candidate_onboarding_profile ADD COLUMN doc_verification_consent TINYINT(1) DEFAULT 0;
ALTER TABLE candidate_onboarding_profile ADD COLUMN policy_acknowledgement TINYINT(1) DEFAULT 0;
ALTER TABLE candidate_onboarding_profile ADD COLUMN draft_saved_at DATETIME NULL;
ALTER TABLE candidate_onboarding_profile ADD COLUMN submitted_at DATETIME NULL;

-- ── 7. Create bgv_initiation table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_bgv_initiation (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  onboarding_profile_id CHAR(36) NOT NULL,
  bgv_status ENUM('not_initiated','initiated','in_progress','verified','negative','insufficient','failed') DEFAULT 'not_initiated',
  initiated_by CHAR(36) NULL,
  initiated_at DATETIME NULL,
  vendor_request_payload JSON NULL,
  vendor_response_payload JSON NULL,
  vendor_reference_id VARCHAR(255) NULL,
  completed_at DATETIME NULL,
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_status (bgv_status),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 8. Create payroll_hr_validation table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_payroll_hr_validation (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  branch_id CHAR(36) NOT NULL,
  payroll_hr_id CHAR(36) NULL COMMENT 'HR who validates',
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
  salary_components JSON NULL COMMENT 'Salary component breakdown',
  joining_date DATE NULL COMMENT 'Physical joining date (day 1 in office)',
  salary_start_date DATE NULL COMMENT 'Salary generation start date (defaults to joining_date if NULL)',
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
);

-- ── 9. Create branch_head_approval table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_branch_head_approval (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  payroll_validation_id CHAR(36) NOT NULL,
  branch_head_id CHAR(36) NULL COMMENT 'Branch head who approves',
  approval_status ENUM('pending','approved','rejected','sent_back') DEFAULT 'pending',
  remarks TEXT NULL,
  approved_at DATETIME NULL,
  notified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_branch_head (branch_head_id),
  INDEX idx_status (approval_status),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  FOREIGN KEY (payroll_validation_id) REFERENCES ats_payroll_hr_validation(id)
);

-- ── 10. Create employee_code_generation_log ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_code_generation_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_code VARCHAR(50) NOT NULL UNIQUE,
  candidate_id CHAR(36) NULL,
  employee_id CHAR(36) NULL,
  company_prefix VARCHAR(10) NOT NULL COMMENT 'MAS or IDC',
  is_offrole TINYINT(1) DEFAULT 0 COMMENT '1 if code ends with C',
  sequence_number INT NOT NULL,
  generated_by CHAR(36) NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee_code (employee_code),
  INDEX idx_candidate (candidate_id),
  INDEX idx_company (company_prefix)
);

-- ── 11. Create employee_code_sequence table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_code_sequence (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_prefix VARCHAR(10) NOT NULL UNIQUE COMMENT 'MAS, IDC',
  last_sequence_number INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed initial sequences if not exist
INSERT INTO employee_code_sequence (company_prefix, last_sequence_number) VALUES
  ('MAS', 99999),
  ('IDC', 99999)
ON DUPLICATE KEY UPDATE last_sequence_number = last_sequence_number;

-- ── 12. Create cost_centre_master table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_centre_master (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cost_centre_code VARCHAR(50) NOT NULL UNIQUE,
  cost_centre_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  branch_id CHAR(36) NULL,
  process_id CHAR(36) NULL,
  company_id CHAR(36) NULL,
  active_status TINYINT(1) DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (cost_centre_code),
  INDEX idx_active (active_status),
  FOREIGN KEY (branch_id) REFERENCES branch_master(id)
);

-- ── 13. Create module_access_control table (Super Admin) ──────────────────────
CREATE TABLE IF NOT EXISTS module_access_control (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  module_code VARCHAR(100) NOT NULL COMMENT 'Page/module code',
  module_name VARCHAR(255) NOT NULL,
  access_granted TINYINT(1) DEFAULT 1,
  granted_by CHAR(36) NULL COMMENT 'Super admin who granted',
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  INDEX idx_employee (employee_id),
  INDEX idx_module (module_code),
  UNIQUE KEY uk_emp_module (employee_id, module_code)
);

-- ── 14. Create module_access_audit_log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS module_access_audit_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  module_code VARCHAR(100) NOT NULL,
  action ENUM('granted','revoked','modified') NOT NULL,
  performed_by CHAR(36) NOT NULL COMMENT 'Super admin employee ID',
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee (employee_id),
  INDEX idx_performed_by (performed_by)
);

-- ── 15. Enhance notification systems ──────────────────────────────────────────
ALTER TABLE ats_notification_log
ADD COLUMN IF NOT EXISTS notification_type VARCHAR(50) NULL COMMENT 'Type of notification',
ADD COLUMN IF NOT EXISTS recipient_type ENUM('candidate','recruiter','hr','branch_head','admin') NULL,
ADD COLUMN IF NOT EXISTS recipient_id CHAR(36) NULL,
ADD COLUMN IF NOT EXISTS read_status TINYINT(1) DEFAULT 0,
ADD COLUMN IF NOT EXISTS read_at DATETIME NULL;

-- ── 16. Create in-portal notification table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_notification (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id CHAR(36) NOT NULL COMMENT 'Employee or candidate ID',
  user_type ENUM('employee','candidate') NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  reference_id CHAR(36) NULL COMMENT 'Reference to candidate/task etc',
  action_url VARCHAR(512) NULL,
  priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
  read_status TINYINT(1) DEFAULT 0,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id, user_type),
  INDEX idx_read (read_status),
  INDEX idx_created (created_at)
);

-- ── 17. Add indexes for performance ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ats_candidate_branch ON ats_candidate(branch_name);
CREATE INDEX IF NOT EXISTS idx_ats_candidate_status ON ats_candidate(candidate_status);
CREATE INDEX IF NOT EXISTS idx_ats_candidate_created ON ats_candidate(created_at);
CREATE INDEX IF NOT EXISTS idx_ats_queue_status ON ats_queue_token(queue_status);
CREATE INDEX IF NOT EXISTS idx_ats_queue_branch ON ats_queue_token(branch_name);

-- ── 18. Super admin employee access ───────────────────────────────────────────
-- Grant super admin access to MAS47814
INSERT INTO module_access_control (employee_id, module_code, module_name, granted_by)
SELECT
  e.id,
  'SUPER_ADMIN_PORTAL',
  'Super Admin Portal',
  e.id
FROM employees e
WHERE e.employee_code = 'MAS47814'
ON DUPLICATE KEY UPDATE access_granted = 1;

COMMIT;
