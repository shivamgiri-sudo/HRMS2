-- 1094_imprest_transaction_ledger.sql
-- The append-only ledger the imprest balance is derived from (Requirement 7), plus the two
-- columns that bridge an imprest GRN to it.
--
-- WHY A LEDGER RATHER THAN A BALANCE COLUMN
-- The brief asks for it, and the reason is worth stating: a single mutable balance field has
-- no answer to "why is it this number". Every correction overwrites the evidence of the last
-- one. An append-only ledger answers the question by construction, and a wrong entry is fixed
-- with a contra entry rather than by editing history — which is also how the rest of the
-- accounting world expects to see it.
--
--   Opening + Allocations + Positive adjustments
--            − Approved vouchers − Returns − Negative adjustments  =  Closing
--
-- APPEND-ONLY IS A CODE-AND-REVIEW INVARIANT, NOT A DATABASE ONE
-- Stating this plainly rather than implying a guarantee that is not there: MySQL TRIGGERs are
-- not available in this environment (418_grn_allocation_pnl_attribution.sql's own header notes
-- it was written "without requiring MySQL TRIGGER privileges"). So the rule is enforced by
--   (a) no UPDATE or DELETE against this table anywhere in backend/src, asserted by a
--       source-scan test;
--   (b) uq_imprest_ledger_source, so a retried approval cannot double-post;
--   (c) writing every entry inside the transaction that causes it.
--
-- WHY direction PLUS a positive amount, RATHER THAN A SIGNED NUMBER
-- A signed column invites `SUM(amount)` and gets the right answer until someone stores a
-- negative credit. Splitting direction from magnitude makes the aggregate explicit and makes
-- a malformed row visible instead of silently netting off.
--
-- THE VOUCHER IS THE EXISTING IMPREST GRN, NOT A NEW ENTITY
-- grn_request already carries budget linkage, document upload with sha256 hashing, duplicate
-- detection, blocking validations and a two-stage approval, and db_bill agrees: 23,056 of its
-- expense entries are ExpenseEntryType='Imprest'. Building a parallel voucher would mean a
-- second writer of finance_budget_line.consumed_amount with no shared lock discipline, which
-- is the legacy/smart split repeated deliberately. The bridge columns below are what connect
-- the two.
--
-- Additive only, safe to rerun.

CREATE TABLE IF NOT EXISTS imprest_transaction_ledger (
  id CHAR(36) NOT NULL,
  imprest_manager_id CHAR(36) NOT NULL,
  branch_id CHAR(36) NOT NULL,
  entry_type ENUM('opening','allocation','voucher','return','adjustment','closure') NOT NULL,
  direction ENUM('credit','debit') NOT NULL
    COMMENT 'credit increases the float, debit reduces it',
  amount DECIMAL(18,2) NOT NULL COMMENT 'Always positive; direction carries the sign',
  balance_after DECIMAL(18,2) NOT NULL
    COMMENT 'Running balance at this entry, computed under a row lock. A reconciliation query must be able to prove it equals SUM(credit) - SUM(debit) up to this row.',
  reference_type VARCHAR(40) NULL COMMENT 'imprest_allocation | grn_request | manual',
  reference_id CHAR(36) NULL,
  period_code CHAR(7) NULL COMMENT 'YYYY-MM the entry belongs to, for period reports',
  transaction_date DATE NOT NULL,
  narration VARCHAR(500) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Makes a retried approval a no-op rather than a double posting. NULLs are distinct in a
  -- MySQL unique index, so manual adjustments (which carry no reference) are unconstrained,
  -- which is correct — two genuine adjustments on one day are legitimate.
  UNIQUE KEY uq_imprest_ledger_source (imprest_manager_id, entry_type, reference_type, reference_id),
  INDEX idx_imprest_ledger_manager (imprest_manager_id, transaction_date, id),
  INDEX idx_imprest_ledger_branch (branch_id, transaction_date),
  INDEX idx_imprest_ledger_period (period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bridge columns on grn_request. NULL on every existing row and on every vendor GRN; only an
-- imprest voucher carries them.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'grn_request'
      AND column_name = 'imprest_manager_id') = 0,
  'ALTER TABLE grn_request
     ADD COLUMN imprest_manager_id CHAR(36) NULL
       COMMENT ''Set only on grn_type = imprest; the float this voucher draws down'',
     ADD COLUMN imprest_ledger_entry_id CHAR(36) NULL
       COMMENT ''The debit posted when this voucher was approved; NULL until then''',
  'SELECT ''grn_request imprest bridge columns already exist'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'grn_request'
      AND index_name = 'idx_grn_imprest_manager') = 0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_imprest_manager (imprest_manager_id)',
  'SELECT ''idx_grn_imprest_manager exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Two more statuses so a rejected voucher can go BACK to the Branch Head rather than dying
-- (Requirement 9). Appending to an ENUM is a table rebuild, unlike the guarded ADD COLUMNs
-- elsewhere in this set; it is cheap here only because grn_request holds no rows in mas_hrms
-- today, and 1062_grn_consumption_reversal.sql set the precedent for widening this enum.
--
-- 'draft' is deliberately NOT reused for the returned state: it means "never submitted", and
-- saveAllocations/saveComponentAllocations gate on it, so reusing it would let a returned
-- voucher silently rewrite its allocations with nobody aware it had already been through
-- approval.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'grn_request'
      AND column_name = 'status' AND COLUMN_TYPE LIKE '%returned_to_branch_head%') = 0,
  'ALTER TABLE grn_request
     MODIFY COLUMN status ENUM(
       ''draft'',''submitted'',''branch_head_approved'',''finance_head_approved'',
       ''pending_accounts_payment'',''payment_scheduled'',''partially_paid'',''paid'',
       ''approved'',''rejected'',''cancelled'',''consumption_reversed'',
       ''returned_to_branch_head'',''returned_to_raiser''
     ) NOT NULL DEFAULT ''draft''',
  'SELECT ''grn_request.status already allows the returned states'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1094_imprest_transaction_ledger.sql applied' AS migration_status;
