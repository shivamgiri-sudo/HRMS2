-- 412_finance_budget_quantity_controls.sql
-- Adds quantity reservation/consumption and one-budget-per-branch-period controls.
-- Safe to run after 411_branch_budget_grn_approval_flow.sql.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'finance_budget_line'
      AND column_name = 'reserved_quantity') = 0,
  'ALTER TABLE finance_budget_line ADD COLUMN reserved_quantity DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER justification',
  'SELECT ''finance_budget_line.reserved_quantity already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'finance_budget_line'
      AND column_name = 'consumed_quantity') = 0,
  'ALTER TABLE finance_budget_line ADD COLUMN consumed_quantity DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER reserved_quantity',
  'SELECT ''finance_budget_line.consumed_quantity already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- A branch has one revisable monthly budget header. Revisions stay on the same header.
SET @duplicate_budget_count = (
  SELECT COUNT(*)
  FROM (
    SELECT branch_id, period_code
    FROM finance_budget_header
    GROUP BY branch_id, period_code
    HAVING COUNT(*) > 1
  ) duplicate_periods
);

SET @sql = IF(
  @duplicate_budget_count = 0
  AND (SELECT COUNT(*) FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'finance_budget_header'
          AND index_name = 'uq_budget_branch_period') = 0,
  'ALTER TABLE finance_budget_header ADD UNIQUE KEY uq_budget_branch_period (branch_id, period_code)',
  'SELECT ''Unique branch-period budget key skipped: existing key or duplicate historical rows'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'finance_budget_line'
      AND index_name = 'idx_budget_line_available') = 0,
  'ALTER TABLE finance_budget_line ADD INDEX idx_budget_line_available (budget_id, reserved_amount, consumed_amount)',
  'SELECT ''idx_budget_line_available already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '412_finance_budget_quantity_controls.sql applied' AS migration_status;
