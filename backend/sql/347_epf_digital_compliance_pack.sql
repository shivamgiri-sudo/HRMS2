USE mas_hrms;

CREATE TABLE IF NOT EXISTS employee_epf_compliance_profile (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NULL,
  branch_id CHAR(36) NULL,
  process_id CHAR(36) NULL,
  status VARCHAR(80) NOT NULL DEFAULT 'draft',
  compliance_stage VARCHAR(80) NOT NULL DEFAULT 'profile_pending',
  consent_status VARCHAR(40) NOT NULL DEFAULT 'pending',
  correction_status VARCHAR(40) NOT NULL DEFAULT 'none',
  correction_requested_at DATETIME NULL,
  correction_requested_by CHAR(36) NULL,
  correction_reason TEXT NULL,
  hr_reviewed_at DATETIME NULL,
  hr_reviewed_by CHAR(36) NULL,
  payroll_reviewed_at DATETIME NULL,
  payroll_reviewed_by CHAR(36) NULL,
  retention_locked_at DATETIME NULL,
  employee_name VARCHAR(255) NULL,
  father_or_spouse_name VARCHAR(255) NULL,
  relationship_type VARCHAR(30) NULL,
  date_of_birth DATE NULL,
  gender VARCHAR(20) NULL,
  marital_status VARCHAR(30) NULL,
  mobile_number VARCHAR(20) NULL,
  personal_email VARCHAR(255) NULL,
  aadhaar_masked VARCHAR(20) NULL,
  aadhaar_hash VARCHAR(100) NULL,
  pan_masked VARCHAR(20) NULL,
  pan_hash VARCHAR(100) NULL,
  uan_masked VARCHAR(30) NULL,
  uan_hash VARCHAR(100) NULL,
  universal_account_status VARCHAR(40) NULL,
  previous_pf_member TINYINT(1) NOT NULL DEFAULT 0,
  previous_eps_member TINYINT(1) NOT NULL DEFAULT 0,
  international_worker TINYINT(1) NOT NULL DEFAULT 0,
  excluded_employee TINYINT(1) NOT NULL DEFAULT 0,
  eps_eligibility VARCHAR(40) NULL,
  joining_date DATE NULL,
  wage_ceiling DECIMAL(12,2) NULL,
  basic_wage DECIMAL(12,2) NULL,
  gross_monthly_wage DECIMAL(12,2) NULL,
  branch_name_snapshot VARCHAR(255) NULL,
  process_name_snapshot VARCHAR(255) NULL,
  correction_window_open TINYINT(1) NOT NULL DEFAULT 1,
  last_submitted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_epf_profile_employee (employee_id),
  INDEX idx_employee_epf_profile_status (status),
  INDEX idx_employee_epf_profile_scope (branch_id, process_id),
  CONSTRAINT fk_employee_epf_profile_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_epf_form_instance (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NOT NULL,
  form_code VARCHAR(80) NOT NULL,
  version_code VARCHAR(40) NOT NULL DEFAULT 'v1',
  status VARCHAR(40) NOT NULL DEFAULT 'draft',
  form_payload JSON NULL,
  generated_document_file_id CHAR(36) NULL,
  submitted_at DATETIME NULL,
  approved_at DATETIME NULL,
  approved_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_epf_form (employee_id, form_code, version_code),
  INDEX idx_employee_epf_form_profile (profile_id),
  CONSTRAINT fk_employee_epf_form_profile FOREIGN KEY (profile_id) REFERENCES employee_epf_compliance_profile(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_epf_form_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_epf_nominee (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  nominee_name VARCHAR(255) NOT NULL,
  relationship VARCHAR(80) NOT NULL,
  date_of_birth DATE NULL,
  share_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  guardian_name VARCHAR(255) NULL,
  guardian_relationship VARCHAR(80) NULL,
  aadhaar_last4 VARCHAR(4) NULL,
  address_line TEXT NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(100) NULL,
  pincode VARCHAR(20) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employee_epf_nominee_profile (profile_id),
  CONSTRAINT fk_employee_epf_nominee_profile FOREIGN KEY (profile_id) REFERENCES employee_epf_compliance_profile(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_epf_nominee_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_epf_validation_result (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  validation_code VARCHAR(80) NOT NULL,
  severity ENUM('info','warning','error') NOT NULL DEFAULT 'error',
  validation_status VARCHAR(40) NOT NULL DEFAULT 'failed',
  message TEXT NOT NULL,
  field_name VARCHAR(100) NULL,
  validation_payload JSON NULL,
  resolved_at DATETIME NULL,
  resolved_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee_epf_validation_profile (profile_id),
  INDEX idx_employee_epf_validation_status (validation_status, severity),
  CONSTRAINT fk_employee_epf_validation_profile FOREIGN KEY (profile_id) REFERENCES employee_epf_compliance_profile(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_epf_validation_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_epf_consent_receipt (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  consent_token VARCHAR(255) NOT NULL,
  consent_version VARCHAR(40) NOT NULL DEFAULT 'v1',
  consent_text TEXT NOT NULL,
  consent_ip VARCHAR(100) NULL,
  consent_user_agent VARCHAR(500) NULL,
  consented_by_name VARCHAR(255) NULL,
  consented_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_epf_consent_token (consent_token),
  INDEX idx_employee_epf_consent_profile (profile_id),
  CONSTRAINT fk_employee_epf_consent_profile FOREIGN KEY (profile_id) REFERENCES employee_epf_compliance_profile(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_epf_consent_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_epf_audit_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  profile_id CHAR(36) NULL,
  employee_id CHAR(36) NOT NULL,
  action_type VARCHAR(80) NOT NULL,
  actor_user_id CHAR(36) NULL,
  actor_type ENUM('employee','hr','payroll','system','public_token') NOT NULL DEFAULT 'system',
  remarks TEXT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  ip_address VARCHAR(100) NULL,
  user_agent VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee_epf_audit_employee (employee_id),
  INDEX idx_employee_epf_audit_profile (profile_id),
  CONSTRAINT fk_employee_epf_audit_profile FOREIGN KEY (profile_id) REFERENCES employee_epf_compliance_profile(id) ON DELETE SET NULL,
  CONSTRAINT fk_employee_epf_audit_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_epf_ecr_readiness (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NOT NULL,
  ecr_status VARCHAR(40) NOT NULL DEFAULT 'pending',
  missing_fields JSON NULL,
  blocked_reason TEXT NULL,
  ready_at DATETIME NULL,
  last_checked_at DATETIME NULL,
  checked_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_epf_ecr_employee (employee_id),
  CONSTRAINT fk_employee_epf_ecr_profile FOREIGN KEY (profile_id) REFERENCES employee_epf_compliance_profile(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_epf_ecr_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

SET @sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'employees'
      AND COLUMN_NAME = 'epf_compliance_status') = 0,
  'ALTER TABLE employees ADD COLUMN epf_compliance_status VARCHAR(80) NULL, ADD COLUMN epf_last_submitted_at DATETIME NULL, ADD COLUMN epf_retention_locked_at DATETIME NULL',
  'SELECT ''employees epf compliance columns already exist'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES
  (UUID(), 'EMPLOYEE_JOINING_DOCUMENTS', 'Employee Joining Documents', 'employees', 'Secure joining document pack and e-sign tracking', 1),
  (UUID(), 'EMPLOYEE_EPF_COMPLIANCE', 'Employee EPF Compliance', 'payroll', 'EPF digital compliance pack and review workflow', 1),
  (UUID(), 'PAYROLL_EPF_COMPLIANCE', 'Payroll EPF Compliance', 'payroll', 'Payroll EPF review dashboard and ECR readiness', 1);

INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), role_key, page_code, 1, 1, 1, 0, 1, 1
  FROM (
    SELECT 'super_admin' AS role_key UNION ALL
    SELECT 'admin' UNION ALL
    SELECT 'hr' UNION ALL
    SELECT 'payroll_hr' UNION ALL
    SELECT 'payroll' UNION ALL
    SELECT 'manager'
  ) roles
 CROSS JOIN (
    SELECT 'EMPLOYEE_JOINING_DOCUMENTS' AS page_code UNION ALL
    SELECT 'EMPLOYEE_EPF_COMPLIANCE' UNION ALL
    SELECT 'PAYROLL_EPF_COMPLIANCE'
  ) pages;
