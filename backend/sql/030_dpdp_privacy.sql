USE mas_hrms;

-- DPDP Consent records
CREATE TABLE IF NOT EXISTS data_consent (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  data_principal_id   VARCHAR(128) NOT NULL COMMENT 'Supabase user_id or candidate identifier',
  principal_type      ENUM('employee','candidate','client_user','portal_user') NOT NULL DEFAULT 'employee',
  purpose_code        ENUM('employment','payroll','communication','lms','portal','recruitment','health') NOT NULL,
  consent_text_version VARCHAR(16) NOT NULL COMMENT 'e.g. v1.0, v1.1',
  consent_text_hash   VARCHAR(64)  NOT NULL COMMENT 'SHA-256 of consent text shown',
  consented_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at        DATETIME,
  ip_address          VARCHAR(64),
  channel             ENUM('web','api','import','manual') NOT NULL DEFAULT 'web',
  INDEX idx_consent_principal (data_principal_id, purpose_code),
  INDEX idx_consent_purpose (purpose_code)
);

-- Data Principal Rights requests
CREATE TABLE IF NOT EXISTS data_rights_request (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  principal_id    VARCHAR(128) NOT NULL,
  principal_type  ENUM('employee','candidate','client_user') NOT NULL DEFAULT 'employee',
  request_type    ENUM('access','correction','erasure','nomination','grievance') NOT NULL,
  description     TEXT,
  field_name      VARCHAR(128) COMMENT 'For correction requests',
  current_value   TEXT         COMMENT 'For correction requests',
  requested_value TEXT         COMMENT 'For correction requests',
  status          ENUM('pending','in_review','resolved','rejected') NOT NULL DEFAULT 'pending',
  assigned_to     CHAR(36),
  resolved_at     DATETIME,
  response_notes  TEXT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_drr_principal (principal_id)
);

-- Data Retention Policy
CREATE TABLE IF NOT EXISTS data_retention_policy (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  entity_type     VARCHAR(64)  NOT NULL UNIQUE COMMENT 'e.g. ats_candidate, employees, leave_request',
  retention_days  INT          NOT NULL,
  action_on_expiry ENUM('anonymize','delete','archive','notify_admin') NOT NULL DEFAULT 'notify_admin',
  legal_basis     TEXT         COMMENT 'Indian law reference: IT Act, Labour Law, DPDP',
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- DPDP Config (Grievance Officer, policy versions)
CREATE TABLE IF NOT EXISTS dpdp_config (
  config_key      VARCHAR(64)  NOT NULL PRIMARY KEY,
  config_value    TEXT         NOT NULL,
  description     VARCHAR(255),
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed DPDP config defaults
INSERT IGNORE INTO dpdp_config (config_key, config_value, description) VALUES
('grievance_officer_name', 'To be configured', 'DPDP Grievance Officer name'),
('grievance_officer_email', 'privacy@yourcompany.com', 'DPDP Grievance Officer email'),
('grievance_officer_designation', 'HR Manager', 'Grievance Officer designation'),
('grievance_response_sla_days', '30', 'Days to respond to data rights requests'),
('privacy_policy_version', 'v1.0', 'Current privacy policy version'),
('privacy_policy_url', '/privacy-policy', 'URL of current privacy policy'),
('data_fiduciary_name', 'MAS Callnet', 'Name of the Data Fiduciary'),
('consent_text_employment_v1.0', 'By providing your information, you consent to processing of your personal data for employment purposes including HR management, payroll, attendance, and communication as required under the employment relationship. You may withdraw consent subject to legal and contractual obligations.', 'Employment consent text v1.0');

-- Seed retention policies per Indian law
INSERT IGNORE INTO data_retention_policy (id, entity_type, retention_days, action_on_expiry, legal_basis) VALUES
(UUID(), 'ats_candidate', 365, 'anonymize', 'DPDP Act 2023 — retain max 1 year post rejection unless hired'),
(UUID(), 'employees', 2920, 'archive', 'Labour Law — retain 8 years post exit for statutory compliance'),
(UUID(), 'salary_prep_run', 2920, 'archive', 'Income Tax Act — 8 years financial records'),
(UUID(), 'leave_request', 1825, 'archive', 'Factories Act / Shops & Establishments Act — 5 years'),
(UUID(), 'wfm_attendance_session', 1825, 'archive', 'Labour law — 5 years attendance records'),
(UUID(), 'portal_otp', 1, 'delete', 'DPDP — OTP data deleted after 24 hours'),
(UUID(), 'data_breach_log', 2920, 'archive', 'DPDP Act 2023 — retain breach records 8 years');
