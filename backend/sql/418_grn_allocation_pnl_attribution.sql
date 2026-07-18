-- 418_grn_allocation_pnl_attribution.sql
-- Makes split-GRN P&L attribution line-accurate without requiring MySQL TRIGGER
-- privileges. Existing rows are backfilled, while the reconciliation view derives
-- a governed Head/Sub-Head bucket and recognition period for any later null values.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_cost_allocation'
      AND column_name = 'pnl_bucket') = 0,
  'ALTER TABLE grn_cost_allocation ADD COLUMN pnl_bucket VARCHAR(60) NULL AFTER cost_class',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_cost_allocation'
      AND column_name = 'recognition_period') = 0,
  'ALTER TABLE grn_cost_allocation ADD COLUMN recognition_period CHAR(7) NULL AFTER pnl_bucket',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_cost_allocation'
      AND index_name = 'idx_grn_allocation_pnl_period') = 0,
  'ALTER TABLE grn_cost_allocation ADD INDEX idx_grn_allocation_pnl_period (recognition_period, pnl_bucket, process_id, branch_id, lifecycle_status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill current allocation rows from the governed Finance Head/Sub-Head master.
-- Exact Sub-Head mapping takes precedence. Direct/indirect classification remains
-- the safe fallback for older free-text budget lines.
UPDATE grn_cost_allocation a
JOIN finance_budget_line l ON l.id = a.budget_line_id
JOIN grn_request g ON g.id = a.grn_request_id
LEFT JOIN finance_expense_head_master h
  ON (LOWER(h.head_code) = LOWER(l.head) OR LOWER(h.head_name) = LOWER(l.head))
 AND h.active_status = 1
LEFT JOIN finance_expense_sub_head_master sh
  ON sh.head_id = h.id
 AND (
      LOWER(sh.sub_head_code) = LOWER(COALESCE(l.sub_head, ''))
      OR LOWER(sh.sub_head_name) = LOWER(COALESCE(l.sub_head, ''))
 )
 AND sh.active_status = 1
SET a.pnl_bucket = COALESCE(
    a.pnl_bucket,
    sh.pnl_bucket,
    CASE WHEN a.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END
  ),
  a.recognition_period = COALESCE(
    a.recognition_period,
    DATE_FORMAT(
      COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at),
      '%Y-%m'
    )
  );

-- Reusable source of truth for Process P&L and finance reconciliation. The view
-- intentionally re-resolves null buckets from the approved budget Head/Sub-Head,
-- so new allocations remain accurate without a database trigger. Only consumed
-- allocations are actual cost; draft/reserved rows remain budget commitments.
CREATE OR REPLACE VIEW vw_process_pnl_grn_allocation AS
SELECT
  a.process_id,
  a.cost_centre_id,
  a.branch_id,
  COALESCE(
    a.recognition_period,
    DATE_FORMAT(
      COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at),
      '%Y-%m'
    )
  ) AS period_code,
  COALESCE(
    a.pnl_bucket,
    sh.pnl_bucket,
    CASE WHEN a.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END
  ) AS pnl_bucket,
  SUM(COALESCE(a.pnl_cost_amount, 0)) AS pnl_cost_amount,
  SUM(COALESCE(a.amount_with_tax, 0)) AS gross_amount,
  COUNT(DISTINCT a.id) AS allocation_count,
  COUNT(DISTINCT a.grn_request_id) AS grn_count,
  MAX(COALESCE(a.consumed_at, a.updated_at, a.created_at)) AS freshness
FROM grn_cost_allocation a
JOIN grn_request g ON g.id = a.grn_request_id
JOIN finance_budget_line l ON l.id = a.budget_line_id
LEFT JOIN finance_expense_head_master h
  ON (LOWER(h.head_code) = LOWER(l.head) OR LOWER(h.head_name) = LOWER(l.head))
 AND h.active_status = 1
LEFT JOIN finance_expense_sub_head_master sh
  ON sh.head_id = h.id
 AND (
      LOWER(sh.sub_head_code) = LOWER(COALESCE(l.sub_head, ''))
      OR LOWER(sh.sub_head_name) = LOWER(COALESCE(l.sub_head, ''))
 )
 AND sh.active_status = 1
WHERE a.lifecycle_status = 'consumed'
  AND LOWER(COALESCE(g.status, '')) NOT IN ('rejected', 'cancelled', 'reversed')
GROUP BY
  a.process_id,
  a.cost_centre_id,
  a.branch_id,
  COALESCE(
    a.recognition_period,
    DATE_FORMAT(
      COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at),
      '%Y-%m'
    )
  ),
  COALESCE(
    a.pnl_bucket,
    sh.pnl_bucket,
    CASE WHEN a.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END
  );

SELECT '418_grn_allocation_pnl_attribution.sql applied' AS migration_status;
