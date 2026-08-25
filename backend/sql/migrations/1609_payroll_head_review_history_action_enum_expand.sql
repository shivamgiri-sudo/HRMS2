-- 1609_payroll_head_review_history_action_enum_expand.sql
-- Expand the action ENUM on employee_payroll_head_review_history to include
-- salary date audit actions added by the salary-date-sync feature.

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
