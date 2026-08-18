-- 1234_imprest_allocation_accounting_period.sql
-- Adds accounting_period (YYYY-MM) to imprest_allocation, mirroring grn_request.
--
-- When an allocation date falls in a locked P&L period, Finance Head previously had no
-- override path and the allocation was hard-blocked. With this column, finance_head or
-- super_admin can book the allocation to the current open period while keeping the
-- original payment date, exactly as grn_request already allows.
--
-- Additive, safe to rerun.
USE mas_hrms;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'imprest_allocation'
      AND column_name = 'accounting_period') = 0,
  'ALTER TABLE imprest_allocation ADD COLUMN accounting_period CHAR(7) NULL COMMENT ''Override YYYY-MM for P&L period when allocation_date falls in a locked period''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1234_imprest_allocation_accounting_period.sql applied' AS migration_status;

-- Rollback:
--   ALTER TABLE imprest_allocation DROP COLUMN accounting_period;