-- 1740_imprest_allocation_bank_account.sql
--
-- Same gap as 1739, on the other "real bank-funded" quick-pay path: imprest_allocation records
-- bank_id against bank_master only. Direct Imprest Allocation (imprest.routes.ts POST
-- /imprest/allocations -> imprest.service.ts's createAllocation()/reviewAllocation()) never
-- wrote to bank_account_ledger_entry, despite its own code comment calling this "a real
-- bank-funded top-up." Adding company_bank_account_id is what lets that write happen.
--
-- Nullable, not backfilled, same reasoning as 1739: no reliable source for which account an
-- existing allocation actually used.

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='imprest_allocation' AND COLUMN_NAME='company_bank_account_id');
SET @q = IF(@s=0,
  'ALTER TABLE imprest_allocation ADD COLUMN company_bank_account_id CHAR(36) NULL COMMENT "References company_bank_account.id -- the company''s own paying account. NULL on rows written before this column existed; never backfilled." AFTER bank_id',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='imprest_allocation' AND INDEX_NAME='idx_ia_company_bank_account');
SET @q = IF(@s=0,
  'CREATE INDEX idx_ia_company_bank_account ON imprest_allocation (company_bank_account_id)',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SELECT '1740_imprest_allocation_bank_account.sql applied' AS migration_status;
