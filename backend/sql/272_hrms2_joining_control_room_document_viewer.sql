-- HRMS2 Joining Control Room, Payroll HR governance, statutory/DPDP, and secure candidate document viewer.
-- Additive only: existing payroll/document tables are extended where needed.

CREATE TABLE IF NOT EXISTS jclr_detail (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  joining_location VARCHAR(160) NULL,
  joining_floor VARCHAR(80) NULL,
  work_station VARCHAR(80) NULL,
  system_required TINYINT(1) NOT NULL DEFAULT 1,
  headset_required TINYINT(1) NOT NULL DEFAULT 0,
  id_card_required TINYINT(1) NOT NULL DEFAULT 1,
  training_batch VARCHAR(120) NULL,
  trainer_name VARCHAR(160) NULL,
  induction_slot DATETIME NULL,
  transport_required TINYINT(1) NOT NULL DEFAULT 0,
  transport_route VARCHAR(180) NULL,
  joining_coordinator_id CHAR(36) NULL,
  jclr_status ENUM('pending','in_progress','ready','blocked','completed') NOT NULL DEFAULT 'pending',
  blocker_reason TEXT NULL,
  remarks TEXT NULL,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jclr_candidate (candidate_id),
  INDEX idx_jclr_status (jclr_status),
  INDEX idx_jclr_candidate_status (candidate_id, jclr_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jclr_audit_log (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  old_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_jclr_audit_candidate (candidate_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS statutory_declaration (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  epf_member ENUM('yes','no','unknown') NOT NULL DEFAULT 'unknown',
  uan VARCHAR(32) NULL,
  pf_applicable TINYINT(1) NOT NULL DEFAULT 1,
  esi_applicable TINYINT(1) NOT NULL DEFAULT 0,
  professional_tax_state VARCHAR(80) NULL,
  nominee_name VARCHAR(160) NULL,
  nominee_relationship VARCHAR(80) NULL,
  nominee_dob DATE NULL,
  declaration_status ENUM('pending','submitted','verified','rejected') NOT NULL DEFAULT 'pending',
  verified_by CHAR(36) NULL,
  verified_at DATETIME NULL,
  rejection_reason TEXT NULL,
  remarks TEXT NULL,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_statutory_candidate (candidate_id),
  INDEX idx_statutory_status (declaration_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS statutory_declaration_audit_log (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_stat_audit_candidate (candidate_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_proposal_approval_step (
  id CHAR(36) NOT NULL,
  proposal_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  approval_level ENUM('bm','operations','payroll','finance') NOT NULL,
  approver_id CHAR(36) NULL,
  status ENUM('pending','approved','rejected','skipped') NOT NULL DEFAULT 'pending',
  remarks TEXT NULL,
  acted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_salary_step (proposal_id, approval_level),
  INDEX idx_salary_step_candidate (candidate_id),
  INDEX idx_salary_step_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_register (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  payroll_validation_id CHAR(36) NULL,
  salary_slab_id CHAR(36) NULL,
  approved_gross_salary DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  salary_effective_from DATE NOT NULL,
  attendance_effective_from DATE NULL,
  statutory_effective_from DATE NULL,
  payroll_month_effective CHAR(7) NOT NULL,
  lock_status ENUM('draft','locked','reopened') NOT NULL DEFAULT 'draft',
  locked_by CHAR(36) NULL,
  locked_at DATETIME NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_salary_register_candidate (candidate_id),
  INDEX idx_salary_register_month (payroll_month_effective),
  INDEX idx_salary_register_lock (lock_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_register_audit_log (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  salary_register_id CHAR(36) NULL,
  actor_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_salary_audit_candidate (candidate_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dpdp_consent_register (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  purpose_code VARCHAR(80) NOT NULL,
  consent_status ENUM('granted','withdrawn','not_required','pending') NOT NULL DEFAULT 'pending',
  consent_text_version VARCHAR(80) NULL,
  lawful_basis VARCHAR(120) NULL,
  granted_at DATETIME NULL,
  withdrawn_at DATETIME NULL,
  source VARCHAR(80) NULL,
  actor_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dpdp_candidate_purpose (candidate_id, purpose_code),
  INDEX idx_dpdp_status (consent_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dpdp_consent_withdrawal (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  purpose_code VARCHAR(80) NOT NULL,
  requested_by CHAR(36) NULL,
  status ENUM('requested','approved','rejected','completed') NOT NULL DEFAULT 'requested',
  reason TEXT NULL,
  resolution_remarks TEXT NULL,
  resolved_by CHAR(36) NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_dpdp_withdraw_candidate (candidate_id),
  INDEX idx_dpdp_withdraw_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dpdp_processing_activity_log (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  purpose_code VARCHAR(80) NOT NULL,
  action VARCHAR(80) NOT NULL,
  data_category VARCHAR(120) NULL,
  lawful_basis VARCHAR(120) NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_dpdp_activity_candidate (candidate_id, created_at),
  INDEX idx_dpdp_activity_purpose (purpose_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_document_access_log (
  id CHAR(36) NOT NULL,
  document_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  access_type ENUM('list','metadata','preview','stream','download','verify','reject','request_reupload','audit') NOT NULL,
  purpose_code VARCHAR(80) NULL,
  ip_address VARCHAR(80) NULL,
  user_agent VARCHAR(500) NULL,
  outcome ENUM('allowed','denied') NOT NULL DEFAULT 'allowed',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_candidate_doc_access_doc (document_id, created_at),
  INDEX idx_candidate_doc_access_candidate (candidate_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_document_reupload_request (
  id CHAR(36) NOT NULL,
  document_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  requested_by CHAR(36) NULL,
  reason TEXT NOT NULL,
  status ENUM('open','uploaded','cancelled','closed') NOT NULL DEFAULT 'open',
  due_at DATETIME NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_candidate_doc_reupload_doc (document_id),
  INDEX idx_candidate_doc_reupload_candidate (candidate_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_permission_policy (
  id CHAR(36) NOT NULL,
  document_category VARCHAR(120) NOT NULL,
  role_code VARCHAR(80) NOT NULL,
  can_preview TINYINT(1) NOT NULL DEFAULT 1,
  can_download TINYINT(1) NOT NULL DEFAULT 0,
  can_verify TINYINT(1) NOT NULL DEFAULT 0,
  can_reject TINYINT(1) NOT NULL DEFAULT 0,
  mask_sensitive TINYINT(1) NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_doc_policy_category_role (document_category, role_code),
  INDEX idx_doc_policy_role (role_code, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS joining_control_room_snapshot (
  id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  readiness_status ENUM('blocked','ready','employee_created') NOT NULL DEFAULT 'blocked',
  blockers_json JSON NULL,
  next_action VARCHAR(160) NULL,
  snapshot_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jcr_snapshot_candidate (candidate_id),
  INDEX idx_jcr_snapshot_status (readiness_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN attendance_effective_from DATE NULL AFTER salary_start_date', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'attendance_effective_from');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN statutory_effective_from DATE NULL AFTER attendance_effective_from', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'statutory_effective_from');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN payroll_month_effective CHAR(7) NULL AFTER statutory_effective_from', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'payroll_month_effective');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN salary_effective_date_reason TEXT NULL AFTER payroll_month_effective', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'salary_effective_date_reason');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN profile VARCHAR(120) NULL AFTER salary_effective_date_reason', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'profile');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN band_grade VARCHAR(80) NULL AFTER profile', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'band_grade');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN employee_location VARCHAR(160) NULL AFTER band_grade', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'employee_location');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN kpi VARCHAR(160) NULL AFTER employee_location', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'kpi');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN billable_status ENUM(''billable'',''non_billable'',''support'') NULL AFTER kpi', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'billable_status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN type_of_employee VARCHAR(80) NULL AFTER billable_status', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'type_of_employee');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN joining_remarks TEXT NULL AFTER type_of_employee', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'joining_remarks');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN salary_register_locked TINYINT(1) NOT NULL DEFAULT 0 AFTER joining_remarks', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'salary_register_locked');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_payroll_hr_validation ADD COLUMN salary_register_id CHAR(36) NULL AFTER salary_register_locked', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'salary_register_id');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE salary_exception_proposal ADD COLUMN approval_stage ENUM(''bm'',''operations'',''payroll'',''finance'',''completed'') NOT NULL DEFAULT ''bm'' AFTER status', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_exception_proposal' AND COLUMN_NAME = 'approval_stage');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE salary_exception_proposal ADD COLUMN difference_amount DECIMAL(12,2) NULL AFTER proposed_gross_salary', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_exception_proposal' AND COLUMN_NAME = 'difference_amount');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE salary_exception_proposal ADD COLUMN difference_percent DECIMAL(8,2) NULL AFTER difference_amount', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_exception_proposal' AND COLUMN_NAME = 'difference_percent');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_candidate_documents ADD COLUMN file_mime_type VARCHAR(120) NULL AFTER file_url', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate_documents' AND COLUMN_NAME = 'file_mime_type');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_candidate_documents ADD COLUMN file_size BIGINT NULL AFTER file_mime_type', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate_documents' AND COLUMN_NAME = 'file_size');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_candidate_documents ADD COLUMN mandatory_flag TINYINT(1) NOT NULL DEFAULT 0 AFTER file_size', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate_documents' AND COLUMN_NAME = 'mandatory_flag');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_candidate_documents ADD COLUMN sensitive_flag TINYINT(1) NOT NULL DEFAULT 1 AFTER mandatory_flag', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate_documents' AND COLUMN_NAME = 'sensitive_flag');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_candidate_documents ADD COLUMN consent_purpose VARCHAR(80) NULL AFTER sensitive_flag', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate_documents' AND COLUMN_NAME = 'consent_purpose');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE ats_candidate_documents ADD COLUMN name_match_status ENUM(''pending'',''matched'',''mismatch'',''not_applicable'') NOT NULL DEFAULT ''pending'' AFTER consent_purpose', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate_documents' AND COLUMN_NAME = 'name_match_status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE candidate_onboarding_document ADD COLUMN name_match_status ENUM(''pending'',''matched'',''mismatch'',''not_applicable'') NOT NULL DEFAULT ''pending'' AFTER document_status', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_document' AND COLUMN_NAME = 'name_match_status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE candidate_onboarding_document ADD COLUMN verified_by CHAR(36) NULL AFTER name_match_status', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_document' AND COLUMN_NAME = 'verified_by');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE candidate_onboarding_document ADD COLUMN verified_at DATETIME NULL AFTER verified_by', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_document' AND COLUMN_NAME = 'verified_at');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE candidate_onboarding_document ADD COLUMN verification_remarks TEXT NULL AFTER verified_at', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_document' AND COLUMN_NAME = 'verification_remarks');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE candidate_onboarding_document ADD COLUMN rejected_by CHAR(36) NULL AFTER verification_remarks', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_document' AND COLUMN_NAME = 'rejected_by');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE candidate_onboarding_document ADD COLUMN rejected_at DATETIME NULL AFTER rejected_by', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_document' AND COLUMN_NAME = 'rejected_at');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE candidate_onboarding_document ADD COLUMN rejection_reason TEXT NULL AFTER rejected_at', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_document' AND COLUMN_NAME = 'rejection_reason');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO document_permission_policy
  (id, document_category, role_code, can_preview, can_download, can_verify, can_reject, mask_sensitive)
VALUES
  (UUID(), 'identity', 'hr', 1, 0, 1, 1, 1),
  (UUID(), 'identity', 'payroll_hr', 1, 0, 1, 1, 1),
  (UUID(), 'identity', 'super_admin', 1, 1, 1, 1, 0),
  (UUID(), 'education', 'hr', 1, 0, 1, 1, 1),
  (UUID(), 'education', 'payroll_hr', 1, 0, 1, 1, 1),
  (UUID(), 'bank', 'payroll_hr', 1, 0, 1, 1, 1),
  (UUID(), 'experience', 'hr', 1, 0, 1, 1, 1),
  (UUID(), 'statutory', 'payroll_hr', 1, 0, 1, 1, 1)
ON DUPLICATE KEY UPDATE
  can_preview = VALUES(can_preview),
  can_download = VALUES(can_download),
  can_verify = VALUES(can_verify),
  can_reject = VALUES(can_reject),
  mask_sensitive = VALUES(mask_sensitive),
  updated_at = NOW();

INSERT INTO page_catalog (page_code, page_name, page_path, module, active_status)
VALUES
  ('ATS_JOINING_CONTROL_ROOM', 'ATS Joining Control Room', '/ats/joining-control-room', 'ATS', 1),
  ('SALARY_PROPOSAL_APPROVALS', 'Salary Proposal Approvals', '/ats/joining-control-room?tab=salary', 'ATS', 1),
  ('SALARY_REGISTER', 'Salary Register', '/ats/joining-control-room?tab=salary-register', 'Payroll', 1),
  ('ATS_STATUTORY_ONBOARDING', 'ATS Statutory Onboarding', '/ats/joining-control-room?tab=statutory', 'ATS', 1),
  ('ATS_DPDP_CONSENT', 'ATS DPDP Consent', '/ats/joining-control-room?tab=dpdp', 'ATS', 1),
  ('PROVISIONING_IT', 'IT Provisioning', '/ats/joining-control-room?tab=provisioning', 'ATS', 1),
  ('PROVISIONING_ADMIN', 'Admin Provisioning', '/ats/joining-control-room?tab=provisioning', 'ATS', 1),
  ('PROVISIONING_APPOINTMENT_LETTER', 'Appointment Letter Provisioning', '/ats/joining-control-room?tab=appointment', 'ATS', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  page_path = VALUES(page_path),
  module = VALUES(module),
  active_status = VALUES(active_status);

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT roles.role_key, pages.page_code, 1, 1, 1, 0, 1, 1
  FROM (
    SELECT 'super_admin' AS role_key UNION ALL
    SELECT 'admin' UNION ALL
    SELECT 'hr' UNION ALL
    SELECT 'payroll_hr' UNION ALL
    SELECT 'branch_head' UNION ALL
    SELECT 'finance' UNION ALL
    SELECT 'operations' UNION ALL
    SELECT 'it_admin'
  ) roles
  JOIN (
    SELECT 'ATS_JOINING_CONTROL_ROOM' AS page_code UNION ALL
    SELECT 'SALARY_PROPOSAL_APPROVALS' UNION ALL
    SELECT 'SALARY_REGISTER' UNION ALL
    SELECT 'ATS_STATUTORY_ONBOARDING' UNION ALL
    SELECT 'ATS_DPDP_CONSENT' UNION ALL
    SELECT 'PROVISIONING_IT' UNION ALL
    SELECT 'PROVISIONING_ADMIN' UNION ALL
    SELECT 'PROVISIONING_APPOINTMENT_LETTER'
  ) pages
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_export = VALUES(can_export),
  active_status = VALUES(active_status);

INSERT INTO user_page_access (id, user_id, page_code, can_view, can_create, can_edit, can_delete, can_export, assigned_by, active_status, notes)
SELECT UUID(), u.id, p.page_code, 1, 1, 1, 0, 1, u.id, 1, 'HRMS2 Joining Control Room direct access'
  FROM auth_user u
  JOIN page_catalog p ON p.page_code IN (
    'ATS_JOINING_CONTROL_ROOM','SALARY_PROPOSAL_APPROVALS','SALARY_REGISTER',
    'ATS_STATUTORY_ONBOARDING','ATS_DPDP_CONSENT','PROVISIONING_IT',
    'PROVISIONING_ADMIN','PROVISIONING_APPOINTMENT_LETTER'
  )
 WHERE LOWER(u.email) = 'shivam.giri@teammas.in'
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_export = VALUES(can_export),
  active_status = VALUES(active_status),
  notes = VALUES(notes);
