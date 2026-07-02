-- 103_user_assignment_scope_seed.sql
-- Seeds user_assignment_scope for managers, branch heads, and process managers
-- Idempotent: uses INSERT IGNORE to skip duplicates

USE mas_hrms;

-- ============================================================
-- SECTION 1: Team Scope for Managers/Team Leaders
-- ============================================================
-- For every employee who has at least one person reporting to them,
-- create a team scope entry so they can view their team members.
-- This applies to employees with role 'manager', 'tl', 'team_leader', 'process_manager'

INSERT IGNORE INTO user_assignment_scope
  (id, user_id, role_key, scope_type, manager_employee_id, branch_id, process_id, active_status, created_at)
SELECT
  UUID(),
  e.user_id,
  COALESCE((
    SELECT ur.role_key
    FROM user_roles ur
    WHERE ur.user_id = e.user_id
      AND ur.active_status = 1
      AND ur.role_key IN ('manager', 'tl', 'team_leader', 'process_manager')
    LIMIT 1
  ), 'tl') AS role_key,
  'team' AS scope_type,
  e.id AS manager_employee_id,
  e.branch_id,
  e.process_id,
  1 AS active_status,
  NOW() AS created_at
FROM employees e
WHERE e.active_status = 1
  AND e.user_id IS NOT NULL
  AND EXISTS (
    -- Only create scope for employees who are actually managers (have reports)
    SELECT 1 FROM employees sub
    WHERE sub.reporting_manager_id = e.id
      AND sub.active_status = 1
  );

-- ============================================================
-- SECTION 2: Branch Scope for Branch Heads
-- ============================================================
-- Create branch scope for users with 'branch_head' role

INSERT IGNORE INTO user_assignment_scope
  (id, user_id, role_key, scope_type, branch_id, active_status, created_at)
SELECT
  UUID(),
  ur.user_id,
  'branch_head' AS role_key,
  'branch' AS scope_type,
  e.branch_id,
  1 AS active_status,
  NOW() AS created_at
FROM user_roles ur
JOIN employees e ON e.user_id = ur.user_id AND e.active_status = 1
WHERE ur.role_key = 'branch_head'
  AND ur.active_status = 1
  AND e.branch_id IS NOT NULL;

-- ============================================================
-- SECTION 3: Process Scope for Process Managers
-- ============================================================
-- Create process scope for users with 'process_manager' or 'manager' role

INSERT IGNORE INTO user_assignment_scope
  (id, user_id, role_key, scope_type, process_id, branch_id, active_status, created_at)
SELECT
  UUID(),
  ur.user_id,
  COALESCE(ur.role_key, 'process_manager') AS role_key,
  'process' AS scope_type,
  e.process_id,
  e.branch_id,
  1 AS active_status,
  NOW() AS created_at
FROM user_roles ur
JOIN employees e ON e.user_id = ur.user_id AND e.active_status = 1
WHERE ur.role_key IN ('manager', 'process_manager')
  AND ur.active_status = 1
  AND e.process_id IS NOT NULL;

-- ============================================================
-- SECTION 4: Branch+Process Combined Scope for Managers
-- ============================================================
-- Create branch_process scope for tighter scoping when both are available

INSERT IGNORE INTO user_assignment_scope
  (id, user_id, role_key, scope_type, branch_id, process_id, active_status, created_at)
SELECT
  UUID(),
  ur.user_id,
  COALESCE(ur.role_key, 'manager') AS role_key,
  'branch_process' AS scope_type,
  e.branch_id,
  e.process_id,
  1 AS active_status,
  NOW() AS created_at
FROM user_roles ur
JOIN employees e ON e.user_id = ur.user_id AND e.active_status = 1
WHERE ur.role_key IN ('manager', 'process_manager', 'tl', 'team_leader')
  AND ur.active_status = 1
  AND e.branch_id IS NOT NULL
  AND e.process_id IS NOT NULL;

-- ============================================================
-- SECTION 5: Self Scope for All Employees
-- ============================================================
-- Create self scope so employees can view their own records

INSERT IGNORE INTO user_assignment_scope
  (id, user_id, role_key, scope_type, manager_employee_id, active_status, created_at)
SELECT
  UUID(),
  e.user_id,
  'employee' AS role_key,
  'self' AS scope_type,
  e.id AS manager_employee_id,
  1 AS active_status,
  NOW() AS created_at
FROM employees e
WHERE e.active_status = 1
  AND e.user_id IS NOT NULL;

-- ============================================================
-- SECTION 6: All Access for Admins and CEO
-- ============================================================
-- Create 'all' scope for admin and ceo roles

INSERT IGNORE INTO user_assignment_scope
  (id, user_id, role_key, scope_type, active_status, created_at)
SELECT
  UUID(),
  ur.user_id,
  ur.role_key,
  'all' AS scope_type,
  1 AS active_status,
  NOW() AS created_at
FROM user_roles ur
WHERE ur.role_key IN ('admin', 'ceo')
  AND ur.active_status = 1;

-- ============================================================
-- VERIFICATION QUERY (commented out - run manually to check)
-- ============================================================
-- SELECT
--   scope_type,
--   role_key,
--   COUNT(*) as scope_count
-- FROM user_assignment_scope
-- WHERE active_status = 1
-- GROUP BY scope_type, role_key
-- ORDER BY scope_type, role_key;
