-- 418_grn_allocation_pnl_attribution.sql
-- Makes split-GRN P&L attribution line-accurate. Each allocation carries its own
-- DSC/BMC/other P&L bucket and recognition period rather than inheriting one
-- classification from the parent invoice.

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

-- Backfill existing allocation rows from the governed Finance Head/Sub-Head master.
-- Exact Sub-Head mapping takes precedence. Direct/indirect classification remains
-- the safe fallback for older free-text budget lines.
UPDATE grn_cost_allocation a
JOIN finance_budget_line l ON l.id = a.budget_line_id
JOIN grn_request g ON g.id = a.grn_request_id
LEFT JOIN finance_expense_head_master h
  ON LOWER(h.head_code) = LOWER(l.head)
  OR LOWER(h.head_name) = LOWER(l.head)
LEFT JOIN finance_expense_sub_head_master sh
  ON sh.head_id = h.id
 AND (
      LOWER(sh.sub_head_code) = LOWER(COALESCE(l.sub_head, ''))
      OR LOWER(sh.sub_head_name) = LOWER(COALESCE(l.sub_head, ''))
 )
SET a.pnl_bucket = COALESCE(
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

-- New allocation rows inherit their P&L treatment from the approved budget line.
-- A single-statement trigger is used so the normal migration splitter can execute it.
DROP TRIGGER IF EXISTS trg_grn_allocation_pnl_before_insert;
CREATE TRIGGER trg_grn_allocation_pnl_before_insert
BEFORE INSERT ON grn_cost_allocation
FOR EACH ROW
SET
  NEW.pnl_bucket = COALESCE(
    NEW.pnl_bucket,
    (
      SELECT sh.pnl_bucket
        FROM finance_budget_line l
        LEFT JOIN finance_expense_head_master h
          ON LOWER(h.head_code) = LOWER(l.head)
          OR LOWER(h.head_name) = LOWER(l.head)
        LEFT JOIN finance_expense_sub_head_master sh
          ON sh.head_id = h.id
         AND (
              LOWER(sh.sub_head_code) = LOWER(COALESCE(l.sub_head, ''))
              OR LOWER(sh.sub_head_name) = LOWER(COALESCE(l.sub_head, ''))
         )
       WHERE l.id = NEW.budget_line_id
       ORDER BY CASE
         WHEN LOWER(sh.sub_head_code) = LOWER(COALESCE(l.sub_head, '')) THEN 0
         WHEN LOWER(sh.sub_head_name) = LOWER(COALESCE(l.sub_head, '')) THEN 1
         ELSE 2
       END
       LIMIT 1
    ),
    CASE WHEN NEW.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END
  ),
  NEW.recognition_period = COALESCE(
    NEW.recognition_period,
    (
      SELECT DATE_FORMAT(
               COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at),
               '%Y-%m'
             )
        FROM grn_request g
       WHERE g.id = NEW.grn_request_id
       LIMIT 1
    )
  );

-- Reusable source of truth for Process P&L and finance reconciliation. Only consumed
-- allocations are actual cost; draft/reserved rows remain commitments, not P&L actuals.
CREATE OR REPLACE VIEW vw_process_pnl_grn_allocation AS
SELECT
  a.process_id,
  a.cost_centre_id,
  a.branch_id,
  a.recognition_period AS period_code,
  COALESCE(
    a.pnl_bucket,
    CASE WHEN a.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END
  ) AS pnl_bucket,
  SUM(COALESCE(a.pnl_cost_amount, 0)) AS pnl_cost_amount,
  SUM(COALESCE(a.amount_with_tax, 0)) AS gross_amount,
  COUNT(*) AS allocation_count,
  COUNT(DISTINCT a.grn_request_id) AS grn_count,
  MAX(COALESCE(a.consumed_at, a.updated_at, a.created_at)) AS freshness
FROM grn_cost_allocation a
JOIN grn_request g ON g.id = a.grn_request_id
WHERE a.lifecycle_status = 'consumed'
  AND LOWER(COALESCE(g.status, '')) NOT IN ('rejected', 'cancelled', 'reversed')
GROUP BY
  a.process_id,
  a.cost_centre_id,
  a.branch_id,
  a.recognition_period,
  COALESCE(
    a.pnl_bucket,
    CASE WHEN a.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END
  );

SELECT '418_grn_allocation_pnl_attribution.sql applied' AS migration_status;
