-- Migration 336: DPDP Act 2023 Compliance Gaps
-- Additive only. No destructive operations.
-- Covers: nominee registry, data processor registry, minor flag on ats_candidate,
--         breach SLA alert timestamps, masked PII columns (read-only; nulling deferred to explicit approval).

-- ─── 1. ats_candidate — minor/guardian consent flags ─────────────────────────

ALTER TABLE ats_candidate
  ADD COLUMN IF NOT EXISTS is_minor TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Set to 1 when candidate DOB indicates age < 18 at time of onboarding',
  ADD COLUMN IF NOT EXISTS guardian_consent_obtained TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Set to 1 when guardian has confirmed consent for minor candidate';

-- ─── 2. ats_candidate — masked PII columns (ADDITIVE; raw columns not nulled here) ───

ALTER TABLE ats_candidate
  ADD COLUMN IF NOT EXISTS aadhar_number_masked VARCHAR(20) DEFAULT NULL
    COMMENT 'XXXX-XXXX-LAST4 masked Aadhaar for display/audit',
  ADD COLUMN IF NOT EXISTS pan_number_masked VARCHAR(20) DEFAULT NULL
    COMMENT 'XXXxxxxLAST2 masked PAN for display/audit',
  ADD COLUMN IF NOT EXISTS bank_account_no_masked VARCHAR(20) DEFAULT NULL
    COMMENT 'XXXXXXlast4 masked bank account for display/audit';

-- Backfill masked columns from existing raw values where present
UPDATE ats_candidate
   SET aadhar_number_masked = CONCAT('XXXX-XXXX-', RIGHT(REGEXP_REPLACE(aadhar_number, '[^0-9]', ''), 4))
 WHERE aadhar_number IS NOT NULL
   AND aadhar_number != ''
   AND aadhar_number_masked IS NULL;

UPDATE ats_candidate
   SET pan_number_masked = CONCAT(LEFT(UPPER(pan_number), 3), 'XXXX', RIGHT(UPPER(pan_number), 2))
 WHERE pan_number IS NOT NULL
   AND pan_number != ''
   AND pan_number_masked IS NULL;

UPDATE ats_candidate
   SET bank_account_no_masked = CONCAT('XXXXXX', RIGHT(REPLACE(bank_account_no, ' ', ''), 4))
 WHERE bank_account_no IS NOT NULL
   AND bank_account_no != ''
   AND bank_account_no_masked IS NULL;

-- ─── 3. data_breach_log — SLA alert timestamp columns ───────────────────────

ALTER TABLE data_breach_log
  ADD COLUMN IF NOT EXISTS alert_sent_at_1h  DATETIME DEFAULT NULL
    COMMENT 'Timestamp when 1-hour SLA alert email was dispatched',
  ADD COLUMN IF NOT EXISTS alert_sent_at_48h DATETIME DEFAULT NULL
    COMMENT 'Timestamp when 48-hour escalation email was dispatched',
  ADD COLUMN IF NOT EXISTS alert_sent_at_71h DATETIME DEFAULT NULL
    COMMENT 'Timestamp when 71-hour critical alert email was dispatched';

