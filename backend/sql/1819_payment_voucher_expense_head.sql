-- 1819_payment_voucher_expense_head.sql
--
-- Payment vouchers for a vendor now record WHICH expense Head / Sub-head the payment is against,
-- chosen from the heads mapped to that vendor (vendor_expense_mapping), so a payment can be
-- tracked by vendor + head + sub-head + amount. Codes are the stable keys; names are stored so
-- the voucher keeps reading correctly if a master row is later renamed. All four are NULL for
-- vouchers that are not vendor-lane, for vendors with no mapping, and for every voucher raised
-- before this migration. Additive and idempotent.

SET @db := DATABASE();

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payment_voucher' AND COLUMN_NAME='expense_head_code');
SET @sql := IF(@c=0, 'ALTER TABLE payment_voucher ADD COLUMN expense_head_code VARCHAR(80) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payment_voucher' AND COLUMN_NAME='expense_head_name');
SET @sql := IF(@c=0, 'ALTER TABLE payment_voucher ADD COLUMN expense_head_name VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payment_voucher' AND COLUMN_NAME='expense_sub_head_code');
SET @sql := IF(@c=0, 'ALTER TABLE payment_voucher ADD COLUMN expense_sub_head_code VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payment_voucher' AND COLUMN_NAME='expense_sub_head_name');
SET @sql := IF(@c=0, 'ALTER TABLE payment_voucher ADD COLUMN expense_sub_head_name VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1819_payment_voucher_expense_head.sql applied' AS migration_status;

-- Rollback:
--   ALTER TABLE payment_voucher DROP COLUMN expense_head_code, DROP COLUMN expense_head_name,
--     DROP COLUMN expense_sub_head_code, DROP COLUMN expense_sub_head_name;
