-- Migration: 1030_configuration_center_page_catalog.sql
-- Purpose:  Register CONFIGURATION_CENTER page code in page_catalog and grant
--           view access to super_admin and admin roles.
-- Safety:   INSERT IGNORE / ON DUPLICATE KEY UPDATE only. No DROP, no DELETE.
--           NOT EXECUTED AUTOMATICALLY — run manually on staging first.
-- Created:  2026-07-31

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'CONFIGURATION_CENTER', 'Configuration Control Center', '/admin/configuration', 'Admin', 1);

-- Grant full access to super_admin
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'super_admin', 'CONFIGURATION_CENTER', 1, 1, 1, 1, 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access
  WHERE role_key = 'super_admin' AND page_code = 'CONFIGURATION_CENTER'
)
ON DUPLICATE KEY UPDATE
  can_view = 1, can_create = 1, can_edit = 1, can_delete = 1, can_export = 1, active_status = 1;

-- Grant view-only access to admin
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'admin', 'CONFIGURATION_CENTER', 1, 0, 0, 0, 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access
  WHERE role_key = 'admin' AND page_code = 'CONFIGURATION_CENTER'
)
ON DUPLICATE KEY UPDATE
  can_view = 1, can_export = 1, active_status = 1;

-- Verification:
-- SELECT * FROM page_catalog WHERE page_code = 'CONFIGURATION_CENTER';
-- SELECT * FROM role_page_access WHERE page_code = 'CONFIGURATION_CENTER';
