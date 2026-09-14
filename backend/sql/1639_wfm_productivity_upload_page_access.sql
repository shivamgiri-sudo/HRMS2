-- 1639 — page_catalog + role_page_access for WFM_PRODUCTIVITY_UPLOAD (requirements.md
-- criterion 14.7: the Upload_Batch submission screen is one of the six page codes this feature
-- requires as a separately grantable permission; criterion 14.8 restricts submitting an
-- Upload_Batch to the WFM_Uploader grant).
--
-- NOT YET EXECUTED. Purely additive: one page_catalog row, a set of role_page_access grants.
-- Needs owner approval before it runs (CLAUDE.md).
--
-- WHY page_path IS '/bulk-upload' AND NOT '/wfm/productivity-upload'
-- WFM_PRODUCTIVITY_UPLOAD is a SECTION-LEVEL grant inside an existing page, not a page of its
-- own. The upload UI is a third tab on the existing /bulk-upload page (src/pages/BulkUploadHub.tsx)
-- — no /wfm/productivity-upload route exists in the frontend router and none is being added, so
-- registering that path here would put a dead link in page_catalog for any nav entry, access
-- screen or deep link that reads page_path back: a guaranteed 404. page_path must name a route a
-- browser can actually reach, which is /bulk-upload.
--
-- page_code stays 'WFM_PRODUCTIVITY_UPLOAD' precisely because it is NOT the page's identity: it
-- is the separately grantable permission the new tab is gated on, so a role can hold /bulk-upload
-- (roster import) without holding productivity upload, and vice versa. Two page_catalog rows may
-- therefore share page_path '/bulk-upload' — page_code is the unique key, not page_path.
--
-- Per the five-things-must-agree convention (backend/sql/1129_cost_centre_page_access.sql):
-- this migration is the page_catalog + role_page_access half. The route + Gate pageCode and the
-- PAGE_CODE_BY_ROUTE entry land in Task 4 of this plan. No navConfig.tsx entry is added, and none
-- is needed: /bulk-upload is already in the nav, and the tab is reached from there.
--
-- Grants mirror the existing attendance-apr-bulk.routes.ts's requireRole list
-- (wfm, hr, payroll_head, super_admin, admin) plus branch_head, since criterion 17's
-- WFM_Uploader is explicitly a branch-scoped role and branch_head is this codebase's existing
-- branch-scoped operational role.
--
-- wfm_analyst is granted too, and is NOT an extra role this migration invents: requireRole()
-- expands ROLE_ALIASES (platform/policy/roles.ts), which maps wfm <-> wfm_analyst both ways, so
-- a wfm_analyst already passes the route's requireRole('wfm', ...) gate and can POST /commit.
-- Omitting it here would leave that role showing as ungranted on the access-control screen while
-- being fully able to write attendance-feeding rows -- precisely the disagreement the
-- five-things-must-agree convention exists to prevent. Keep this list and the route's
-- UPLOAD_ROLES (plus their aliases) identical. wfm_analyst has no workforce_role_catalog row of
-- its own (003_access_control.sql seeds 'wfm' under the display name "WFM Analyst"), and
-- role_page_access.role_key carries no foreign key, so this grant is additive and defensive: it
-- costs one row and closes the gap for any user actually holding that role_key.
--
-- ROLLBACK
-- Keyed on page_code, never on page_path: page_path '/bulk-upload' is shared with the page_catalog
-- row for the existing roster-import page, and a rollback matched on the path would deactivate
-- that page for everyone. page_code touches only this grant.
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'WFM_PRODUCTIVITY_UPLOAD';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'WFM_PRODUCTIVITY_UPLOAD';

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'WFM_PRODUCTIVITY_UPLOAD',
  'WFM Productivity Upload',
  '/bulk-upload',
  'WFM',
  'Branch WFM manual dialler productivity report upload (requirements.md Requirement 17)',
  1
)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), r.role_key, 'WFM_PRODUCTIVITY_UPLOAD', 1, 1, 0, 0, 0, 1, NOW()
  FROM (
    SELECT 'wfm'          AS role_key UNION ALL
    SELECT 'wfm_analyst'              UNION ALL
    SELECT 'branch_head'              UNION ALL
    SELECT 'hr'                       UNION ALL
    SELECT 'payroll_head'             UNION ALL
    SELECT 'admin'                    UNION ALL
    SELECT 'super_admin'
  ) r
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access existing
    WHERE existing.role_key  = r.role_key
      AND existing.page_code = 'WFM_PRODUCTIVITY_UPLOAD'
 );

UPDATE role_page_access
   SET can_view = 1, can_create = 1, active_status = 1
 WHERE page_code = 'WFM_PRODUCTIVITY_UPLOAD'
   AND role_key IN ('wfm','wfm_analyst','branch_head','hr','payroll_head','admin','super_admin');

SELECT '1639 applied: WFM_PRODUCTIVITY_UPLOAD page catalog + role_page_access' AS migration_status;
