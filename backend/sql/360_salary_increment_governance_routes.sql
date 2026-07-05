-- Ensure salary_increment_request.status has 'withdrawn' for self-cancellation
-- (additive ALTER; idempotent on re-run)
ALTER TABLE salary_increment_request
  MODIFY COLUMN status ENUM(
    'draft','submitted','hr_validated','finance_validated',
    'approved','rejected','implemented','cancelled','withdrawn'
  ) NOT NULL DEFAULT 'submitted';
