-- Add cost_centre_id column to user_assignment_scope
-- This column allows scoping a user's assignment to a specific cost centre
-- The query in reporting.scope.ts has a fallback for this column, but having it
-- avoids the "ER_BAD_FIELD_ERROR" warning in the MySQL error logs.

ALTER TABLE user_assignment_scope
  ADD COLUMN IF NOT EXISTS cost_centre_id CHAR(36) DEFAULT NULL AFTER department_id;
