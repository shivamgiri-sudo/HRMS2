-- 20260630_coo_role.sql
-- Adds COO (Chief Operating Officer) role to HRMS.
-- COO has identical data access to CEO: global read across all processes/branches.
-- Additive migration — safe to apply on live schema.

-- 1. Insert role definition
INSERT IGNORE INTO roles (role_key, role_name, description, is_system_role, created_at)
VALUES ('coo', 'COO', 'Chief Operating Officer — org-wide read access to all process/branch data', 1, NOW());

-- 2. Copy all page access grants from CEO role to COO
INSERT IGNORE INTO role_page_access (role_key, page_code, can_view, can_edit, can_export, created_at)
SELECT 'coo', page_code, can_view, can_edit, can_export, NOW()
FROM role_page_access
WHERE role_key = 'ceo';

-- 3. Copy dashboard access grants from CEO to COO
INSERT IGNORE INTO role_dashboard_access (role_key, dashboard_code, can_view, can_export, created_at)
SELECT 'coo', dashboard_code, can_view, can_export, NOW()
FROM role_dashboard_access
WHERE role_key = 'ceo';

-- 4. Verify: SELECT role_key, role_name FROM roles WHERE role_key IN ('ceo','coo','super_admin');
