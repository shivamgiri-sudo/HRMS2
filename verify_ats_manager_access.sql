-- ============================================================================
-- Verification Script: ATS Hiring Entry Manager Access
-- ============================================================================
-- Purpose: Verify that manager roles have been granted access to ATS_RECRUITER_QUEUE
-- Usage: mysql -u [user] -p mas_hrms < verify_ats_manager_access.sql
-- ============================================================================

-- Check 1: Verify role_page_access entries exist
SELECT '=== Check 1: Manager Role Page Access ===' AS step;
SELECT
  role_key,
  page_code,
  can_view,
  can_create,
  can_edit,
  can_delete,
  can_export,
  active_status
FROM role_page_access
WHERE page_code = 'ATS_RECRUITER_QUEUE'
  AND role_key IN ('manager', 'process_manager', 'team_leader', 'hr', 'recruiter', 'branch_head')
ORDER BY role_key;

-- Expected: Should show all 6 roles with appropriate permissions

-- Check 2: Verify workforce_role_catalog contains manager roles
SELECT '=== Check 2: Role Catalog Entries ===' AS step;
SELECT
  role_key,
  role_name,
  active_status
FROM workforce_role_catalog
WHERE role_key IN ('manager', 'process_manager', 'team_leader', 'hr', 'recruiter')
ORDER BY role_key;

-- Expected: All 5 roles should exist and be active

-- Check 3: Count users with manager roles
SELECT '=== Check 3: Users with Manager Roles ===' AS step;
SELECT
  ur.role_key,
  COUNT(DISTINCT ur.user_id) AS user_count
FROM user_roles ur
WHERE ur.role_key IN ('manager', 'process_manager', 'team_leader')
  AND ur.active_status = 1
GROUP BY ur.role_key
ORDER BY ur.role_key;

-- Expected: Non-zero counts for roles that are in use

-- Check 4: Sample manager-recruiter relationships
SELECT '=== Check 4: Manager-Recruiter Relationships (Sample) ===' AS step;
SELECT
  mgr.employee_code AS manager_code,
  mgr.name AS manager_name,
  rec.employee_code AS recruiter_code,
  rec.name AS recruiter_name,
  rec_ur.role_key AS recruiter_role
FROM employees rec
INNER JOIN employees mgr ON rec.manager_id = mgr.id
INNER JOIN user_roles rec_ur ON rec.user_id = rec_ur.user_id
WHERE rec_ur.role_key = 'recruiter'
  AND rec_ur.active_status = 1
  AND mgr.active_status = 1
LIMIT 10;

-- Expected: Shows managers who have recruiters as direct reports

-- Check 5: Verify branch-based access data exists
SELECT '=== Check 5: Branch Master Integrity ===' AS step;
SELECT
  bm.branch_code,
  bm.branch_name,
  COUNT(DISTINCT e.id) AS employee_count
FROM branch_master bm
LEFT JOIN employees e ON e.branch_id = bm.id
WHERE bm.active_status = 1
GROUP BY bm.id, bm.branch_code, bm.branch_name
ORDER BY employee_count DESC
LIMIT 10;

-- Expected: Shows active branches with employee counts

-- Check 6: Sample ATS hiring activities with branch info
SELECT '=== Check 6: ATS Hiring Activities (Recent Sample) ===' AS step;
SELECT
  aha.id,
  aha.candidate_name,
  aha.branch_name,
  aha.recruiter_name,
  aha.created_by,
  DATE(aha.created_at) AS created_date
FROM ats_recruiter_hiring_activity aha
ORDER BY aha.created_at DESC
LIMIT 10;

-- Expected: Shows recent hiring activities with branch/recruiter info

-- Check 7: Users who would gain new access (managers not already having access via other roles)
SELECT '=== Check 7: Users Gaining New Access ===' AS step;
SELECT
  e.employee_code,
  e.name,
  u.email,
  ur_mgr.role_key AS manager_role,
  COALESCE(bm.branch_name, 'N/A') AS branch
FROM user_roles ur_mgr
INNER JOIN users u ON ur_mgr.user_id = u.id
INNER JOIN employees e ON u.id = e.user_id
LEFT JOIN branch_master bm ON e.branch_id = bm.id
WHERE ur_mgr.role_key IN ('manager', 'process_manager', 'team_leader')
  AND ur_mgr.active_status = 1
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur_other
    WHERE ur_other.user_id = ur_mgr.user_id
      AND ur_other.role_key IN ('admin', 'hr', 'super_admin', 'branch_head', 'recruiter')
      AND ur_other.active_status = 1
  )
LIMIT 20;

-- Expected: Shows managers who didn't already have ATS access via HR/admin roles

-- Summary
SELECT '=== Verification Complete ===' AS summary;
SELECT
  'If all checks show expected results, the migration was successful.' AS status,
  'Managers, process_managers, and team_leaders should now have ATS_RECRUITER_QUEUE access.' AS note;
