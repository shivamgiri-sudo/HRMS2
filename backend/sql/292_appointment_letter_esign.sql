-- Migration 292: Appointment Letter E-Sign & Document Vault
-- Adds columns to appointment_letter_request, creates employee_document_vault, esign_provider_transaction
-- Safe to re-run via stored procedure pattern for ALTER, CREATE TABLE IF NOT EXISTS, INSERT IGNORE

DROP PROCEDURE IF EXISTS mig292_add_esign_cols;
DELIMITER //
CREATE PROCEDURE mig292_add_esign_cols()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'appointment_letter_request' AND column_name = 'esign_provider'
  ) THEN
    ALTER TABLE appointment_letter_request
      ADD COLUMN esign_provider          VARCHAR(50)  DEFAULT NULL AFTER status,
      ADD COLUMN esign_transaction_id    VARCHAR(255) DEFAULT NULL AFTER esign_provider,
      ADD COLUMN candidate_esign_url     TEXT         DEFAULT NULL AFTER esign_transaction_id,
      ADD COLUMN company_sign_url        TEXT         DEFAULT NULL AFTER candidate_esign_url,
      ADD COLUMN manual_override_reason  TEXT         DEFAULT NULL AFTER company_sign_url,
      ADD COLUMN manual_override_by      CHAR(36)     DEFAULT NULL AFTER manual_override_reason,
      ADD COLUMN manual_override_at      DATETIME     DEFAULT NULL AFTER manual_override_by;
  END IF;
END //
DELIMITER ;
CALL mig292_add_esign_cols();
DROP PROCEDURE IF EXISTS mig292_add_esign_cols;

CREATE TABLE IF NOT EXISTS employee_document_vault (
  id               CHAR(36)     NOT NULL,
  employee_id      CHAR(36)     DEFAULT NULL,
  candidate_id     CHAR(36)     DEFAULT NULL,
  document_type    VARCHAR(100) NOT NULL,
  document_name    VARCHAR(255) NOT NULL,
  file_path        TEXT         DEFAULT NULL,
  file_url         TEXT         DEFAULT NULL,
  is_locked        TINYINT(1)   NOT NULL DEFAULT 0,
  locked_at        DATETIME     DEFAULT NULL,
  locked_by        CHAR(36)     DEFAULT NULL,
  source_module    VARCHAR(50)  DEFAULT NULL,
  source_entity_id CHAR(36)     DEFAULT NULL,
  uploaded_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_by      CHAR(36)     DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_employee (employee_id),
  INDEX idx_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS esign_provider_transaction (
  id               CHAR(36)     NOT NULL,
  provider         VARCHAR(50)  NOT NULL,
  entity_type      VARCHAR(50)  NOT NULL,
  entity_id        CHAR(36)     NOT NULL,
  transaction_ref  VARCHAR(255) DEFAULT NULL,
  request_payload  JSON         DEFAULT NULL,
  response_payload JSON         DEFAULT NULL,
  status           VARCHAR(30)  DEFAULT NULL,
  initiated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at     DATETIME     DEFAULT NULL,
  error_message    TEXT         DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Register page code
INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES (UUID(), 'APPOINTMENT_ESIGN', 'Appointment Letter E-Sign', 'letters', 'Candidate Aadhaar e-sign for appointment', 1);

-- Grant super_admin
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog WHERE page_code = 'APPOINTMENT_ESIGN';
