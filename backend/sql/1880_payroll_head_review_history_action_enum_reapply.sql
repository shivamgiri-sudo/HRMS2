-- 1880_payroll_head_review_history_action_enum_reapply.sql
-- Re-applies 1609. Migration 1609 was recorded in schema_migrations by the
-- 'bulk-mark-applied' executor (2026-09-16) without its ALTER ever running, so on
-- production the action ENUM still stops at 'reopened'. Every Payroll Head salary
-- date change ('salary_start_date_updated' / 'assignment_effective_date_updated')
-- and Salary Date Revision approval/rejection then fails with
-- "Data truncated for column 'action'" and rolls the whole change back.
-- Idempotent: MODIFY to the same full list is a no-op where 1609 did run. The new
-- values are appended after the existing ones, so no existing row is affected.

ALTER TABLE employee_payroll_head_review_history
  MODIFY COLUMN action ENUM(
    'approved',
    'rejected',
    'resubmitted',
    'reopened',
    'salary_start_date_updated',
    'salary_date_revision_approved',
    'salary_date_revision_rejected',
    'assignment_effective_date_updated'
  ) NOT NULL;
