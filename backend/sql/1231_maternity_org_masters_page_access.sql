-- 1231_maternity_org_masters_page_access.sql
-- Continuation of 1230's RBAC sweep: a full page_catalog scan (not limited to routes with a
-- roles={} prop) found 46 more super_admin-only pages. Most have zero live <Gate pageCode=>
-- reference in any route file today (likely stale/orphaned catalog rows from renamed
-- pageCodes -- unconfirmed, needs a follow-up reference-check outside src/config/routes/
-- before acting on them). Of the ones that ARE live, two have strong, confirmed evidence of
-- being genuine under-grants -- the same pattern as 1230 -- and are fixed here:
--
-- MATERNITY_LEAVE (/maternity-leave): workforce.routes.tsx's own <Route> declares
--   roles={['super_admin','admin','hr']} directly -- DB only had super_admin.
-- ORG_MASTERS (/org-masters, /org-masters/locations-policies): no roles= on the route itself,
--   but navConfig.tsx lists admin|hr consistently across all three nav entries pointing at
--   this pageCode ("Organisation", "Org Masters", "Location & Policies") -- DB only had
--   super_admin.
--
-- View-only grant (can_view=1 only), consistent with 1230's conservative default -- write-
-- capability parity with each page's backend guard was not individually verified.
--
-- Additive and idempotent: INSERT ... ON DUPLICATE KEY UPDATE only, no DROP, no DELETE.

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'admin', 'MATERNITY_LEAVE', 1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',    'MATERNITY_LEAVE', 1, 0, 0, 0, 0, 1),
  (UUID(), 'admin', 'ORG_MASTERS',     1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',    'ORG_MASTERS',     1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = 1,
  active_status = 1;

SELECT '1231_maternity_org_masters_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0
--   WHERE page_code IN ('MATERNITY_LEAVE','ORG_MASTERS') AND role_key IN ('admin','hr');
