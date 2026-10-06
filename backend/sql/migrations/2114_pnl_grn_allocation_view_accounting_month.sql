-- 2114: vw_process_pnl_grn_allocation dates every consumed GRN allocation by its ACCOUNTING month.
--
-- Owner rule 2026-10-06: "GRN we should see the accounting month, not the raised month". The view (sql/418,
-- re-created in sql/1852) used the allocation's recognition_period, else the GRN's bill date. HRMS-raised
-- allocations carry no recognition_period, so they were dated by bill date: live Oct 2026, 214 consumed
-- allocations (21 lakh ex-GST) sat in a month other than grn_request.accounting_period.
--
-- Now: grn_request.accounting_period first, a multi-month GRN keeps its per-month allocation recognition_period
-- (the period split). Same rule as backend/src/modules/process-pnl/pnl-grn-month.ts.
--
-- Body is exactly sql/1852's (every column, name and position unchanged) with only the period_code expression
-- (SELECT and GROUP BY) replaced. Idempotent: CREATE OR REPLACE VIEW. Rollback: re-run sql/1852.

CREATE OR REPLACE VIEW vw_process_pnl_grn_allocation AS
SELECT
  a.process_id,
  a.cost_centre_id,
  a.branch_id,
  (CASE WHEN COALESCE(g.is_multi_month, 0) = 1
        THEN COALESCE(a.recognition_period, g.accounting_period,
               DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at), '%Y-%m'))
        ELSE COALESCE(g.accounting_period, a.recognition_period,
               DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at), '%Y-%m'))
   END) AS period_code,
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
  (CASE WHEN COALESCE(g.is_multi_month, 0) = 1
        THEN COALESCE(a.recognition_period, g.accounting_period,
               DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at), '%Y-%m'))
        ELSE COALESCE(g.accounting_period, a.recognition_period,
               DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at), '%Y-%m'))
   END),
  COALESCE(
    a.pnl_bucket,
    sh.pnl_bucket,
    CASE WHEN a.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END
  );

SELECT '2114_pnl_grn_allocation_view_accounting_month.sql applied' AS migration_status;
