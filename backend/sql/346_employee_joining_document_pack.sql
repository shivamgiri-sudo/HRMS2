USE mas_hrms;

CREATE TABLE IF NOT EXISTS employee_joining_document_template (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  document_code VARCHAR(100) NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  document_category VARCHAR(100) NOT NULL,
  template_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  template_file_id CHAR(36) NULL,
  template_storage_path VARCHAR(500) NULL,
  requires_candidate_esign TINYINT(1) NOT NULL DEFAULT 0,
  requires_hr_upload TINYINT(1) NOT NULL DEFAULT 0,
  requires_hr_verification TINYINT(1) NOT NULL DEFAULT 1,
  is_mandatory TINYINT(1) NOT NULL DEFAULT 1,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ejdt_code_version (document_code, template_version),
  INDEX idx_ejdt_active (active_status),
  INDEX idx_ejdt_category (document_category)
);

CREATE TABLE IF NOT EXISTS employee_joining_document_checklist (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NULL,
  onboarding_request_id CHAR(36) NULL,
  offer_id CHAR(36) NULL,
  template_id CHAR(36) NULL,
  document_code VARCHAR(100) NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  template_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  owner_type ENUM('hr','candidate','system') NOT NULL DEFAULT 'hr',
  action_type ENUM('upload','generate','esign','acknowledge','verify') NOT NULL DEFAULT 'upload',
  status VARCHAR(80) NOT NULL DEFAULT 'pending_hr_upload',
  mandatory TINYINT(1) NOT NULL DEFAULT 1,
  due_at DATETIME NULL,
  completed_at DATETIME NULL,
  verified_by CHAR(36) NULL,
  verified_at DATETIME NULL,
  verification_status VARCHAR(80) NULL,
  verification_remarks TEXT NULL,
  analysis_result_json JSON NULL,
  hr_remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ejdc_employee_document (employee_id, document_code),
  INDEX idx_ejdc_employee (employee_id),
  INDEX idx_ejdc_status (status),
  INDEX idx_ejdc_onboarding (onboarding_request_id),
  CONSTRAINT fk_ejdc_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_joining_document_file (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  checklist_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NULL,
  document_code VARCHAR(100) NOT NULL,
  file_role ENUM('template','hr_uploaded','generated','sent_for_esign','signed','supporting') NOT NULL,
  original_filename VARCHAR(255) NULL,
  stored_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NULL,
  file_size_bytes BIGINT NULL,
  file_hash_sha256 VARCHAR(100) NULL,
  uploaded_by CHAR(36) NULL,
  uploaded_by_type ENUM('hr','candidate','system') NOT NULL DEFAULT 'hr',
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  INDEX idx_ejdf_checklist (checklist_id),
  INDEX idx_ejdf_employee (employee_id),
  INDEX idx_ejdf_doc_code (document_code),
  CONSTRAINT fk_ejdf_checklist FOREIGN KEY (checklist_id) REFERENCES employee_joining_document_checklist(id) ON DELETE CASCADE,
  CONSTRAINT fk_ejdf_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_document_esign_transaction (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  checklist_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NULL,
  document_code VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'luckpay',
  client_transaction_id VARCHAR(120) NOT NULL,
  provider_reference_id VARCHAR(150) NULL,
  signer_name VARCHAR(255) NULL,
  signer_mobile VARCHAR(20) NULL,
  signer_email VARCHAR(255) NULL,
  signer_location VARCHAR(100) NULL,
  signing_reason VARCHAR(255) NULL,
  status VARCHAR(80) NOT NULL DEFAULT 'initiated',
  provider_url TEXT NULL,
  request_payload JSON NULL,
  response_payload JSON NULL,
  signed_file_id CHAR(36) NULL,
  error_message TEXT NULL,
  initiated_by CHAR(36) NULL,
  initiated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_edet_provider_txn (provider, client_transaction_id),
  INDEX idx_edet_employee (employee_id),
  INDEX idx_edet_checklist (checklist_id),
  INDEX idx_edet_status (status),
  CONSTRAINT fk_edet_checklist FOREIGN KEY (checklist_id) REFERENCES employee_joining_document_checklist(id) ON DELETE CASCADE,
  CONSTRAINT fk_edet_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_joining_document_audit_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NULL,
  checklist_id CHAR(36) NULL,
  document_code VARCHAR(100) NULL,
  action_type VARCHAR(100) NOT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  remarks TEXT NULL,
  actor_user_id CHAR(36) NULL,
  actor_type ENUM('hr','candidate','system') NOT NULL DEFAULT 'system',
  ip_address VARCHAR(100) NULL,
  user_agent VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ejdal_employee (employee_id),
  INDEX idx_ejdal_checklist (checklist_id),
  INDEX idx_ejdal_action (action_type),
  CONSTRAINT fk_ejdal_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_joining_document_public_token (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  checklist_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NULL,
  document_code VARCHAR(100) NOT NULL,
  public_token VARCHAR(255) NOT NULL,
  token_status VARCHAR(40) NOT NULL DEFAULT 'active',
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  last_started_at DATETIME NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ejdpt_token (public_token),
  INDEX idx_ejdpt_checklist (checklist_id),
  INDEX idx_ejdpt_employee (employee_id),
  CONSTRAINT fk_ejdpt_checklist FOREIGN KEY (checklist_id) REFERENCES employee_joining_document_checklist(id) ON DELETE CASCADE,
  CONSTRAINT fk_ejdpt_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'joining_document_status') = 0,
  'ALTER TABLE employees ADD COLUMN joining_document_status VARCHAR(80) NULL, ADD COLUMN joining_document_completion_pct DECIMAL(5,2) NOT NULL DEFAULT 0, ADD COLUMN joining_document_completed_at DATETIME NULL',
  'SELECT ''employees joining document columns already exist'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_onboarding_bridge' AND COLUMN_NAME = 'joining_document_status') = 0,
  'ALTER TABLE ats_onboarding_bridge ADD COLUMN joining_document_status VARCHAR(80) NULL, ADD COLUMN joining_document_completion_pct DECIMAL(5,2) NOT NULL DEFAULT 0, ADD COLUMN joining_document_completed_at DATETIME NULL',
  'SELECT ''ats_onboarding_bridge joining document columns already exist'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO employee_joining_document_template (
  document_code,
  document_name,
  document_category,
  template_version,
  requires_candidate_esign,
  requires_hr_upload,
  requires_hr_verification,
  is_mandatory,
  active_status
) VALUES
  ('NDA_CONFIDENTIALITY', 'NDA & Confidentiality Agreement', 'agreement', 'v1', 1, 0, 1, 1, 1),
  ('IT_COMPLIANCE', 'IT Compliance Agreement', 'agreement', 'v1', 1, 0, 1, 1, 1),
  ('BAMS_DECLARATION', 'BAMS Attendance Declaration', 'declaration', 'v1', 1, 0, 1, 1, 1),
  ('PI_PROCESSING_CONSENT', 'Personal Information Processing Consent', 'consent', 'v1', 1, 0, 1, 1, 1),
  ('ZERO_TOLERANCE_ACK', 'Zero Tolerance Acknowledgment', 'acknowledgement', 'v1', 1, 0, 1, 1, 1),
  ('EPF_DECLARATION', 'EPF Declaration / Form 11', 'statutory', 'v1', 0, 1, 1, 1, 1),
  ('EMPLOYMENT_CONTRACT', 'Employment Contract', 'contract', 'v1', 0, 1, 1, 1, 1),
  ('OTHER_JOINING_DOCUMENT', 'Other Joining Document', 'other', 'v1', 0, 1, 1, 0, 1);
