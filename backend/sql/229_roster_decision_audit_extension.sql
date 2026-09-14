-- ============================================================
-- Migration 229: roster_decision_audit — extend decision_type ENUM
-- and add fairness/HR/audit trail columns required by the full
-- auto-roster engine spec.
--
-- SAFE: MODIFY COLUMN on ENUM is backward compatible — existing rows
-- keep their current values. ADD COLUMN IF NOT EXISTS for all new fields.
--
-- ROLLBACK:
--   The ENUM extension cannot be easily rolled back without a table rebuild.
--   Safe approach: the added values are never written until the new engine
--   code is deployed; removing the values before any rows use them is safe
--   via another MODIFY COLUMN reverting to the original ENUM.
--   ALTER TABLE roster_decision_audit
--     DROP COLUMN IF EXISTS week_start_date,
--     DROP COLUMN IF EXISTS process_id,
--     DROP COLUMN IF EXISTS branch_id,
--     DROP COLUMN IF EXISTS fairness_score,
--     DROP COLUMN IF EXISTS fcfs_rank,
--     DROP COLUMN IF EXISTS skill_check_result,
--     DROP COLUMN IF EXISTS acted_by_role,
--     DROP COLUMN IF EXISTS old_value_json,
--     DROP COLUMN IF EXISTS new_value_json;
-- ============================================================

-- Extend the decision_type ENUM to include all full-spec decision types
ALTER TABLE roster_decision_audit
  MODIFY COLUMN decision_type ENUM(
    -- original 6 values (preserved)
    'shift_assigned',
    'weekoff_assigned',
    'weekoff_denied',
    'weekoff_waitlisted',
    'shift_frozen',
    'holiday_applied',
    -- new full-spec values
    'preference_accepted',
    'alternate_assigned',
    'no_preference_auto_assigned',
    'manual_override',
    'manager_realigned',
    'force_approved',
    'hr_override',
    'bulk_upload',
    'escalated_to_hr'
  ) NOT NULL;

-- Add new context columns
SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND COLUMN_NAME = 'week_start_date'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE roster_decision_audit ADD COLUMN week_start_date     DATE          NULL COMMENT ''Roster week for cross-reference''
    AFTER cycle_id',
  'SELECT "week_start_date already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND COLUMN_NAME = 'process_id'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE roster_decision_audit ADD COLUMN process_id          VARCHAR(36)   NULL COMMENT ''Denormalised process for fast reporting''
    AFTER week_start_date',
  'SELECT "process_id already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND COLUMN_NAME = 'branch_id'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE roster_decision_audit ADD COLUMN branch_id           VARCHAR(36)   NULL
    AFTER process_id',
  'SELECT "branch_id already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

SET @mcol_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND COLUMN_NAME = 'fairness_score'
);
SET @msql_4 = IF(@mcol_4 = 0,
  'ALTER TABLE roster_decision_audit ADD COLUMN fairness_score      DECIMAL(5,2)  NULL COMMENT ''Rotation fairness score at time of decision (lower = due sooner)''
    AFTER rule_applied',
  'SELECT "fairness_score already exists" AS message');
PREPARE mstmt_4 FROM @msql_4;
EXECUTE mstmt_4;
DEALLOCATE PREPARE mstmt_4;

SET @mcol_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND COLUMN_NAME = 'fcfs_rank'
);
SET @msql_5 = IF(@mcol_5 = 0,
  'ALTER TABLE roster_decision_audit ADD COLUMN fcfs_rank           INT           NULL COMMENT ''Employee FCFS position when preference was processed''
    AFTER fairness_score',
  'SELECT "fcfs_rank already exists" AS message');
PREPARE mstmt_5 FROM @msql_5;
EXECUTE mstmt_5;
DEALLOCATE PREPARE mstmt_5;

SET @mcol_6 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND COLUMN_NAME = 'skill_check_result'
);
SET @msql_6 = IF(@mcol_6 = 0,
  'ALTER TABLE roster_decision_audit ADD COLUMN skill_check_result  VARCHAR(100)  NULL COMMENT ''pass / fail:<reason> for skill/cert validation''
    AFTER fcfs_rank',
  'SELECT "skill_check_result already exists" AS message');
PREPARE mstmt_6 FROM @msql_6;
EXECUTE mstmt_6;
DEALLOCATE PREPARE mstmt_6;

SET @mcol_7 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND COLUMN_NAME = 'acted_by_role'
);
SET @msql_7 = IF(@mcol_7 = 0,
  'ALTER TABLE roster_decision_audit ADD COLUMN acted_by_role       VARCHAR(50)   NULL COMMENT ''Role of the user who triggered this audit row''
    AFTER override_by',
  'SELECT "acted_by_role already exists" AS message');
PREPARE mstmt_7 FROM @msql_7;
EXECUTE mstmt_7;
DEALLOCATE PREPARE mstmt_7;

SET @mcol_8 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND COLUMN_NAME = 'old_value_json'
);
SET @msql_8 = IF(@mcol_8 = 0,
  'ALTER TABLE roster_decision_audit ADD COLUMN old_value_json      JSON          NULL COMMENT ''Before-state snapshot for change audit''
    AFTER override_reason',
  'SELECT "old_value_json already exists" AS message');
PREPARE mstmt_8 FROM @msql_8;
EXECUTE mstmt_8;
DEALLOCATE PREPARE mstmt_8;

SET @mcol_9 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND COLUMN_NAME = 'new_value_json'
);
SET @msql_9 = IF(@mcol_9 = 0,
  'ALTER TABLE roster_decision_audit ADD COLUMN new_value_json      JSON          NULL COMMENT ''After-state snapshot''
    AFTER old_value_json',
  'SELECT "new_value_json already exists" AS message');
PREPARE mstmt_9 FROM @msql_9;
EXECUTE mstmt_9;
DEALLOCATE PREPARE mstmt_9;

-- Index for week-level reporting
SET @midx_101 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_decision_audit' AND INDEX_NAME = 'idx_rda_process_week'
);
SET @midxsql_101 = IF(@midx_101 = 0,
  'ALTER TABLE roster_decision_audit ADD INDEX idx_rda_process_week (process_id, week_start_date)',
  'SELECT "idx_rda_process_week already exists" AS message');
PREPARE midxstmt_101 FROM @midxsql_101;
EXECUTE midxstmt_101;
DEALLOCATE PREPARE midxstmt_101;

SELECT '229_roster_decision_audit_extension.sql applied successfully' AS migration_status;
