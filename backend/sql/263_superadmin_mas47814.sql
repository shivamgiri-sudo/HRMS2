-- 263_superadmin_mas47814.sql
-- Grant super_admin role to shivam.giri@teammas.in (mas47814)
-- Gives full access to all pages and bypasses role checks

USE mas_hrms;

START TRANSACTION;

-- Ensure user exists (idempotent — does not change password if already exists)
INSERT INTO auth_user (id, email, password_hash, is_blocked)
VALUES (UUID(), 'shivam.giri@teammas.in', '$2b$10$SK.d3NGeBRt2WV5PbDxd/.8Z7kC82/mxGiyXggY8rvOew9pCSpONS', 0)
ON DUPLICATE KEY UPDATE is_blocked = 0, updated_at = CURRENT_TIMESTAMP;

SET @user_id = (SELECT id FROM auth_user WHERE LOWER(email) = LOWER('shivam.giri@teammas.in') LIMIT 1);

-- Grant super_admin (bypasses all requireRole checks in the backend)
INSERT INTO user_roles (id, user_id, role_key, active_status)
VALUES (UUID(), @user_id, 'super_admin', 1)
ON DUPLICATE KEY UPDATE active_status = 1;

-- Ensure admin role also active (belt-and-suspenders)
INSERT INTO user_roles (id, user_id, role_key, active_status)
VALUES (UUID(), @user_id, 'admin', 1)
ON DUPLICATE KEY UPDATE active_status = 1;

-- Grant all page access for super_admin (covers any pages with page-level gate)
INSERT IGNORE INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
SELECT 'super_admin', page_code, 1, 1, 1, 1, 1
FROM (
  SELECT DISTINCT page_code FROM role_page_access
) existing_pages;

COMMIT;

-- Verify
SELECT au.id, au.email, ur.role_key, ur.active_status
FROM auth_user au
JOIN user_roles ur ON ur.user_id = au.id
WHERE LOWER(au.email) = LOWER('shivam.giri@teammas.in')
ORDER BY ur.role_key;

SELECT 'super_admin granted to shivam.giri@teammas.in (mas47814)' AS status;
