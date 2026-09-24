-- Employee acceptance flow for issued appointment letters.
--
-- The appointment-letter email has always carried a "Review & Accept" button, but
-- nothing ever served the page behind it (the link 404'd). This migration adds the
-- two pieces of storage that flow needs. Purely additive and replay-safe.
--
-- 1. appointment_letter_issue.accept_token_hash
--    verify_token_hash is printed as the QR on the already-signed PDF, so it cannot
--    be rotated without breaking verification of letters already in circulation.
--    The accept link therefore gets its own token, stored only as a SHA-256 hash
--    (same rule as verify_token_hash). NULL on every letter issued before this
--    migration: for those, the public accept endpoints still recognise the verify
--    token, because that is what the emails already sitting in inboxes carry.
--
-- 2. appointment_letter_esign_transaction
--    One row per Aadhaar eSign session started for a letter. Deliberately NOT
--    employee_document_esign_transaction: that table's checklist_id is a NOT NULL
--    foreign key to a joining-document checklist row, and every joining-document
--    reader joins on it, so an appointment-letter row anchored there would show up
--    as a phantom transaction against a real joining document. No foreign keys
--    here, so no collation coupling to the parent tables.
--    open_marker + UNIQUE(issue_id, open_marker) allows one live session per
--    letter (NULLs compare distinct, so any number of closed rows).

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_letter_issue'
      AND COLUMN_NAME = 'accept_token_hash') = 0,
  'ALTER TABLE appointment_letter_issue
     ADD COLUMN accept_token_hash CHAR(64) NULL AFTER verify_token_hash,
     ADD UNIQUE KEY uq_ali_accept (accept_token_hash)',
  'SELECT ''appointment_letter_issue.accept_token_hash already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS appointment_letter_esign_transaction (
  id                    CHAR(36)     NOT NULL PRIMARY KEY,
  issue_id              CHAR(36)     NOT NULL,
  employee_id           CHAR(36)     NOT NULL,
  provider              VARCHAR(50)  NOT NULL DEFAULT 'luckpay',
  client_transaction_id VARCHAR(120) NOT NULL,
  provider_reference_id VARCHAR(150) NULL,
  signer_name           VARCHAR(255) NULL,
  -- initiating | initiated | link_generated | pending | failed | signed | expired
  -- | cancelled | abandoned_unresolved | provider_error
  status                VARCHAR(40)  NOT NULL DEFAULT 'initiating',
  provider_url          TEXT         NULL,
  response_payload      JSON         NULL,
  -- The employee-signed artefact retrieved from the provider. The company-signed
  -- original stays on appointment_letter_issue.signed_file_path untouched.
  signed_file_path      TEXT         NULL,
  signed_file_sha256    CHAR(64)     NULL,
  error_message         TEXT         NULL,
  open_marker           CHAR(1)      NULL,
  initiated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at          DATETIME     NULL,
  next_poll_at          DATETIME     NULL,
  poll_attempts         INT          NOT NULL DEFAULT 0,
  last_polled_at        DATETIME     NULL,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alet_client_txn (provider, client_transaction_id),
  UNIQUE KEY uq_alet_issue_open (issue_id, open_marker),
  INDEX idx_alet_issue (issue_id),
  INDEX idx_alet_status_poll (status, next_poll_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
