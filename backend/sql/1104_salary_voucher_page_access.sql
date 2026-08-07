-- 1104_salary_voucher_page_access.sql
-- Makes the Salary Voucher page reachable.
--
-- WHY THIS MIGRATION EXISTS AT ALL
-- A <Route> alone does not make a page usable in this application. FINANCE_COST_CENTRES shipped
-- with a route and no catalog row and was invisible to everyone but super_admin — its own
-- migration header (1066) records the incident. Five things have to agree:
--
--   1. the <Route> + <Gate pageCode>            finance.routes.tsx
--   2. a page_catalog row whose page_path       <- this file
--      matches the route EXACTLY
--   3. role_page_access grants                  <- this file
--   4. a navConfig entry                        navConfig.tsx
--   5. PAGE_CODE_BY_ROUTE                       pageRoutePageCodes.ts
--
-- Steps 3 and 4 must list the SAME roles as the route's `roles` array, or the page either 403s
-- for someone who was granted it or shows for someone the API will refuse.
--
-- WHO GETS IT, AND WHY IT IS NARROW
-- A salary voucher renders an entire branch's payroll in one view, including which individuals
-- had advances recovered. The grants therefore match the API's VOUCHER_ROLES exactly —
-- finance_head, payroll_hr, super_admin — and deliberately NOT the broader finance/branch_admin
-- set that can see GRNs. can_export is on because the page's whole purpose is producing the
-- Tally import file; every other write flag is off, since the endpoint is read-only and there
-- is nothing on the page to create or edit.
--
-- Additive and idempotent.

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_SALARY_VOUCHER', 'Salary Voucher', '/finance/salary-voucher', 'finance',
   'The Tally journal a payroll run will post: one voucher per company and branch, showing every ledger line, whether it balances, and which employees are not on it.',
   1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',  'FINANCE_SALARY_VOUCHER', 1, 0, 0, 0, 1, 1),
  (UUID(), 'finance_head', 'FINANCE_SALARY_VOUCHER', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_hr',   'FINANCE_SALARY_VOUCHER', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1104_salary_voucher_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_SALARY_VOUCHER';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_SALARY_VOUCHER';
