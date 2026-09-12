-- 1760_exit_absconding_since.sql
--
-- Records the date an absconding employee last actually worked.
--
-- WHY
--   The New Exit Request form has always asked for "Absconding Since" as a MANDATORY field
--   when the sub-type is absconding, and then thrown the answer away: submitRequest() never
--   sent it, the create schema would have rejected it, and exit_request has no column to hold
--   it. The only thing the date did was auto-fill the proposed last working day as
--   abscondingSince + 7 days, labelled "Grace period ends".
--
--   Owner ruling 2026-09-12: the 7 days is how long the company WAITS before deciding, not
--   time the employee is paid for. Their last working day is the last day they actually
--   turned up. So the +7 was putting a leaver's paid-through date a week after they stopped
--   working — and last_working_day_proposed feeds payroll's employment-end-date resolver,
--   which prorates the final month. Seven unworked days, on every absconding case.
--
--   This column is the durable record of that date. It is deliberately separate from
--   last_working_day_confirmed even though the two are set to the same value for an
--   absconding: one is "the last day attendance shows them present", a fact about the past
--   that never changes, and the other is "the date HR agreed they ceased employment", which
--   is a decision and can be revised. Collapsing them would lose the ability to tell a
--   corrected exit date from the underlying attendance evidence.
--
-- SAFETY
--   Purely additive: one nullable DATE column and one index. No DROP, no DELETE, no
--   backfill, no FOREIGN KEY. Every existing row keeps absconding_since = NULL, which reads
--   correctly as "not an absconding, or predates this column". No existing query selects it.
--
--   information_schema-guarded PREPARE/EXECUTE rather than ADD COLUMN IF NOT EXISTS: that is
--   MariaDB syntax and this production MySQL 8 rejects it with ER_PARSE_ERROR. No COLLATE
--   clause is needed because DATE is not a string type.

SET @has_absconding_since = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'exit_request'
    AND COLUMN_NAME = 'absconding_since'
);
SET @sql = IF(@has_absconding_since = 0,
  "ALTER TABLE exit_request ADD COLUMN absconding_since DATE NULL COMMENT 'Last date the employee actually worked, for absconding/abandonment exits. The 7-day no-show window is detection time, not paid time.' AFTER exit_reason_category",
  "SELECT 'exit_request.absconding_since already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Supports the absconding register and the reconciliation between this date and
-- employees.date_of_exit, which the exit flow keeps in step.
SET @has_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'exit_request'
    AND INDEX_NAME = 'idx_exit_absconding_since'
);
SET @sql = IF(@has_idx = 0,
  "ALTER TABLE exit_request ADD INDEX idx_exit_absconding_since (absconding_since)",
  "SELECT 'idx_exit_absconding_since already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
