-- 1708_bank_reconciliation_period.sql
--
-- Payment Voucher System Phase 4. One row per bank account per reconciliation window.
-- status='open' means matching is still in progress; 'closed' means the period balanced
-- (see bank-reconciliation-period.service.ts's close()) and every entry in it is now locked.
-- A bank account may have at most one 'open' period at a time — enforced in the service, the
-- same way payment_voucher's maker-checker is enforced in code rather than a DB constraint.
CREATE TABLE IF NOT EXISTS bank_reconciliation_period (
  id                          CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  bank_account_id             CHAR(36)      NOT NULL,
  from_date                   DATE          NOT NULL,
  to_date                     DATE          NOT NULL,
  status                      ENUM('open','closed') NOT NULL DEFAULT 'open',
  opening_balance             DECIMAL(18,2) NOT NULL DEFAULT 0,
  statement_closing_balance   DECIMAL(18,2) NULL COMMENT 'Typed in by the user from the real bank statement. Required to close.',
  computed_closing_balance    DECIMAL(18,2) NULL COMMENT 'HRMS running balance as of to_date. Stored at close.',
  outstanding_total           DECIMAL(18,2) NULL COMMENT 'Sum of unmatched ledger entries dated <= to_date. Stored at close.',
  closed_by                   CHAR(36)      NULL,
  closed_at                   DATETIME      NULL,
  reopened_by                 CHAR(36)      NULL,
  reopened_at                 DATETIME      NULL,
  reopen_reason               TEXT          NULL,
  created_by                  CHAR(36)      NULL,
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_brp_account_status (bank_account_id, status),
  INDEX idx_brp_account_dates (bank_account_id, from_date, to_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1708_bank_reconciliation_period.sql applied' AS migration_status;
