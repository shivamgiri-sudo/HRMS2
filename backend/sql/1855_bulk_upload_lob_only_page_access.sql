-- 1855_bulk_upload_lob_only_page_access.sql
-- Lets the Process LOB Mapping roles (branch_wfm, ho_wfm, wfm_spoc) open the Bulk Upload Hub
-- page (BULK_UPLOAD, /bulk-upload). They may use ONE upload type only, Employee LOB Mapping;
-- that restriction is enforced by the API (backend/src/modules/bulk-upload/bulk-role-restriction.ts),
-- not by this grant: the hub lists templates from GET /templates, which is filtered to
-- EMPLOYEE_LOB_MAPPING for these roles, and every batch route refuses any other upload type
-- or another user's batch.
-- Roles absent from workforce_role_catalog are skipped (INSERT ... SELECT from the catalog)
-- rather than failing on the role FK. The BULK_UPLOAD page_catalog row already exists (538/1029).
-- Idempotent: ON DUPLICATE KEY UPDATE. Mirrors 1848 / 1851. Existing BULK_UPLOAD grants for
-- other roles are not touched.
-- Rollback: UPDATE role_page_access SET active_status = 0
--            WHERE page_code = 'BULK_UPLOAD' AND role_key IN ('branch_wfm', 'ho_wfm', 'wfm_spoc');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT c.role_key, 'BULK_UPLOAD', 1, 1, 1, 0, 1, 1
  FROM workforce_role_catalog c
 WHERE c.role_key IN ('branch_wfm', 'ho_wfm', 'wfm_spoc')
ON DUPLICATE KEY UPDATE
  can_view = 1, can_create = 1, can_edit = 1, can_export = 1, active_status = 1;
