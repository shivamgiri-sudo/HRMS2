-- 1747_vendor_advance_payments.sql
--
-- Vendor advance / on-account payments (Phase 2 of the fullproof-build audit). A vendor can be
-- paid an amount not tied to any specific GRN yet ('vendor_advance'), and that credit can later
-- be applied against real GRN dues as they arise ('vendor_advance_application') -- both going
-- through the SAME raise -> CEO-approve -> release chain every other voucher already uses, per
-- the user's explicit choice (applying an advance is not a lighter action than raising a new
-- payment, even though no new money moves at apply time).
--
-- payment_voucher gains linked_vendor_id: neither new source type is GRN-anchored the way
-- vendor_grn is (linked_vendor_payment_id points at a GRN due, not a vendor), so there was no
-- existing column recording WHICH vendor a voucher is for when there's no GRN behind it.
--
-- vendor_advance_application reuses payment_voucher_grn_allocation AS-IS for "which GRN dues is
-- this advance being applied to, by how much" -- that table's shape (payment_voucher_id,
-- vendor_payment_tracking_id, allocated_amount) already fits; no new allocation table needed.
--
-- vendor_advance_ledger is the vendor-level running balance: credited when a vendor_advance
-- voucher releases (real money out), debited when a vendor_advance_application voucher releases
-- (money already spent, being matched to a due). Same running-balance-under-a-row-lock discipline
-- as bank_account_ledger_entry and imprest_transaction_ledger already use in this schema.

SET @db := DATABASE();

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'linked_vendor_id') = 0,
  'ALTER TABLE payment_voucher ADD COLUMN linked_vendor_id CHAR(36) NULL COMMENT "Which vendor this voucher is for, when there is no GRN to carry that (vendor_advance, vendor_advance_application). vendor_grn/imprest_allocation/general leave this NULL -- they already carry vendor identity through linked_vendor_payment_id or have none." AFTER linked_vendor_payment_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND INDEX_NAME = 'idx_pv_linked_vendor') = 0,
  'CREATE INDEX idx_pv_linked_vendor ON payment_voucher (linked_vendor_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COLUMN_TYPE NOT LIKE '%''vendor_advance''%',
    "ALTER TABLE payment_voucher MODIFY COLUMN source_type ENUM('vendor_grn','imprest_allocation','sales_receipt','general','vendor_advance','vendor_advance_application') NOT NULL",
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'source_type'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS vendor_advance_ledger (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  vendor_id CHAR(36) NOT NULL,
  branch_id CHAR(36) NOT NULL,
  direction ENUM('credit','debit') NOT NULL COMMENT 'credit = advance paid out (raises balance); debit = applied against a GRN due (reduces it)',
  amount DECIMAL(18,2) NOT NULL COMMENT 'Always positive; direction carries the sign',
  balance_after DECIMAL(18,2) NOT NULL COMMENT 'Running balance for this vendor, computed under a row lock -- same discipline as bank_account_ledger_entry.running_balance and imprest_transaction_ledger.balance_after',
  payment_voucher_id CHAR(36) NOT NULL,
  narration VARCHAR(500) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_val_vendor (vendor_id, created_at, id),
  INDEX idx_val_voucher (payment_voucher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1747_vendor_advance_payments.sql applied' AS migration_status;
