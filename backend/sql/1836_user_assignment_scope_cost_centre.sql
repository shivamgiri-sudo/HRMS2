-- Add cost_centre_id column to user_assignment_scope
-- This column allows scoping a user's assignment to a specific cost centre
-- The query in reporting.scope.ts has a fallback for this column, but having it
-- avoids the "ER_BAD_FIELD_ERROR" warning in the MySQL error logs.

SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns
                   WHERE table_schema = DATABASE()
                   AND table_name = 'user_assignment_scope'
                   AND column_name = 'cost_centre_id');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_assignment_scope ADD COLUMN cost_centre_id CHAR(36) DEFAULT NULL AFTER department_id',
  'SELECT 1');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
