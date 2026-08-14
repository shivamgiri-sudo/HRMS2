-- 380_requisition_extend_deadline_audit.sql
-- Additive: adds last_overdue_notified_at for cron de-duplication.
-- Safe to run on approved or closed requisitions — column is nullable.
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` is MariaDB syntax, rejected by this production
-- MySQL 8.0.42 build with ER_PARSE_ERROR. This column does NOT currently exist on production
-- (confirmed via information_schema) and this file is not yet in MIGRATION_MANIFEST, so it
-- has never actually run — syntax-only fix, no live column added by this change. Registering
-- it in the manifest (and therefore actually adding the column) is a decision for whoever
-- owns the requisition overdue-notification cron, not made here.
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_requisition' AND COLUMN_NAME = 'last_overdue_notified_at');
SET @sql = IF(@c1 = 0,
  'ALTER TABLE job_requisition ADD COLUMN last_overdue_notified_at DATETIME NULL DEFAULT NULL COMMENT ''Set by overdue-deadline cron to prevent repeat notifications same day''',
  'SELECT "last_overdue_notified_at already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
