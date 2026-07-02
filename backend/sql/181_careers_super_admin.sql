-- Grants durable super-administrator authority to careers@teammas.in.
-- Account creation is intentionally performed by secure provisioning so no
-- reusable password hash or plaintext credential is stored in source control.
USE mas_hrms;

INSERT INTO workforce_role_catalog (role_key, role_name, description, active_status)
VALUES ('super_admin', 'Super Administrator', 'Unrestricted system administration access', 1)
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  description = VALUES(description),
  active_status = 1;

INSERT INTO role_page_access
  (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT
  'super_admin', pc.page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog pc
WHERE pc.active_status = 1
ON DUPLICATE KEY UPDATE
  can_view = 1,
  can_create = 1,
  can_edit = 1,
  can_delete = 1,
  can_export = 1,
  active_status = 1;

INSERT INTO user_roles (id, user_id, role_key, active_status)
SELECT UUID(), au.id, 'super_admin', 1
FROM auth_user au
WHERE LOWER(au.email) = LOWER('careers@teammas.in')
LIMIT 1
ON DUPLICATE KEY UPDATE active_status = 1;
