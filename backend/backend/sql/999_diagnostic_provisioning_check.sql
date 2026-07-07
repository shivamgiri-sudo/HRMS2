-- ============================================================================
-- Diagnostic Script: IT Provisioning and Payroll HR Notification Status
-- ============================================================================
-- Purpose: Check if IT provisioning tasks and payroll HR notifications are
--          being created after employee code generation
-- Usage: Run this after approving an offer to verify the system is working
-- ============================================================================

-- Check if it_provisioning_request table exists and has data
SELECT
  'it_provisioning_request table check' AS check_name,
  COUNT(*) as total_requests,
  MAX(created_at) as last_request_date,
  COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as last_7_days
FROM it_provisioning_request;

-- Check recent provisioning requests for new employees
SELECT
  ipr.id,
  ipr.task_code,
  ipr.assigned_role,
  ipr.status,
  ipr.created_at,
  e.employee_code,
  e.full_name,
  e.join_date,
  DATEDIFF(NOW(), e.join_date) as days_since_join
FROM it_provisioning_request ipr
JOIN employees e ON e.id = ipr.employee_id
WHERE e.join_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
ORDER BY ipr.created_at DESC
LIMIT 20;

-- Verify role assignments for provisioning roles
SELECT
  sr.role_key,
  sr.role_name,
  COUNT(DISTINCT ur.user_id) as users_assigned,
  GROUP_CONCAT(DISTINCT au.email ORDER BY au.email SEPARATOR ', ') as user_emails
FROM system_role sr
LEFT JOIN user_roles ur ON ur.role_key = sr.role_key AND ur.active_status = 1
LEFT JOIN auth_user au ON au.id = ur.user_id
WHERE sr.role_key IN ('it', 'admin', 'wfm', 'payroll_hr', 'hr')
GROUP BY sr.role_key, sr.role_name
ORDER BY sr.role_key;

-- Check branch-scoped role assignments
SELECT
  uas.role_key,
  b.branch_name,
  COUNT(DISTINCT uas.manager_employee_id) as scoped_users,
  GROUP_CONCAT(DISTINCT e.employee_code ORDER BY e.employee_code SEPARATOR ', ') as employee_codes
FROM user_assignment_scope uas
JOIN branches b ON b.id = uas.branch_id
JOIN employees e ON e.id = uas.manager_employee_id
WHERE uas.role_key IN ('it', 'admin', 'wfm', 'payroll_hr', 'branch_it')
  AND uas.active_status = 1
GROUP BY uas.role_key, b.branch_name
ORDER BY uas.role_key, b.branch_name;

-- Check inbox items for IT/Admin/WFM/HR users
SELECT
  'inbox_item table check' AS check_name,
  COUNT(*) as total_inbox_items,
  COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as last_7_days,
  COUNT(CASE WHEN type = 'it_provisioning' THEN 1 END) as provisioning_items,
  COUNT(CASE WHEN is_read = 0 THEN 1 END) as unread_items
FROM inbox_item;

-- Recent inbox items for provisioning
SELECT
  ii.id,
  ii.type,
  ii.title,
  ii.created_at,
  ii.is_read,
  au.email as user_email,
  ur.role_key
FROM inbox_item ii
JOIN auth_user au ON au.id = ii.user_id
LEFT JOIN user_roles ur ON ur.user_id = au.id AND ur.active_status = 1
WHERE ii.type = 'it_provisioning'
  AND ii.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
ORDER BY ii.created_at DESC
LIMIT 20;

-- Check if SMTP is configured for email sending
SELECT
  'smtp_config check' AS check_name,
  COUNT(*) as smtp_configs,
  MAX(updated_at) as last_updated
FROM smtp_config
WHERE is_active = 1;

-- Check recent employees who should have provisioning tasks
SELECT
  e.id,
  e.employee_code,
  e.full_name,
  e.join_date,
  e.branch_id,
  b.branch_name,
  (SELECT COUNT(*)
   FROM it_provisioning_request ipr
   WHERE ipr.employee_id = e.id) as provisioning_tasks_count,
  CASE
    WHEN (SELECT COUNT(*) FROM it_provisioning_request ipr WHERE ipr.employee_id = e.id) = 0
    THEN '❌ MISSING TASKS'
    ELSE '✅ Has tasks'
  END as status
FROM employees e
LEFT JOIN branches b ON b.id = e.branch_id
WHERE e.join_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  AND e.employee_code IS NOT NULL
ORDER BY e.join_date DESC
LIMIT 20;

-- Summary: Expected vs Actual provisioning tasks
SELECT
  'Expected 4 tasks per new employee (WFM, IT, Admin, HR)' as note,
  COUNT(DISTINCT e.id) as new_employees_last_30_days,
  COUNT(DISTINCT e.id) * 4 as expected_tasks,
  COUNT(ipr.id) as actual_tasks,
  (COUNT(DISTINCT e.id) * 4) - COUNT(ipr.id) as missing_tasks
FROM employees e
LEFT JOIN it_provisioning_request ipr ON ipr.employee_id = e.id
WHERE e.join_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  AND e.employee_code IS NOT NULL;
