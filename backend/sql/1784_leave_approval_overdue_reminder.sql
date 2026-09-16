-- 1784_leave_approval_overdue_reminder.sql
--
-- Owner directive (2026-09-16): every pending/actionable item must generate a reminder if
-- it stays unresolved. leave_submitted notifies the approver once when a request is
-- raised; nothing ever reminds them again if they sit on it. `leave_approval_overdue` was
-- already registered in notification_event_config (enabled=1, dispatch_mode='live',
-- recipient_spec To=reporting_manager/Cc=branch_hr — identical shape to leave_submitted)
-- with zero producers anywhere in the app, the same "config says live, no code will ever
-- call it" drift documented for several other events in this catalog.
--
-- This adds the two tracking columns the new worker (leave-approval-reminder.worker.ts)
-- needs to bound itself, mirroring noc_signatory.reminder_count/last_reminder_at exactly:
-- reminder_count so a request stops being nagged after MAX_REMINDERS, last_reminder_at so
-- reminders are spaced by the worker's own interval independently of the gateway's cooldown.
--
-- Additive only. Both columns default to a value equivalent to "never reminded", so every
-- existing pending row is picked up by the worker's first sweep exactly as if it were new.
--
-- information_schema-guarded PREPARE/EXECUTE rather than ADD COLUMN IF NOT EXISTS: that is
-- MariaDB syntax and this production MySQL 8 rejects it with ER_PARSE_ERROR (see
-- 1760_exit_absconding_since.sql's own note on the exact same trap).

SET @has_reminder_count = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_request' AND COLUMN_NAME = 'reminder_count'
);
SET @sql = IF(@has_reminder_count = 0,
  "ALTER TABLE leave_request ADD COLUMN reminder_count INT NOT NULL DEFAULT 0 COMMENT 'How many overdue-approval reminders have been sent for this request'",
  "SELECT 'leave_request.reminder_count already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_last_reminder_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_request' AND COLUMN_NAME = 'last_reminder_at'
);
SET @sql = IF(@has_last_reminder_at = 0,
  "ALTER TABLE leave_request ADD COLUMN last_reminder_at DATETIME NULL COMMENT 'When the last overdue-approval reminder was sent'",
  "SELECT 'leave_request.last_reminder_at already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seeded ENABLED: re-measured live on 2026-09-16, only 39 leave requests are currently
-- 'pending' past the 24h SLA (all pending requests today happen to be older than 24h) —
-- small enough that immediately reminding every approver on their backlog is the intended
-- behaviour, not an incident. worker_name MUST match the WORKER_NAME constant in
-- leave-approval-reminder.worker.ts exactly — isWorkerEnabled() fails OPEN on a missing
-- row, so a mismatch here would make the kill switch silently unusable rather than off.
INSERT IGNORE INTO worker_config (worker_name, enabled, description)
VALUES (
  'leave-approval-reminder',
  1,
  'Reminds the reporting manager (cc branch HR) when a leave request has sat at status=pending for 24+ hours without a decision. Stops after 3 reminders per request — beyond that it is a management conversation, not a mail loop. Does not touch requests already escalated to pending_branch_head, which has its own one-time notification. Set enabled=0 to stop reminders.'
);

-- Verification:
-- SHOW COLUMNS FROM leave_request LIKE 'reminder_count';
-- SHOW COLUMNS FROM leave_request LIKE 'last_reminder_at';
-- SELECT worker_name, enabled FROM worker_config WHERE worker_name = 'leave-approval-reminder';
--   -- expect 1 row, enabled=1
