-- Migration 1611: employee_salary_change_log — audit trail for the new Salary Change page.
--
-- Payroll Head can change an already-active employee's salary (not the onboarding-time
-- review flow — that's employee_payroll_head_review, which is for NEW hires only and is
-- already terminal by the time an employee needs a later salary change). The actual write
-- still goes to salary_component_assignments in its existing shape (same INSERT pattern
-- writeComponentAssignment() in payroll-head-review.service.ts already uses) — this table is
-- purely the who/why trail: which assignment replaced which, who asked for it (a name picked
-- from a search, not necessarily the actor), and who actually submitted it.
--
-- Deliberately its own table rather than a new column on salary_component_assignments — that
-- table is read directly by payrollCalculate.service.ts and this migration does not touch its
-- shape at all.
--
-- Purely additive (new table). Idempotent via CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS employee_salary_change_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  old_salary_component_assignment_id CHAR(36) NULL,
  new_salary_component_assignment_id CHAR(36) NOT NULL,
  requested_by_user_id CHAR(36) NULL,
  requested_by_name VARCHAR(200) NULL,
  actor_user_id CHAR(36) NOT NULL,
  reason TEXT NOT NULL,
  old_ctc DECIMAL(12,2) NULL,
  new_ctc DECIMAL(12,2) NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_salary_change_employee (employee_id),
  INDEX idx_salary_change_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO page_catalog (page_code, page_name, module, description, created_at)
SELECT
  'SALARY_CHANGE_CENTER',
  'Salary Change',
  'payroll',
  'Payroll Head: search an active employee, view current salary, change the package with a required reason and requestor',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM page_catalog WHERE page_code = 'SALARY_CHANGE_CENTER'
);

INSERT INTO role_page_access (role_key, page_code, can_view, can_edit, can_delete, can_export, created_at)
SELECT r.role_key, 'SALARY_CHANGE_CENTER', 1, 1, 0, 0, NOW()
FROM (
  SELECT 'payroll_head' AS role_key UNION ALL
  SELECT 'admin'                    UNION ALL
  SELECT 'super_admin'
) r
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access
   WHERE role_key = r.role_key
     AND page_code = 'SALARY_CHANGE_CENTER'
);
