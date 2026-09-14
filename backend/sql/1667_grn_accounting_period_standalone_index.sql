-- 1667_grn_accounting_period_standalone_index.sql
--
-- The GRN register report filters by accounting_period (finance month) without a
-- branch_id predicate when the caller is a super_admin or finance_head whose scope
-- covers all branches. The existing composite index (branch_id, accounting_period)
-- cannot help an all-branches query because MySQL can only use a composite index
-- from its leftmost column — so a WHERE on accounting_period alone forces a full
-- table scan on ~85,000 rows, joined against grn_cost_allocation and
-- vendor_payment_tracking, which consistently exceeds the 30-second client timeout.
--
-- A standalone index on accounting_period lets the engine seek directly to the
-- requested month across all branches, reducing the scan from O(all GRNs) to
-- O(GRNs in that month), typically <100 rows.
--
-- Similarly, financial_year is used in getGrnSummary and the listGrns path without
-- a branch_id, so a standalone index on financial_year prevents the same full-scan
-- pattern on those queries.

SET @migration = '1667_grn_accounting_period_standalone_index.sql';

-- accounting_period standalone index
SET @q = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE table_schema = DATABASE()
       AND table_name  = 'grn_request'
       AND index_name  = 'idx_grn_accounting_period') = 0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_accounting_period (accounting_period)',
  'SELECT ''idx_grn_accounting_period already exists'' AS info'
);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- financial_year standalone index
SET @q = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE table_schema = DATABASE()
       AND table_name  = 'grn_request'
       AND index_name  = 'idx_grn_financial_year') = 0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_financial_year (financial_year)',
  'SELECT ''idx_grn_financial_year already exists'' AS info'
);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT CONCAT(@migration, ' applied') AS migration_status;
