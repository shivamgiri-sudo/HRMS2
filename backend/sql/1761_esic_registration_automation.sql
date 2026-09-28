-- 1761_esic_registration_automation.sql
--
-- Additive tracking tables for the supervised ESIC registration bot (Google Sheets queue +
-- Playwright workstation, backend/automation/esic-registration-bot). Sensitive Aadhaar, bank
-- and OTP values remain in the authorised Google workspace and are deliberately never copied
-- into HRMS — only non-sensitive case status/lifecycle metadata is tracked here.
--
-- SAFETY
--   Purely additive: two new tables, no ALTER of any existing table, no DROP, no DELETE.
--   Idempotent via CREATE TABLE IF NOT EXISTS so re-running this file is harmless.

CREATE TABLE IF NOT EXISTS esic_registration_case (
  id CHAR(36) PRIMARY KEY,
  registration_id VARCHAR(64) NOT NULL,
  employee_id CHAR(36) NULL,
  employee_code VARCHAR(64) NOT NULL,
  employee_name VARCHAR(255) NOT NULL,
  branch_name VARCHAR(255) NULL,
  sheet_id VARCHAR(128) NOT NULL,
  sheet_row INT NOT NULL,
  readiness VARCHAR(32) NOT NULL DEFAULT 'NOT_READY',
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  current_step VARCHAR(80) NULL,
  esic_ip_number VARCHAR(32) NULL,
  acknowledgement_url VARCHAR(1024) NULL,
  document_summary_json JSON NULL,
  last_error_code VARCHAR(80) NULL,
  last_error_message VARCHAR(1000) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  worker_id VARCHAR(128) NULL,
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_esic_registration_id (registration_id),
  UNIQUE KEY uq_esic_sheet_row (sheet_id, sheet_row),
  KEY ix_esic_case_status (status, readiness),
  KEY ix_esic_case_employee (employee_code)
);

CREATE TABLE IF NOT EXISTS esic_registration_event (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  actor_type VARCHAR(24) NOT NULL,
  actor_id VARCHAR(128) NULL,
  detail_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_esic_event_case_time (case_id, created_at),
  CONSTRAINT fk_esic_event_case FOREIGN KEY (case_id)
    REFERENCES esic_registration_case(id) ON DELETE CASCADE
);

SELECT '1761_esic_registration_automation.sql applied' AS migration_status;
