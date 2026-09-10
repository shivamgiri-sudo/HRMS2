-- Payment Voucher: a third voucher purpose beyond Vendor GRN and Imprest Float.
--
-- Real vendor/imprest linkage isn't the only thing Finance pays out on a voucher — salary
-- payable adjustments, statutory dues, bank charges, and anything else with no GRN or imprest
-- manager behind it still needs the same Raise -> CEO Approve -> Release chain. 'general' has no
-- linked_vendor_payment_id / linked_imprest_manager_id; the Payable Account (ledger head) the
-- form already collects is the category (Salary Payable / Statutory Dues / Bank Charges / TDS
-- Payable / Other), and `particulars` (added below) carries the free-text description a GRN or
-- imprest manager name would otherwise have supplied.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COLUMN_TYPE NOT LIKE '%''general''%',
    'ALTER TABLE payment_voucher MODIFY COLUMN source_type ENUM(''vendor_grn'',''imprest_allocation'',''sales_receipt'',''general'') NOT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'source_type'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'particulars'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE payment_voucher ADD COLUMN particulars VARCHAR(255) NULL AFTER reason',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
