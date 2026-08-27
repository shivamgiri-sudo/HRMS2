-- 1621_payroll_head_org_wide_scope.sql
--
-- payroll_head and finance_head must see all employees company-wide to perform
-- payroll calculations and financial reporting. buildScopeWhereClause() returns
-- 1=0 for any user whose role has no row in user_assignment_scope, so without
-- this migration these roles see zero employees on every scoped endpoint.
--
-- Inserts scope_type='all' for every active user who holds payroll_head or
-- finance_head in user_roles but has no existing scope row for that role.
-- Idempotent: WHERE NOT EXISTS guard prevents duplicate inserts.

INSERT INTO user_assignment_scope
  (id, user_id, role_key, scope_type, branch_id, process_id, lob_id, department_id, manager_employee_id, active_status, created_at, updated_at)
SELECT
  UUID(),
  ur.user_id,
  ur.role_key,
  'all',
  NULL, NULL, NULL, NULL, NULL,
  1,
  NOW(),
  NOW()
FROM user_roles ur
WHERE ur.role_key IN ('payroll_head', 'finance_head')
  AND ur.active_status = 1
  AND NOT EXISTS (
    SELECT 1
    FROM user_assignment_scope uas
    WHERE uas.user_id  = ur.user_id
      AND uas.role_key = ur.role_key
      AND uas.active_status = 1
  );
