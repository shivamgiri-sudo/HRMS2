-- 1852_pnl_grn_allocation_view_ex_gst.sql
--
-- OWNER RULE, 2026-09-24: on the Process P&L, "Revenue and GRN — all components — must be
-- NON-GST amounts". vw_process_pnl_grn_allocation (sql/418) only exposes pnl_cost_amount
-- (base + NON-recoverable GST) and gross_amount (full GST), so the BPO P&L allocation overlay
-- had no ex-GST figure to read.
--
-- Additive only: the view is re-created with EXACTLY the sql/418 body and one extra column,
-- ex_gst_amount, appended LAST so every existing column keeps its name, meaning and position.
-- pnl_cost_amount and gross_amount are unchanged for any other reader.
--
-- ex_gst_amount = grn_cost_allocation.amount_without_tax (the taxable value). That column was
-- created NOT NULL DEFAULT 0 (sql/416), so a row whose ex-GST value was never recorded falls back
-- to amount_with_tax - tax_amount — the same guard as backend/src/modules/process-pnl/pnl-ex-gst.ts
-- — instead of silently reading as zero.
--
-- Idempotent: CREATE OR REPLACE VIEW. Rollback: re-run the CREATE OR REPLACE VIEW from sql/418.

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
  MAX(COALESCE(a.consumed_at, a.updated_at, a.created_at)) AS freshness,
  SUM(COALESCE(NULLIF(a.amount_without_tax, 0), COALESCE(a.amount_with_tax, 0) - COALESCE(a.tax_amount, 0), 0)) AS ex_gst_amount
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

SELECT '1852_pnl_grn_allocation_view_ex_gst.sql applied' AS migration_status;
