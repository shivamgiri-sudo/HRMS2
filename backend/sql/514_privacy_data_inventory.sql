-- Migration 514: Privacy Data Inventory Tables
-- Creates the schema for the data asset registry, processing purposes,
-- field-level policies, system registry and data flow log.
-- Additive only — no existing tables modified.

-- ── 1. Privacy data asset registry ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_data_asset (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  asset_name VARCHAR(200) NOT NULL COMMENT 'Human-readable name (e.g. Employee PAN Number)',
  db_table VARCHAR(100) NOT NULL COMMENT 'Actual database table name',
  db_column VARCHAR(100) NOT NULL COMMENT 'Actual column name',
  module_key VARCHAR(80) NOT NULL COMMENT 'HRMS module (employees, payroll, ats, etc.)',
  data_category ENUM(
    'identity','contact','employment','financial','payroll','statutory',
    'biometric','health','emergency_contact','family_nominee','performance',
    'attendance','location','authentication','device','communication',
    'recruitment','bgv','visitor','documents','audit','ai_context'
  ) NOT NULL,
  sensitivity_level ENUM('public','internal','pii','sensitive','highly_sensitive') NOT NULL DEFAULT 'pii',
  principal_type ENUM('employee','candidate','client_user','portal_user','all') NOT NULL DEFAULT 'employee',
  processing_purpose_code VARCHAR(80) NULL,
  source VARCHAR(200) NULL COMMENT 'Where the data originates from',
  destination VARCHAR(200) NULL COMMENT 'Where data is shared/exported to',
  retention_policy_entity VARCHAR(64) NULL COMMENT 'References data_retention_policy.entity_type',
  encryption_status ENUM('none','masked','hashed','encrypted') NOT NULL DEFAULT 'none',
  masking_policy VARCHAR(200) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  reviewed_by VARCHAR(128) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_asset_table_col (db_table, db_column),
  KEY idx_pda_category (data_category),
  KEY idx_pda_sensitivity (sensitivity_level),
  KEY idx_pda_module (module_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Processing purpose registry ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_processing_purpose (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  purpose_code VARCHAR(80) NOT NULL UNIQUE,
  purpose_name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  lawful_basis ENUM('consent','employment_contract','legal_obligation','legitimate_interest','vital_interest','public_task') NOT NULL,
  can_be_withdrawn TINYINT(1) NOT NULL DEFAULT 1,
  requires_consent_version TINYINT(1) NOT NULL DEFAULT 0,
  sensitivity_level ENUM('standard','sensitive','highly_sensitive') NOT NULL DEFAULT 'standard',
  retention_days INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  legal_review_status ENUM('pending','in_review','approved') NOT NULL DEFAULT 'pending',
  legal_reviewed_by VARCHAR(128) NULL,
  legal_reviewed_at DATETIME NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed from known purposes
INSERT INTO privacy_processing_purpose
  (purpose_code, purpose_name, description, lawful_basis, can_be_withdrawn, requires_consent_version, sensitivity_level)
VALUES
  ('employment','Employment Administration','Processing for employment contract fulfilment','employment_contract',0,0,'standard'),
  ('payroll','Payroll & Statutory Compliance','Salary calculation, TDS, PF/ESIC filing','legal_obligation',0,0,'highly_sensitive'),
  ('communication','HR Communications','Payslips, HR notices, policy updates via email/SMS','consent',1,1,'standard'),
  ('lms','LMS Integration','Sharing employee data with internal LMS for training','employment_contract',0,0,'standard'),
  ('recruitment','Recruitment','Candidate data processing during hiring','consent',1,1,'standard'),
  ('health','Occupational Health','Medical information for workplace compliance','legal_obligation',0,0,'highly_sensitive'),
  ('biometric','Biometric Attendance','Biometric data for attendance and access control','employment_contract',0,0,'highly_sensitive'),
  ('bgv','Background Verification','Identity, address, employment background checks','consent',1,1,'sensitive'),
  ('optional_photo','Photo & Publication','Employee photo in internal communications','consent',1,1,'standard'),
  ('optional_ai','AI-Powered Features','Employment context for AI-generated insights','consent',1,1,'standard')
ON DUPLICATE KEY UPDATE purpose_name = VALUES(purpose_name);

-- ── 3. Field-level role policy ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_field_role_policy (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  asset_id CHAR(36) NOT NULL,
  role_key VARCHAR(80) NOT NULL,
  field_policy ENUM('allow','mask','deny') NOT NULL DEFAULT 'deny',
  purpose_required VARCHAR(80) NULL COMMENT 'Processing purpose required for this role to access this field',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pfrp_asset_role (asset_id, role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. System/vendor registry ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_system_registry (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  system_name VARCHAR(200) NOT NULL UNIQUE,
  system_type ENUM('internal','external_api','external_db','saas','email','sms','ai_provider','cloud_storage') NOT NULL,
  owner_team VARCHAR(100) NULL,
  data_categories_json JSON NULL COMMENT 'Array of data category strings sent to this system',
  purpose_codes_json JSON NULL COMMENT 'Array of purpose_code strings',
  hosting_region ENUM('india','abroad','hybrid') NOT NULL DEFAULT 'india',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  dpa_required TINYINT(1) NOT NULL DEFAULT 1,
  dpa_status ENUM('not_started','in_progress','signed','expired') NOT NULL DEFAULT 'not_started',
  dpa_signed_date DATE NULL,
  security_review_status ENUM('not_started','in_progress','passed','failed') NOT NULL DEFAULT 'not_started',
  security_reviewed_at DATE NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed from audit findings (data_processor_registry already has these; this table
-- is the HRMS-level registry, not the DPDP-specific processor registry)
INSERT INTO privacy_system_registry
  (system_name, system_type, hosting_region, dpa_required, data_categories_json, purpose_codes_json)
VALUES
  ('Matrix COSEC Biometric', 'external_db', 'india', 1, '["biometric","attendance"]', '["biometric"]'),
  ('MCN Internal LMS', 'internal', 'india', 0, '["identity","employment","performance"]', '["lms"]'),
  ('LuckPay DigiLocker', 'external_api', 'india', 1, '["identity","bgv"]', '["bgv"]'),
  ('Google Gemini AI', 'ai_provider', 'abroad', 1, '["employment","performance","attendance"]', '["optional_ai"]'),
  ('Ollama Local LLM', 'internal', 'india', 0, '["employment","performance"]', '["optional_ai"]'),
  ('SendGrid Email', 'email', 'abroad', 1, '["contact","communication"]', '["communication"]'),
  ('Msg91 SMS', 'sms', 'india', 1, '["contact","communication"]', '["communication"]'),
  ('Twilio WhatsApp', 'external_api', 'abroad', 1, '["contact","communication"]', '["communication"]'),
  ('Call Master Dialer DB', 'external_db', 'india', 1, '["performance","attendance"]', '["employment"]')
ON DUPLICATE KEY UPDATE system_type = VALUES(system_type);

-- ── 5. Data flow / sharing log ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_data_sharing_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  system_name VARCHAR(200) NOT NULL COMMENT 'References privacy_system_registry.system_name',
  purpose_code VARCHAR(80) NOT NULL,
  data_categories_json JSON NOT NULL,
  principal_type ENUM('employee','candidate','all') NOT NULL DEFAULT 'employee',
  record_count INT NULL COMMENT 'Number of principal records in this transfer',
  transfer_type ENUM('api_call','db_sync','file_export','email','webhook') NOT NULL DEFAULT 'api_call',
  initiated_by VARCHAR(36) NULL COMMENT 'auth_user.id or system identifier',
  outcome ENUM('success','failed','partial') NOT NULL DEFAULT 'success',
  error_summary TEXT NULL,
  request_id VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pdsl_system (system_name),
  KEY idx_pdsl_created (created_at),
  KEY idx_pdsl_purpose (purpose_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
