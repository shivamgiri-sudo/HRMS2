-- Migration 398: Track when incentives were applied to a payroll run
-- Used to protect against silent incentive wipe on recalculate
ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS incentives_applied_at DATETIME NULL AFTER status;
