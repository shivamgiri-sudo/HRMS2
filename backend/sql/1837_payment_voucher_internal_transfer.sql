-- 1837_payment_voucher_internal_transfer.sql
--
-- A fourth voucher purpose: moving money between two of the company's OWN bank accounts
-- (company_bank_account rows), as opposed to paying an external vendor/imprest/statutory head.
-- destination_bank_account_id is the new column release() needs to know which account receives
-- the funds; payable_account_id stays NOT NULL and is satisfied by the seeded
-- "Inter-Account Transfer" row below, used as the counterpart on both ledger legs — no schema
-- change to that column, same pattern release() already uses for "TDS Payable" by name lookup.
--
-- The current ENUM ('vendor_grn','imprest_allocation','sales_receipt','general','vendor_advance',
-- 'vendor_advance_application') is 1747_vendor_advance_payments.sql's — confirmed from migration
-- history (grep for the last MODIFY COLUMN source_type against payment_voucher specifically;
-- 1741/1803 modify source_type on other tables, not this one) rather than assumed.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COLUMN_TYPE NOT LIKE '%''internal_transfer''%',
    "ALTER TABLE payment_voucher MODIFY COLUMN source_type ENUM('vendor_grn','imprest_allocation','sales_receipt','general','vendor_advance','vendor_advance_application','internal_transfer') NOT NULL",
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'source_type'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'destination_bank_account_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE payment_voucher ADD COLUMN destination_bank_account_id CHAR(36) NULL COMMENT ''FK company_bank_account. Set only when source_type=internal_transfer — the account receiving the funds.'' AFTER bank_account_id, ADD INDEX idx_pv_destination_bank_account (destination_bank_account_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO payable_account_master (id, account_name, account_type, tally_ledger_name, active_status)
VALUES (UUID(), 'Inter-Account Transfer', 'other', 'Inter-Account Transfer', 1);

SELECT '1837_payment_voucher_internal_transfer.sql applied' AS migration_status;
