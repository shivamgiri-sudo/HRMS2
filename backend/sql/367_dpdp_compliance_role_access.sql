-- Migration 367: Grant DPDP_COMPLIANCE page access to admin and hr roles
-- DPDP_COMPLIANCE was added to page_catalog in migration 170 but had no role grants.
-- Safe to re-run: INSERT IGNORE
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_edit, can_create, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin', 'DPDP_COMPLIANCE', 1, 1, 1, 1, 1, 1, NOW()),
  (UUID(), 'admin',       'DPDP_COMPLIANCE', 1, 1, 1, 0, 1, 1, NOW()),
  (UUID(), 'hr',          'DPDP_COMPLIANCE', 1, 0, 0, 0, 0, 1, NOW());
