-- 380_requisition_extend_deadline_audit.sql
-- Additive: adds last_overdue_notified_at for cron de-duplication.
-- Safe to run on approved or closed requisitions — column is nullable.

ALTER TABLE job_requisition
  ADD COLUMN IF NOT EXISTS last_overdue_notified_at DATETIME NULL DEFAULT NULL
    COMMENT 'Set by overdue-deadline cron to prevent repeat notifications same day';
