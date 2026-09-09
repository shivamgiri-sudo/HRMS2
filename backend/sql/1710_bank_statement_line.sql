-- 1710_bank_statement_line.sql
--
-- Each parsed row from an uploaded bank statement. match_status starts 'unmatched'; the
-- matching engine (bank-reconciliation-match.service.ts) flips it to 'matched' (linked to a
-- real bank_account_ledger_entry that was already there) or 'adjusted' (a brand-new ledger
-- entry was posted because the bank shows something HRMS didn't record, e.g. a bank charge).
CREATE TABLE IF NOT EXISTS bank_statement_line (
  id                      CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  import_id               CHAR(36)      NOT NULL,
  txn_date                DATE          NOT NULL,
  description             TEXT          NOT NULL,
  reference                VARCHAR(100)  NULL,
  debit_amount            DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit_amount           DECIMAL(18,2) NOT NULL DEFAULT 0,
  match_status            ENUM('unmatched','matched','adjusted') NOT NULL DEFAULT 'unmatched',
  matched_ledger_entry_id CHAR(36)      NULL,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bsl_import (import_id),
  INDEX idx_bsl_status (import_id, match_status),
  INDEX idx_bsl_matched_entry (matched_ledger_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1710_bank_statement_line.sql applied' AS migration_status;
