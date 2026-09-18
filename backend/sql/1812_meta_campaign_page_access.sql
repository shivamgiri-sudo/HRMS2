-- Migration 1812: register the META Campaign dashboard page and grant access.
--
-- Without this the page is unreachable for everyone except super_admin, and not because of a bug:
-- the route is wrapped in WorkforcePageGate, and ProtectedRoute independently resolves a page code
-- from the URL. Both call useWorkforceAccess().canViewPage(), which is a membership test against
-- role_page_access rows. super_admin short-circuits; every other role with no row here sees the
-- "Access not available" panel. The sidebar entry is hidden by the same check.
--
-- page_path MUST match the real route exactly (/ats/meta-campaigns). A drifting path is a
-- documented live failure in this codebase — see 1022_page_catalog_path_reconciliation.sql, where
-- launchers 404'd because the catalog path and the router disagreed.
--
-- Uses the newer page_catalog / role_page_access pair, not the older
-- workforce_page_catalog / workforce_role_page_permissions naming. Both upserts are re-runnable:
-- page_catalog.page_code is UNIQUE and role_page_access has uq_role_page (role_key, page_code).
--
-- Grant shape mirrors the campaign router's own role lists in meta-campaign.routes.ts, so the UI
-- and the API agree — a role that can see the page can call the endpoints behind it:
--   can_view  -> CAMPAIGN_READ_ROLES
--   can_edit  -> CAMPAIGN_WRITE_ROLES (linking a Lead Gen Form ID wrongly misroutes candidates
--                into the wrong requisition, so writes stay with HR)

USE mas_hrms;

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
VALUES (UUID(), 'ATS_META_CAMPAIGNS', 'META Campaign Automation', '/ats/meta-campaigns', 'Recruitment',
        'META Lead Gen campaign performance, lead screening results and the impressions-to-onboarded funnel per requisition', 1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = 1;

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',       'ATS_META_CAMPAIGNS', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',             'ATS_META_CAMPAIGNS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'hr',                'ATS_META_CAMPAIGNS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'recruitment_hr',    'ATS_META_CAMPAIGNS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'management',        'ATS_META_CAMPAIGNS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_head',       'ATS_META_CAMPAIGNS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'operations_manager','ATS_META_CAMPAIGNS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager',   'ATS_META_CAMPAIGNS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'manager',           'ATS_META_CAMPAIGNS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'assistant_manager', 'ATS_META_CAMPAIGNS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'recruiter',         'ATS_META_CAMPAIGNS', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_export    = VALUES(can_export),
  active_status = 1;

SELECT 'Migration 1812 applied: ATS_META_CAMPAIGNS page registered and granted to 11 roles' AS status;
