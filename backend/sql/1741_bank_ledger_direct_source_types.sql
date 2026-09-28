-- 1741_bank_ledger_direct_source_types.sql
--
-- bank_account_ledger_entry.source_type distinguished only 'voucher' (a Payment Voucher
-- release) from 'reconciliation_adjustment' (a bank-statement item HRMS never recorded). Once
-- 1739/1740 let Direct Vendor Payment Dispatch and Direct Imprest Allocation write ledger
-- entries of their own, those entries need their own values -- otherwise every
-- reconciliation/Tally-export query that filters `source_type = 'voucher'` would either miss
-- them (if it stays that strict) or silently lump a direct payment in with a voucher release (if
-- it's loosened to `voucher_id IS NULL OR source_type = 'voucher'`, which would also catch real
-- reconciliation_adjustment rows). Naming them explicitly avoids both.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COLUMN_TYPE NOT LIKE '%''direct_vendor_dispatch''%',
    "ALTER TABLE bank_account_ledger_entry MODIFY COLUMN source_type ENUM('voucher','reconciliation_adjustment','direct_vendor_dispatch','direct_imprest_allocation') NOT NULL DEFAULT 'voucher'",
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bank_account_ledger_entry' AND COLUMN_NAME = 'source_type'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1741_bank_ledger_direct_source_types.sql applied' AS migration_status;
