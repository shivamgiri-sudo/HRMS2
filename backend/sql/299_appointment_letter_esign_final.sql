-- Migration 299: Appointment Letter E-Sign Final (full column parity + audit table)
-- MySQL 8.0 safe. Uses stored procedure pattern for ALTER TABLE IF NOT EXISTS column.
-- Safe to re-run.

-- ── 1. Add all e-sign columns to appointment_letter_request (if not already present) ──

DROP PROCEDURE IF EXISTS _299_add_col;
DELIMITER $$
CREATE PROCEDURE _299_add_col(
  IN tbl     VARCHAR(64),
  IN col     VARCHAR(64),
  IN col_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @_sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', col_def);
    PREPARE _stmt FROM @_sql;
    EXECUTE _stmt;
    DEALLOCATE PREPARE _stmt;
  END IF;
END$$
DELIMITER ;

-- esign_provider: 'manual' | 'digilocker' | 'aadhaar_esign' etc.
CALL _299_add_col('appointment_letter_request', 'esign_provider',            "VARCHAR(50)  NULL DEFAULT 'manual'");
CALL _299_add_col('appointment_letter_request', 'esign_transaction_id',      "VARCHAR(255) NULL");
CALL _299_add_col('appointment_letter_request', 'candidate_esign_url',       "TEXT NULL");
CALL _299_add_col('appointment_letter_request', 'candidate_esign_status',    "VARCHAR(30)  NULL DEFAULT 'pending'");
CALL _299_add_col('appointment_letter_request', 'candidate_esign_at',        "DATETIME NULL");
CALL _299_add_col('appointment_letter_request', 'company_sign_status',       "VARCHAR(30)  NULL DEFAULT 'pending'");
CALL _299_add_col('appointment_letter_request', 'company_sign_at',           "DATETIME NULL");
CALL _299_add_col('appointment_letter_request', 'company_signed_by',         "CHAR(36) NULL");
CALL _299_add_col('appointment_letter_request', 'pdf_locked',                "TINYINT(1) NOT NULL DEFAULT 0");
CALL _299_add_col('appointment_letter_request', 'pdf_locked_at',             "DATETIME NULL");
CALL _299_add_col('appointment_letter_request', 'vault_path',                "TEXT NULL");
CALL _299_add_col('appointment_letter_request', 'manual_override_approved',  "TINYINT(1) NOT NULL DEFAULT 0");
CALL _299_add_col('appointment_letter_request', 'manual_override_reason',    "TEXT NULL");
CALL _299_add_col('appointment_letter_request', 'manual_override_by',        "CHAR(36) NULL");
CALL _299_add_col('appointment_letter_request', 'manual_override_at',        "DATETIME NULL");
-- states: draft / generated / candidate_esign_pending / candidate_signed /
--         company_sign_pending / company_signed / locked / completed /
--         override_requested / override_approved
CALL _299_add_col('appointment_letter_request', 'current_state',             "VARCHAR(50) NOT NULL DEFAULT 'draft'");

DROP PROCEDURE IF EXISTS _299_add_col;

-- ── 2. Appointment letter audit table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appointment_letter_audit (
  id                CHAR(36)     NOT NULL,
  letter_request_id CHAR(36)     NOT NULL,
  action            VARCHAR(50)  NOT NULL,
  from_state        VARCHAR(50)  NULL,
  to_state          VARCHAR(50)  NULL,
  performed_by      CHAR(36)     NULL,
  remarks           TEXT         NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_request (letter_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Register page in page_catalog ─────────────────────────────────────────

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
VALUES (
  UUID(),
  'APPOINTMENT_ESIGN',
  'Appointment Letter E-Sign',
  '/ats/appointment-esign',
  'letters',
  'Candidate e-sign workflow for appointment letter — states: draft/generated/candidate_esign_pending/candidate_signed/company_sign_pending/company_signed/locked/completed/override_requested/override_approved',
  1
);
