-- 1549_manager_wfm_quality_dashboard_access.sql
-- Grants the plain 'manager' role view access to WFM Dashboard and Quality Dashboard, matching
-- the allowedRoleKeys change in backend/src/shared/dashboardAccessRegistry.ts (both gates must
-- agree — dashboard.routes.ts:65 checks the registry, WorkforcePageGate checks this table).
--
-- WFM_DASHBOARD: no grant row existed for 'manager' at all. Not deliberate scoping — managers
-- already hold the equivalently-shaped OPERATIONS_DASHBOARD grant; this brings WFM into parity.
--
-- QUALITY_DASHBOARD: a grant row already existed (active_status = 0) — a leftover from the
-- 2026-07-25 RBAC cleanup sweep (see role_page_access_backup_20260725_rbac_cleanup), not a
-- deliberate lock-out. The ON DUPLICATE KEY UPDATE below reactivates it rather than duplicating.
--
-- View-only, same as every other role on these two dashboards.

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'manager', 'WFM_DASHBOARD',     1, 0, 0, 0, 0, 1),
  (UUID(), 'manager', 'QUALITY_DASHBOARD', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  active_status = VALUES(active_status);

SELECT '1549_manager_wfm_quality_dashboard_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE role_key = 'manager' AND page_code IN ('WFM_DASHBOARD', 'QUALITY_DASHBOARD');
