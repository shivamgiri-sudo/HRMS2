-- 1739_vendor_payment_transaction_bank_account.sql
--
-- vendor_payment_transaction (413_vendor_payment_transaction_ledger.sql) records bank_id
-- against bank_master -- the generic bank-name directory -- with no reference to WHICH of the
-- company's own accounts (company_bank_account, 1701_company_bank_account.sql) the money
-- actually left from. That gap is why Direct Vendor Payment Dispatch (vendor-payment.routes.ts
-- POST /vendor-payments/:id/dispatch -> vendor-payment-ledger.service.ts's dispatch()) has
-- never written a bank_account_ledger_entry row, unlike the same dispatch() call made from
-- inside Payment Voucher release() (which always carries a bank_account_id via the voucher).
--
-- Nullable, and NOT backfilled: every dispatch to date was written before this column existed,
-- so there is no reliable way to know which account was actually used for a historical row --
-- guessing wrong here would corrupt reconciliation, which is worse than leaving the gap visible.
-- New dispatches populate it going forward once the frontend requires the field.

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vendor_payment_transaction' AND COLUMN_NAME='company_bank_account_id');
SET @q = IF(@s=0,
  'ALTER TABLE vendor_payment_transaction ADD COLUMN company_bank_account_id CHAR(36) NULL COMMENT "References company_bank_account.id -- the company''s own paying account. NULL on rows written before this column existed; never backfilled." AFTER bank_id',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vendor_payment_transaction' AND INDEX_NAME='idx_vptx_company_bank_account');
SET @q = IF(@s=0,
  'CREATE INDEX idx_vptx_company_bank_account ON vendor_payment_transaction (company_bank_account_id)',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SELECT '1739_vendor_payment_transaction_bank_account.sql applied' AS migration_status;
