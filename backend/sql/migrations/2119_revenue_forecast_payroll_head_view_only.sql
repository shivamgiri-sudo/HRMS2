-- 2119_revenue_forecast_payroll_head_view_only.sql
--
-- Owner ruling 2026-10-06: the Payroll Head has VISIBILITY of revenue forecasts only — no approval
-- gate. Only the Finance Head approves (revenue-forecast.service.ts). Migration 2118 granted
-- payroll_head can_edit on FINANCE_REVENUE_FORECAST for the approval it no longer gives; this makes
-- the grant view + export only and corrects the page description. Idempotent UPDATEs.

UPDATE role_page_access
   SET can_create = 0, can_edit = 0, can_delete = 0, can_view = 1, can_export = 1, active_status = 1
 WHERE role_key = 'payroll_head' AND page_code = 'FINANCE_REVENUE_FORECAST';

UPDATE page_catalog
   SET description = 'Branch Head monthly revenue forecast per cost centre (seat, metric, fixed, reward, penalty lines), approved by the Finance Head (Payroll Head has view access), closed with actuals; the P&L counts the open forecast until it is closed.'
 WHERE page_code = 'FINANCE_REVENUE_FORECAST';
