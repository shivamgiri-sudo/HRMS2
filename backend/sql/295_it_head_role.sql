-- 295_it_head_role.sql
-- Seed IT Head role with governance visibility over IT provisioning tracker
-- Additive only — uses ON DUPLICATE KEY / INSERT IGNORE

INSERT INTO workforce_role_catalog (role_key, role_name, active_status)
VALUES ('it_head', 'IT Head', 1)
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name), active_status = 1;

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES ('it_head', 'IT_PROVISIONING_TRACKER', 1, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_export = VALUES(can_export);

SELECT '295_it_head_role.sql applied successfully' AS migration_status;
