-- 1543_roster_import_row_absent_status.sql
-- wfm_roster_import_row.normalized_type is an ENUM that never included 'ABSENT'
-- (assignment-normalizer.service.ts's AssignmentType union, c1cc4943). Roster status
-- keywords LWP and "Left" were mapped to ABSENT there — not LEAVE, because LEAVE is
-- cross-checked against an approved leave_request and would false-positive warn on
-- every row for both (neither carries an approval by definition). Every PATCH/update
-- of such a row fails "Data truncated for column 'normalized_type'" until the enum
-- allows it. wfm_roster_assignment.assignment_type (the committed side) is a plain
-- VARCHAR(50), unaffected.

SET @has_absent = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'wfm_roster_import_row'
     AND column_name = 'normalized_type'
     AND FIND_IN_SET('ABSENT', REPLACE(REPLACE(REPLACE(column_type, 'enum(', ''), ')', ''), '''', '')) > 0
);
SET @sql = IF(
  @has_absent = 0,
  "ALTER TABLE wfm_roster_import_row MODIFY COLUMN normalized_type ENUM('SHIFT', 'WEEK_OFF', 'LEAVE', 'ABSENT', 'HALF_DAY', 'HOLIDAY', 'TRAINING', 'UNSCHEDULED', 'UNASSIGNED', 'NEEDS_MAPPING', 'NO_CHANGE', 'HARD_ERROR') NOT NULL",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1543_roster_import_row_absent_status.sql applied' AS migration_status;
