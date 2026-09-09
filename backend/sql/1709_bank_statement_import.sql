-- 1709_bank_statement_import.sql
--
-- One row per uploaded bank statement file. column_mapping records which uploaded column is
-- which field (see bank-statement-import.service.ts) so the next upload for the same account
-- can reuse it without asking again.
CREATE TABLE IF NOT EXISTS bank_statement_import (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  bank_account_id     CHAR(36)      NOT NULL,
  period_id           CHAR(36)      NOT NULL,
  original_filename   VARCHAR(255)  NOT NULL,
  column_mapping      JSON          NOT NULL,
  imported_by         CHAR(36)      NULL,
  imported_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  row_count           INT           NOT NULL DEFAULT 0,
  INDEX idx_bsi_account (bank_account_id),
  INDEX idx_bsi_period (period_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1709_bank_statement_import.sql applied' AS migration_status;
