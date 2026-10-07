-- 2120_process_pnl_branch_head_view.sql
--
-- Branch Heads can open the P&L Command Center (FINANCE_PROCESS_PNL), view only.
--
-- Owner requirement 2026-10-06: a Branch Head forecasts each cost centre's revenue and must see
-- what the P&L does with it. The route (finance.routes.tsx pnlOperationalRoles), the nav entry and
-- every /pnl API (PNL_READ_ROLES) already admit branch_head; only this page grant was missing, so
-- the page answered "Access Denied". Every endpoint the page calls is branch-scoped for
-- branch_head (audited 2026-10-06; the company-wide leaks found then — allocation-summary cache
-- key, CEO focus/options/exceptions, Live P&L below-the-line — are fixed in the same change).
-- The Cost Leakage tab stays finance-only (API 403, tab hidden). Idempotent upsert.

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'branch_head', 'FINANCE_PROCESS_PNL', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = 1, can_create = 0, can_edit = 0, can_delete = 0, can_export = 1, active_status = 1;
