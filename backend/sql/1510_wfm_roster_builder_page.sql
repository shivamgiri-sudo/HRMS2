-- 1510_wfm_roster_builder_page.sql
-- Registers the new WFM Roster Builder page (tabular grid + bulk upload,
-- WFM-team-only) in the page catalog and grants it to wfm/admin/super_admin.

USE mas_hrms;

INSERT IGNORE INTO page_catalog (page_code, page_name, module, page_path, description) VALUES
('WFM_ROSTER_BUILDER', 'Roster Builder', 'WFM', '/wfm/roster-builder',
 'Build a process''s weekly roster in a filtered tabular grid or via bulk upload, then publish it for employee acknowledgement');

INSERT IGNORE INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
('wfm',         'WFM_ROSTER_BUILDER', 1, 1, 1, 0, 1),
('admin',       'WFM_ROSTER_BUILDER', 1, 1, 1, 1, 1),
('super_admin', 'WFM_ROSTER_BUILDER', 1, 1, 1, 1, 1);

SELECT '1510_wfm_roster_builder_page.sql applied successfully' AS migration_status;
