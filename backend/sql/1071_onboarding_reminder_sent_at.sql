-- 1071: give ats_onboarding_bridge the reminder timestamp its cron already assumed.
--
-- ats-reminders.cron.ts reads and writes `reminder_sent_at` on this table. The
-- column has never existed, so the cron raised ER_BAD_FIELD_ERROR on every tick
-- and no onboarding reminder has ever been sent. Two more columns it read were
-- also wrong (onboarding_link, joining_status); those are query fixes, but this
-- one genuinely needs a column, because the cron's whole purpose depends on
-- remembering when it last mailed someone.
--
-- Without it there is no way to avoid re-mailing the same candidate on every
-- tick, which is worse than sending nothing.
--
-- Additive and idempotent. NULL means "never reminded", which is the correct
-- starting state for every existing row.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'ats_onboarding_bridge'
     AND COLUMN_NAME = 'reminder_sent_at'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE ats_onboarding_bridge ADD COLUMN reminder_sent_at DATETIME NULL DEFAULT NULL',
  'SELECT "reminder_sent_at already present" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
