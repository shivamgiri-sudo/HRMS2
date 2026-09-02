-- 1652_gst_tally_export_page_access.sql
-- Makes the new GST/Tally Export page reachable.
--
-- WHY THIS MIGRATION EXISTS AT ALL (same warning 1104's own header carries, repeated because it
-- is still true): a <Route> alone does not make a page usable. FINANCE_COST_CENTRES shipped with
-- a route and no catalog row and was invisible to everyone but super_admin. Five things have to
-- agree:
--   1. the <Route> + <Gate pageCode>            finance.routes.tsx
--   2. a page_catalog row whose page_path       <- this file
--      matches the route EXACTLY
--   3. role_page_access grants                  <- this file
--   4. a navConfig entry                        navConfig.tsx
--   5. PAGE_CODE_BY_ROUTE                       pageRoutePageCodes.ts
--
-- WHO GETS IT
-- Grants mirror gst-export.routes.ts's own role lists exactly, split the same way the API
-- already splits them:
--   GST_WRITE_ROLES (accounts_head, finance_head, super_admin) — can generate a batch and mark
--   it downloaded, so can_create/can_export are on.
--   GST_READ_ROLES adds admin, finance, branch_admin — view-only, matching the API's own 403 on
--   POST /exports for these roles. Never grant a role here the route array does not also grant —
--   that mismatch either 403s someone the page shows to, or shows the page to someone the API
--   silently refuses, which is the exact two-way-drift class of bug 1104's own header warns
--   about for VOUCHER_ROLES.
--
-- Additive and idempotent.

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_GST_EXPORT', 'GST / Tally Export', '/finance/gst-export', 'finance',
   'Generate the GSTR-1 / GSTR-3B / Tally sales export for a registration and month, review the exception worklist, and download the CSV hand-off file.',
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
  (UUID(), 'super_admin',  'FINANCE_GST_EXPORT', 1, 1, 0, 0, 1, 1),
  (UUID(), 'finance_head', 'FINANCE_GST_EXPORT', 1, 1, 0, 0, 1, 1),
  (UUID(), 'accounts_head','FINANCE_GST_EXPORT', 1, 1, 0, 0, 1, 1),
  (UUID(), 'admin',        'FINANCE_GST_EXPORT', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance',      'FINANCE_GST_EXPORT', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_admin', 'FINANCE_GST_EXPORT', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1652_gst_tally_export_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_GST_EXPORT';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_GST_EXPORT';