-- ─── 4. dpdp_nominee_registry ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dpdp_nominee_registry (
  id                   VARCHAR(36)  NOT NULL,
  principal_id         VARCHAR(36)  NOT NULL COMMENT 'auth_user.id of the data principal',
  principal_type       ENUM('employee','candidate','client_user') NOT NULL DEFAULT 'employee',
  nominee_name         VARCHAR(200) NOT NULL,
  nominee_email        VARCHAR(200) NOT NULL,
  nominee_mobile       VARCHAR(20)  DEFAULT NULL,
  nominee_relationship VARCHAR(100) DEFAULT NULL COMMENT 'e.g. spouse, parent, legal representative',
  is_active            TINYINT(1)   NOT NULL DEFAULT 1,
  effective_from       DATE         NOT NULL,
  revoked_at           DATETIME     DEFAULT NULL,
  revoked_by           VARCHAR(36)  DEFAULT NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_principal (principal_id, is_active),
  INDEX idx_nominee_email (nominee_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5. data_processor_registry ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_processor_registry (
  id                   VARCHAR(36)  NOT NULL,
  processor_name       VARCHAR(200) NOT NULL,
  processor_type       ENUM('api','database','saas','email','cloud') NOT NULL DEFAULT 'api',
  data_categories_json JSON         NOT NULL COMMENT 'Array of data categories shared: ["aadhaar","pan","bank",...]',
  processing_purpose   TEXT         NOT NULL,
  data_location        ENUM('india','abroad','hybrid') NOT NULL DEFAULT 'india',
  dpa_signed           TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Data Processing Agreement signed',
  dpa_signed_date      DATE         DEFAULT NULL,
  dpa_document_url     TEXT         DEFAULT NULL,
  contact_email        VARCHAR(200) DEFAULT NULL,
  is_active            TINYINT(1)   NOT NULL DEFAULT 1,
  notes                TEXT         DEFAULT NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_processor_name (processor_name),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed known data processors
INSERT IGNORE INTO data_processor_registry
  (id, processor_name, processor_type, data_categories_json, processing_purpose, data_location, dpa_signed, contact_email, notes)
VALUES
  (UUID(), 'Luckpay (API Banking)',  'api',      '["pan","bank_account","ifsc","uan","employment"]',  'PAN verification, penny-drop bank verification, UAN/employment history verification during candidate onboarding BGV', 'india', 0, 'support@luckpay.in', 'DPDP §7 — legitimate use for employment verification. DPA pending.'),
  (UUID(), 'Befisc / Aadhaar OTP',  'api',      '["aadhaar_number","mobile_otp"]',                   'Aadhaar offline XML / OTP-based identity verification during candidate BGV', 'india', 0, NULL, 'Operates under UIDAI framework. DPA pending.'),
  (UUID(), 'Crimescan',             'api',       '["full_name","date_of_birth","address"]',           'Court record / criminal background check during candidate BGV', 'india', 0, NULL, 'DPA pending. Verify data retention period with vendor.'),
  (UUID(), 'NCOSEC / Biometric',    'database', '["biometric_id","attendance_punch"]',               'Biometric attendance punch read-only integration for attendance records', 'india', 0, NULL, 'Read-only connector. On-premise device. DPA required.'),
  (UUID(), 'MCN LMS',               'saas',      '["employee_id","employee_name","learning_progress"]','Employee learning data sync for HRMS dashboard display (integration layer only)', 'india', 0, NULL, 'Internal deployed LMS. Internal DPA / data sharing agreement required.'),
  (UUID(), 'Call Master Dialer DB', 'database', '["employee_id","agent_id","call_metrics"]',         'Read-only dialer performance data pull for KPI and operations dashboard', 'india', 0, NULL, 'Upstream read-only. Separate DB. Data sharing policy required.'),
  (UUID(), 'SMTP Email Provider',   'email',     '["employee_email","candidate_email","name"]',      'Transactional email delivery: onboarding links, payslips, OTP notifications', 'india', 0, NULL, 'Review provider DPA. Payslip emails contain salary PII — confirm encryption in transit.');

-- ─── 6. dpdp_config — add DPO email and privacy notice URL keys if missing ──

INSERT IGNORE INTO dpdp_config (config_key, config_value, description) VALUES
  ('dpo_email',           '',  'Data Protection Officer email for breach escalation alerts (if DPO appointed)'),
  ('privacy_notice_url',  '',  'Public URL of the organisation privacy notice / policy page'),
  ('consent_active_version_recruitment', '', 'Active consent text version code for recruitment/onboarding purpose');

-- ─── 7. page_catalog — DPDP Data Processors and Nominee pages ───────────────

INSERT IGNORE INTO page_catalog (page_key, page_title, description, roles_json, module_key, is_active)
VALUES
  ('DPDP_PROCESSORS',   'Data Processor Registry',  'Manage third-party data processors and DPA status', '["admin","dpo"]',         'privacy', 1),
  ('DPDP_NOMINATE',     'Nominate Representative',  'Employee: nominate an agent to exercise DPDP rights on their behalf', '["employee"]', 'privacy', 1);
