-- 061_admin_setup.sql
-- Make shivam.giri@teammas.in a full Admin user for legacy sync work

USE mas_hrms;

START TRANSACTION;

-- Create/update user with password hash
INSERT INTO auth_user (id, email, password_hash, is_blocked)
VALUES (UUID(), 'shivam.giri@teammas.in', '$2b$10$SK.d3NGeBRt2WV5PbDxd/.8Z7kC82/mxGiyXggY8rvOew9pCSpONS', 0)
ON DUPLICATE KEY UPDATE 
  is_blocked = 0,
  updated_at = CURRENT_TIMESTAMP;

-- Get user ID
SET @user_id = (SELECT id FROM auth_user WHERE LOWER(email) = LOWER('shivam.giri@teammas.in'));

-- Assign admin role (idempotent)
INSERT INTO user_roles (id, user_id, role_key, active_status)
VALUES (UUID(), @user_id, 'admin', 1)
ON DUPLICATE KEY UPDATE 
  active_status = 1,
  created_at = created_at;

-- Add page access for migration console
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES ('admin', 'MIGRATION_CONSOLE', 1, 1, 1, 1, 1)
ON DUPLICATE KEY UPDATE can_view=1, can_create=1, can_edit=1, can_delete=1, can_export=1;

-- Verify
SELECT 
  au.id,
  au.email,
  au.is_blocked,
  ur.role_key,
  ur.active_status
FROM auth_user au
LEFT JOIN user_roles ur ON ur.user_id = au.id
WHERE LOWER(au.email) = LOWER('shivam.giri@teammas.in');

COMMIT;

SELECT 'Admin setup complete for shivam.giri@teammas.in' AS status;
SELECT 'Password: Admin@MAS2026' AS credentials;
