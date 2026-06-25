-- 294_payroll_window_closure.sql
-- Adds payroll window closure date and auto-lock tracking to salary_prep_run.
-- Window = last day of run_month + 30 days. After this date the run is locked.
-- Additive migration — only runs created after this migration get window_close_date.

ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS window_close_date DATE     NULL
    COMMENT 'Auto-computed at run creation: last day of run_month + 30 calendar days',
  ADD COLUMN IF NOT EXISTS auto_closed_at    DATETIME NULL
    COMMENT 'Set by daily cron when window_close_date is reached',
  ADD COLUMN IF NOT EXISTS closed_by         CHAR(36) NULL
    COMMENT 'auth_user.id or literal "system" for cron-triggered closure';

-- Index for daily cron query
ALTER TABLE salary_prep_run
  ADD INDEX IF NOT EXISTS idx_spr_window_close (window_close_date, status);
