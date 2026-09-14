-- Poll state for eSign completion reconciliation.
--
-- Luckpay does not reliably push a completion callback (see the header comment in
-- luckpay-status.service.ts), so a document can sit at 'esign_initiated' forever
-- after the employee has genuinely signed. Verified in production: an employee
-- completed a real Aadhaar eSign and the transaction still read status=PENDING
-- with signed_file_id NULL and no signed file anywhere on disk.
--
-- These columns let a worker pull completion on a backoff schedule instead of
-- polling every open transaction on a fixed interval — which matters because
-- checkESignStatus and downloadESignDocument may themselves be billed per call.
--
-- Purely additive. Existing rows get next_poll_at = NULL, which the worker treats
-- as "eligible now", so in-flight transactions are picked up on first run.

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'employee_document_esign_transaction'
      AND COLUMN_NAME = 'next_poll_at') = 0,
  'ALTER TABLE employee_document_esign_transaction
     ADD COLUMN next_poll_at DATETIME NULL AFTER completed_at,
     ADD COLUMN poll_attempts INT NOT NULL DEFAULT 0 AFTER next_poll_at,
     ADD COLUMN last_polled_at DATETIME NULL AFTER poll_attempts',
  'SELECT ''employee_document_esign_transaction poll-state columns already exist'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Drives the worker's claim query: WHERE status NOT IN (terminal) AND next_poll_at <= NOW()
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'employee_document_esign_transaction'
      AND INDEX_NAME = 'idx_edet_next_poll') = 0,
  'ALTER TABLE employee_document_esign_transaction
     ADD INDEX idx_edet_next_poll (next_poll_at, status)',
  'SELECT ''idx_edet_next_poll already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
