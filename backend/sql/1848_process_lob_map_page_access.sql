-- 1848_process_lob_map_page_access.sql
-- Registers the "Process LOB Mapping" page (/wfm/process-lob-mapping) and grants it to the
-- WFM roles plus admin/hr/super_admin. Roles absent from workforce_role_catalog are skipped
-- (INSERT ... SELECT from the catalog) rather than failing on the role FK.
-- Idempotent: ON DUPLICATE KEY UPDATE on both tables.

INSERT INTO page_catalog (page_code, page_name, module, page_path, description, active_status) VALUES
('WFM_PROCESS_LOB_MAP', 'Process LOB Mapping', 'WFM', '/wfm/process-lob-mapping',
 'Map each process to the LOBs it runs; assign employee LOBs from that list', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description),
  active_status = 1;

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT c.role_key, 'WFM_PROCESS_LOB_MAP', 1, 1, 1, 0, 1, 1
  FROM workforce_role_catalog c
 WHERE c.role_key IN ('wfm', 'wfm_spoc', 'branch_wfm', 'ho_wfm', 'admin', 'hr', 'super_admin')
ON DUPLICATE KEY UPDATE
  can_view = 1, can_create = 1, can_edit = 1, can_export = 1, active_status = 1;
