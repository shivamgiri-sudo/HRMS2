-- Company Bank Account opening balance is the base the Bank Ledger, the Payment
-- Voucher chain and the Tally export are all built on (migration 1701), but until
-- now it could be edited in place via PUT /api/finance/bank-accounts/:id by a
-- single finance_head/accounts_head/super_admin -- same single-approval gate as
-- editing the branch or the Tally ledger name, with no record of the old value
-- kept anywhere. That is not proportionate to what the field controls: an
-- unreviewed opening-balance edit silently reshapes every downstream
-- reconciliation with no second set of eyes and no before/after trail.
--
-- Maker-checker table for this one field only (same shape as cost_centre_master's
-- L1/L2 pattern in company-bank-account.service.ts's sibling
-- cost-centre-management.service.ts, single-stage here since this is master-data
-- setup, not a money-movement control point -- see that file's own header
-- comment). company-bank-account.service.ts's update() no longer accepts
-- openingBalance directly once an account exists; a change must go through
-- request -> approve here, and the approver must not be the requester.
CREATE TABLE IF NOT EXISTS company_bank_account_balance_change_request (
  id CHAR(36) NOT NULL PRIMARY KEY,
  bank_account_id CHAR(36) NOT NULL,
  current_value DECIMAL(14,2) NOT NULL,
  requested_value DECIMAL(14,2) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  requested_by CHAR(36) NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by CHAR(36) NULL,
  decided_at DATETIME NULL,
  decision_remarks VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cbabcr_account (bank_account_id),
  KEY idx_cbabcr_status (status),
  CONSTRAINT fk_cbabcr_account FOREIGN KEY (bank_account_id)
    REFERENCES company_bank_account(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
