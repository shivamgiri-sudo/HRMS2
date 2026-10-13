-- P5 Invoice engine gaps (2026-10-06, docs/superpowers/plans/2026-10-06-invoicing-receivables-tally.md, Wave 1 task B).
-- ADDITIVE ONLY. Every statement is guarded against re-run and against a missing table:
--   * client_invoice: PO numbers (CSV, max 4), GRN no/date, JCC no/date, RCM flag, last-sent stamp.
--   * client_invoice_audit_log.action ENUM is WIDENED (existing values kept, same order) so the new
--     workflow actions can be logged.
--   * client_invoice_change_request (void / status-change maker-checker requests).
--   * client_invoice_submission (every "Submit to Client" email: recipients, sent_by, sent_at, outcome).
-- No existing row is updated; existing approved invoice amounts are untouched.
-- Rollback (manual, only if needed): DROP TABLE client_invoice_submission, client_invoice_change_request;
--   ALTER TABLE client_invoice DROP COLUMN last_sent_by, last_sent_at, rcm_applicable, jcc_date, jcc_no, grn_date, grn_no, po_numbers;
--   (audit-log ENUM widening is harmless to keep).

SET @add_client_invoice_po_numbers = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN po_numbers VARCHAR(300) NULL',
    'SELECT 1 -- client_invoice.po_numbers already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'po_numbers'
);
PREPARE _stmt FROM @add_client_invoice_po_numbers;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_grn_no = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN grn_no VARCHAR(60) NULL',
    'SELECT 1 -- client_invoice.grn_no already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'grn_no'
);
PREPARE _stmt FROM @add_client_invoice_grn_no;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_grn_date = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN grn_date DATE NULL',
    'SELECT 1 -- client_invoice.grn_date already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'grn_date'
);
PREPARE _stmt FROM @add_client_invoice_grn_date;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_jcc_no = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN jcc_no VARCHAR(60) NULL',
    'SELECT 1 -- client_invoice.jcc_no already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'jcc_no'
);
PREPARE _stmt FROM @add_client_invoice_jcc_no;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_jcc_date = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN jcc_date DATE NULL',
    'SELECT 1 -- client_invoice.jcc_date already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'jcc_date'
);
PREPARE _stmt FROM @add_client_invoice_jcc_date;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_rcm_applicable = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN rcm_applicable TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT 1 -- client_invoice.rcm_applicable already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'rcm_applicable'
);
PREPARE _stmt FROM @add_client_invoice_rcm_applicable;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_last_sent_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN last_sent_at DATETIME NULL',
    'SELECT 1 -- client_invoice.last_sent_at already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'last_sent_at'
);
PREPARE _stmt FROM @add_client_invoice_last_sent_at;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_last_sent_by = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN last_sent_by CHAR(36) NULL',
    'SELECT 1 -- client_invoice.last_sent_by already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'last_sent_by'
);
PREPARE _stmt FROM @add_client_invoice_last_sent_by;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Widen the audit action ENUM only when the new values are not there yet.
SET @widen_audit_action = (
  SELECT IF(
    COUNT(*) = 1 AND MAX(COLUMN_TYPE) NOT LIKE '%submitted_to_client%',
    "ALTER TABLE client_invoice_audit_log MODIFY COLUMN action ENUM('created','edited','approved','rejected','void_requested','void_approved','void_declined','status_change_requested','status_change_approved','status_change_declined','submitted_to_client') NOT NULL",
    'SELECT 1 -- client_invoice_audit_log.action already widened (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_audit_log' AND COLUMN_NAME = 'action'
);
PREPARE _stmt FROM @widen_audit_action;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

CREATE TABLE IF NOT EXISTS client_invoice_change_request (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id       CHAR(36)      NOT NULL,
  request_type     ENUM('void','status_change') NOT NULL,
  current_value    VARCHAR(100)  NULL,
  requested_value  VARCHAR(100)  NULL,
  reason           TEXT          NOT NULL,
  request_status   ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',
  requested_by     CHAR(36)      NOT NULL,
  requested_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by       CHAR(36)      NULL,
  decided_at       DATETIME      NULL,
  decision_note    TEXT          NULL,
  KEY idx_cicr_invoice (invoice_id),
  KEY idx_cicr_status (request_status, requested_at),
  CONSTRAINT fk_cicr_invoice FOREIGN KEY (invoice_id) REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_invoice_submission (
  id             CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id     CHAR(36)      NOT NULL,
  to_emails      VARCHAR(1000) NOT NULL,
  cc_emails      VARCHAR(1000) NULL,
  subject        VARCHAR(300)  NOT NULL,
  with_letterhead TINYINT(1)   NOT NULL DEFAULT 1,
  send_status    ENUM('sent','failed') NOT NULL,
  message_id     VARCHAR(255)  NULL,
  error_message  VARCHAR(500)  NULL,
  sent_by        CHAR(36)      NOT NULL,
  sent_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cis_invoice (invoice_id, sent_at),
  CONSTRAINT fk_cis_invoice FOREIGN KEY (invoice_id) REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
