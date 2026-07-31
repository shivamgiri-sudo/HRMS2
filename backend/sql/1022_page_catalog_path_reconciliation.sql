-- 1022_page_catalog_path_reconciliation.sql
--
-- Repairs page_catalog rows whose page_path points at a route that does not exist.
-- ModuleLauncher navigates users straight to page_catalog.page_path
-- (src/pages/ModuleLauncher.tsx), so a wrong path here is a hard 404 for every
-- role holding the grant — not a cosmetic issue.
--
-- Found by the CEO UAT of 31-Jul-2026 and verified against the live catalog.
--
-- 1. WORKFORCE_COMMAND_CENTER — path regression, affects EIGHT roles
--    sql/170_access_improvements.sql seeded the correct '/performance/command-center'.
--    sql/216_missing_page_catalog_entries.sql then overwrote it with
--    '/workforce/command-center' via ON DUPLICATE KEY UPDATE page_path = VALUES(page_path).
--    That path has never been mounted. The real route is
--      src/config/routes/performance.routes.tsx -> /performance/command-center
--    and the sidebar already links there correctly (navConfig.tsx), so only the
--    launcher path is wrong. Live grants: admin, branch_wfm, ceo, manager,
--    operations_manager, process_manager, super_admin, wfm — all eight get a 404 today.
--    No other page_code claims '/performance/command-center', so this cannot collide.
--
-- 2. ADVANCED_REPORTS — retired page still advertised
--    '/advanced-reports' is a bare <Navigate to="/reports"> legacy stub in
--    config/routes/finance.routes.tsx. No report builder, cross-module query or
--    scheduled email delivery exists at that path. Deactivated rather than
--    repointed at /reports, because REPORTS_CENTER already covers /reports and two
--    codes for one page is what produced this drift. Live grants: admin, ceo,
--    super_admin — all three retain REPORTS_CENTER, so nobody loses reporting access.
--
-- KPI_DASHBOARD is deliberately NOT touched here: it is already active_status=0 in
-- the live catalog. Its 404 came from the code-side registry
-- (backend/src/shared/rbacPageMatrix.ts), which is fixed in the same change.
--
-- Additive and idempotent. Updates two rows. Creates nothing, drops nothing,
-- deletes nothing, and revokes no role's access to a working page.
--
-- NOT EXECUTED AUTOMATICALLY. Review, then run against the target schema.

-- 1. Point the workforce command centre at the route that actually exists.
UPDATE page_catalog
   SET page_path = '/performance/command-center'
 WHERE page_code = 'WORKFORCE_COMMAND_CENTER'
   AND page_path <> '/performance/command-center';

-- 2. Retire the advanced-reports stub.
UPDATE page_catalog
   SET active_status = 0
 WHERE page_code = 'ADVANCED_REPORTS'
   AND active_status <> 0;

-- Verification after running:
--   SELECT page_code, page_path, active_status
--     FROM page_catalog
--    WHERE page_code IN ('WORKFORCE_COMMAND_CENTER','ADVANCED_REPORTS','KPI_DASHBOARD');
--   -- expected:
--   --   WORKFORCE_COMMAND_CENTER  /performance/command-center  1
--   --   ADVANCED_REPORTS          /advanced-reports            0
--   --   KPI_DASHBOARD             /kpi/dashboard               0   (already inactive)
