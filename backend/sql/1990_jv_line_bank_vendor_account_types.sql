-- 1990_jv_line_bank_vendor_account_types.sql
-- Journal vouchers may now post to bank accounts and vendors (Finance needs them for corrections,
-- opening balances and contra entries). Additive ENUM widen: existing rows are untouched.
-- Guarded so a re-run, or a table that was never created, is a no-op.
SET @col = (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_voucher_line' AND COLUMN_NAME = 'account_type');
SET @sql = IF(@col IS NULL, 'SELECT ''journal_voucher_line missing - nothing to do'' AS note',
           IF(@col LIKE '%bank_account%', 'SELECT ''already widened'' AS note',
              'ALTER TABLE journal_voucher_line MODIFY COLUMN account_type ENUM(''expense_sub_head'',''payable_account'',''bank_account'',''vendor'') NOT NULL'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1990_jv_line_bank_vendor_account_types.sql applied' AS migration_status;
-- Rollback: ALTER TABLE journal_voucher_line MODIFY COLUMN account_type ENUM('expense_sub_head','payable_account') NOT NULL; (only if no bank/vendor lines exist)
