-- Migration 449: Add attrition_date and attrition_reason to employees
-- Additive; guarded; existing rows stay NULL.
-- date_of_leaving already exists but was free-text in older data.
-- attrition_date is the formal HR-recorded date for reporting.
-- attrition_reason is a closed-set enum per issue #10 requirement.

SET @db = DATABASE();

-- attrition_date: formal date for reporting/analytics (distinct from resignation_date and date_of_exit)
SELECT COUNT(*) INTO @has_attrition_date
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'attrition_date';

SET @sql_date = IF(@has_attrition_date = 0,
  'ALTER TABLE employees ADD COLUMN attrition_date DATE NULL DEFAULT NULL AFTER date_of_leaving',
  'SELECT ''attrition_date already exists'' AS note'
);
PREPARE stmt FROM @sql_date; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- attrition_reason: closed-set dropdown per CLAUDE.md Form Input Rule
SELECT COUNT(*) INTO @has_attrition_reason
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'attrition_reason';

SET @sql_reason = IF(@has_attrition_reason = 0,
  "ALTER TABLE employees ADD COLUMN attrition_reason ENUM(
    'Resigned - Better Opportunity',
    'Resigned - Personal Reasons',
    'Resigned - Higher Education',
    'Resigned - Relocation',
    'Resigned - Health Issues',
    'Resigned - Salary Dissatisfaction',
    'Resigned - Work Environment',
    'Absconding',
    'Terminated - Performance',
    'Terminated - Misconduct',
    'Terminated - Policy Violation',
    'Terminated - Attendance',
    'Contract End',
    'Retirement',
    'Death',
    'Other'
  ) NULL DEFAULT NULL AFTER attrition_date",
  'SELECT ''attrition_reason already exists'' AS note'
);
PREPARE stmt FROM @sql_reason; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- attrition_reason_notes: free text for "Other" or additional context
SELECT COUNT(*) INTO @has_notes
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'attrition_reason_notes';

SET @sql_notes = IF(@has_notes = 0,
  'ALTER TABLE employees ADD COLUMN attrition_reason_notes VARCHAR(1000) NULL DEFAULT NULL AFTER attrition_reason',
  'SELECT ''attrition_reason_notes already exists'' AS note'
);
PREPARE stmt FROM @sql_notes; EXECUTE stmt; DEALLOCATE PREPARE stmt;
