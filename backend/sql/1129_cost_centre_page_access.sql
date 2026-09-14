-- 1129_cost_centre_page_access.sql
-- Makes the Cost Centre Management page reachable by anyone other than super_admin.
--
-- WHY THIS MIGRATION EXISTS AT ALL
-- FINANCE_COST_CENTRES is the incident this repository already cites as its cautionary example:
-- 1066_billability_page_access.sql and 1104_salary_voucher_page_access.sql both name it in their
-- headers as "shipped with a route and no catalog row and was invisible to everyone but
-- super_admin". It was cited twice and never actually fixed. Everything else is in place —
-- the <Route> and <Gate pageCode>, the page component, a navConfig entry, and 14 working API
-- endpoints in cost-centre-management.routes.ts — but with no page_catalog row and no
-- role_page_access grant, WorkforcePageGate denies every non-super_admin caller.
--
-- Five things have to agree for a page to be usable:
--   1. the <Route> + <Gate pageCode>            finance.routes.tsx:57
--   2. a page_catalog row whose page_path       <- this file
--      matches the route EXACTLY
--   3. role_page_access grants                  <- this file
--   4. a navConfig entry                        navConfig.tsx (already present)
--   5. PAGE_CODE_BY_ROUTE                       pageRoutePageCodes.ts (added alongside this file)
--
-- WHO GETS IT, AND WHY
-- The grants mirror CC_READ_ROLES in cost-centre-management.routes.ts and costCentreRoles in
-- finance.routes.tsx, which are already identical to each other — granting a wider set here
-- would hand somebody a page whose every API call then 403s, which is the failure mode the
-- Phase 1 audit found on six other screens.
--
-- The write flags follow the API's own split rather than the read list: CC_CREATE_ROLES is
-- narrower than CC_READ_ROLES, so finance, branch_head and branch_admin get can_view only.
-- A cost centre carries the approval chain that budgets and GRNs attribute spend through, so
-- can_delete is off for everyone — the service supersedes rather than deletes.
--
-- Additive and idempotent. NOT executed by this change; it runs on the next deploy's migration
-- pass, and a pm2 restart applies it.

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_COST_CENTRES', 'Cost Centres', '/finance/cost-centres', 'finance',
   'Cost centre master with the draft -> pending L1 -> pending L2 -> approved maker-checker chain that budgets, GRNs and P&L attribution all resolve spend through.',
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
  -- CC_CREATE_ROLES / CC_L1_APPROVAL_ROLES: may raise and approve.
  (UUID(), 'super_admin',   'FINANCE_COST_CENTRES', 1, 1, 1, 0, 1, 1),
  (UUID(), 'admin',         'FINANCE_COST_CENTRES', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head',  'FINANCE_COST_CENTRES', 1, 1, 1, 0, 1, 1),
  (UUID(), 'accounts_head', 'FINANCE_COST_CENTRES', 1, 1, 1, 0, 1, 1),
  -- CC_READ_ROLES only: these three reach the page and the list API, and nothing else.
  (UUID(), 'finance',       'FINANCE_COST_CENTRES', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_head',   'FINANCE_COST_CENTRES', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_admin',  'FINANCE_COST_CENTRES', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1129_cost_centre_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_COST_CENTRES';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_COST_CENTRES';
