-- 1223_lms_reminder_log.sql
--
-- Adds due_date and course_duration_hours to the LMS progress snapshot so the
-- reminder cron knows when each course is due and can display duration in the
-- email. Creates lms_reminder_log to deduplicate reminder sends — each
-- (employee, course, reminder_type) pair is logged once so a daily cron tick
-- never produces a duplicate email for the same window.
--
-- SYNTAX REPAIRED 2026-08-16. The schema below is unchanged from the original — same columns,
-- same types, same comments, same index and same table. What changed is HOW the three conditional
-- statements are expressed.
--
-- As written, this used `ADD COLUMN IF NOT EXISTS` (twice) and `CREATE INDEX IF NOT EXISTS`. Those
-- are MariaDB syntax. Production is MySQL 8.0.42, which throws ER_PARSE_ERROR at the IF NOT EXISTS
-- token itself — and the runner records the migration as applied anyway. That combination is
-- exactly what produced the 2026-08-13 outage: a migration that never ran, permanently marked done.
--
-- Verified read-only against mas_hrms 2026-08-16 before rewriting: the target table exists with
-- 1,275 rows, NEITHER column exists, the index does not exist, lms_reminder_log does not exist, and
-- schema_migrations has no 1223 row. So nothing here has been applied and nothing is being
-- re-applied over live data.
--
-- Guarded with information_schema + PREPARE/EXECUTE, the pattern 1224 uses. Re-runnable; no DROP,
-- no DELETE, additive only.

-- `USE mas_hrms;` removed deliberately: the runner already connects to the target schema, and
-- hardcoding the database name breaks a rebuilt or staging schema. The guards below use DATABASE()
-- so they follow whatever connection they are given.

-- 1. Enrich the progress snapshot -----------------------------------------

SET @c_due_date := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lms_learning_progress_snapshot'
    AND COLUMN_NAME = 'due_date');

SET @add_due_date := IF(@c_due_date = 0,
  'ALTER TABLE lms_learning_progress_snapshot ADD COLUMN due_date DATE NULL COMMENT ''Batch end date synced from LMS batch_master.end_date; used to trigger due-date reminders''',
  'SELECT "due_date already exists" AS info');

PREPARE stmt FROM @add_due_date;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c_duration := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lms_learning_progress_snapshot'
    AND COLUMN_NAME = 'course_duration_hours');

SET @add_duration := IF(@c_duration = 0,
  'ALTER TABLE lms_learning_progress_snapshot ADD COLUMN course_duration_hours INT NULL COMMENT ''Estimated total course hours synced from LMS classroom_master; shown in reminder emails''',
  'SELECT "course_duration_hours already exists" AS info');

PREPARE stmt FROM @add_duration;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index lets the cron query filter by due date without a full table scan.
-- Guarded against INFORMATION_SCHEMA.STATISTICS for the same reason as the columns above.

SET @c_idx_due := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lms_learning_progress_snapshot'
    AND INDEX_NAME = 'idx_lms_prog_due');

SET @add_idx_due := IF(@c_idx_due = 0,
  'CREATE INDEX idx_lms_prog_due ON lms_learning_progress_snapshot (due_date)',
  'SELECT "idx_lms_prog_due already exists" AS info');

PREPARE stmt FROM @add_idx_due;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Reminder log ----------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS is valid MySQL 8 and is left exactly as written.

CREATE TABLE IF NOT EXISTS lms_reminder_log (
  id           CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id  CHAR(36) NOT NULL,
  course_id    VARCHAR(128) NOT NULL DEFAULT '',
  reminder_type ENUM('7d', '3d', '1d') NOT NULL
    COMMENT '7d = 7 days before due, 3d = 3 days, 1d = 1 day',
  sent_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  email_to     VARCHAR(255),
  UNIQUE KEY uq_lms_reminder (employee_id, course_id, reminder_type),
  KEY idx_lms_reminder_emp  (employee_id),
  KEY idx_lms_reminder_sent (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
