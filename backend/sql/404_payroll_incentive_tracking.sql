-- Migration 404: Track when incentives are applied to a payroll run
-- Additive only — safe to run on existing schema.

ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS incentives_applied_at DATETIME NULL COMMENT 'Timestamp when incentives were applied to this run';

-- Index for efficient queries on whether incentives have been applied
CREATE INDEX IF NOT EXISTS idx_spr_incentives_applied ON salary_prep_run (incentives_applied_at);
