-- Migration 449: Add attrition_date, attrition_reason, attrition_reason_notes to employees
-- Additive; idempotent. Uses ALGORITHM=INSTANT (MySQL 8.0+) — zero table-rebuild.
-- Single ALTER statement where possible: one MDL acquisition, not three.
-- lock_wait_timeout=300 gives 5 min for MDL; innodb_lock_wait_timeout=300 for row locks.

SET SESSION innodb_lock_wait_timeout = 300;
SET SESSION lock_wait_timeout        = 300;

SET @db = DATABASE();

-- Detect which columns are missing
SELECT COUNT(*) INTO @has_date   FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='employees' AND COLUMN_NAME='attrition_date';
SELECT COUNT(*) INTO @has_reason FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='employees' AND COLUMN_NAME='attrition_reason';
SELECT COUNT(*) INTO @has_notes  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='employees' AND COLUMN_NAME='attrition_reason_notes';

-- Case 1: all three missing — one ALTER, one MDL
SET @sql_all = "ALTER TABLE employees
  ADD COLUMN attrition_date            DATE          NULL DEFAULT NULL AFTER date_of_leaving,
  ADD COLUMN attrition_reason          ENUM(
    'Resigned - Better Opportunity','Resigned - Personal Reasons',
    'Resigned - Higher Education','Resigned - Relocation',
    'Resigned - Health Issues','Resigned - Salary Dissatisfaction',
    'Resigned - Work Environment','Absconding',
    'Terminated - Performance','Terminated - Misconduct',
    'Terminated - Policy Violation','Terminated - Attendance',
    'Contract End','Retirement','Death','Other'
  ) NULL DEFAULT NULL AFTER attrition_date,
  ADD COLUMN attrition_reason_notes    VARCHAR(1000) NULL DEFAULT NULL AFTER attrition_reason,
  ALGORITHM=INSTANT";

-- Case 2: attrition_date exists, reason+notes missing — one ALTER for two columns
SET @sql_reason_notes = "ALTER TABLE employees
  ADD COLUMN attrition_reason          ENUM(
    'Resigned - Better Opportunity','Resigned - Personal Reasons',
    'Resigned - Higher Education','Resigned - Relocation',
    'Resigned - Health Issues','Resigned - Salary Dissatisfaction',
    'Resigned - Work Environment','Absconding',
    'Terminated - Performance','Terminated - Misconduct',
    'Terminated - Policy Violation','Terminated - Attendance',
    'Contract End','Retirement','Death','Other'
  ) NULL DEFAULT NULL AFTER attrition_date,
  ADD COLUMN attrition_reason_notes    VARCHAR(1000) NULL DEFAULT NULL AFTER attrition_reason,
  ALGORITHM=INSTANT";

-- Case 3: reason missing, notes missing (date+notes exist somehow — unlikely but safe)
SET @sql_reason_only = "ALTER TABLE employees
  ADD COLUMN attrition_reason          ENUM(
    'Resigned - Better Opportunity','Resigned - Personal Reasons',
    'Resigned - Higher Education','Resigned - Relocation',
    'Resigned - Health Issues','Resigned - Salary Dissatisfaction',
    'Resigned - Work Environment','Absconding',
    'Terminated - Performance','Terminated - Misconduct',
    'Terminated - Policy Violation','Terminated - Attendance',
    'Contract End','Retirement','Death','Other'
  ) NULL DEFAULT NULL AFTER attrition_date,
  ALGORITHM=INSTANT";

-- Case 4: only notes missing
SET @sql_notes_only = "ALTER TABLE employees
  ADD COLUMN attrition_reason_notes VARCHAR(1000) NULL DEFAULT NULL AFTER attrition_reason,
  ALGORITHM=INSTANT";

-- Pick correct statement based on what exists
-- 0=missing, 1=exists
-- all missing  => run @sql_all
-- date exists, reason+notes missing => @sql_reason_notes
-- date+reason exist, notes missing => @sql_notes_only
-- everything exists => no-op

SET @run_all          = IF(@has_date = 0 AND @has_reason = 0 AND @has_notes = 0, @sql_all,          NULL);
SET @run_reason_notes = IF(@has_date = 1 AND @has_reason = 0 AND @has_notes = 0, @sql_reason_notes, NULL);
SET @run_reason_only  = IF(@has_date = 1 AND @has_reason = 0 AND @has_notes = 1, @sql_reason_only,  NULL);
SET @run_notes_only   = IF(@has_date = 1 AND @has_reason = 1 AND @has_notes = 0, @sql_notes_only,   NULL);

SET @noop = 'SELECT ''all attrition columns already present'' AS note';

SET @chosen = COALESCE(@run_all, @run_reason_notes, @run_reason_only, @run_notes_only, @noop);

PREPARE stmt FROM @chosen; EXECUTE stmt; DEALLOCATE PREPARE stmt;
