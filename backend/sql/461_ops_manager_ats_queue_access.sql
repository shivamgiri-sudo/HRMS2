-- Ops Manager: read-only access to ATS Walk-in Queue page for Ops Round visibility
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES ('operations_manager', 'ATS_WALKIN_QUEUE', 1, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE can_view = 1, can_create = 0, can_edit = 0, can_delete = 0;
