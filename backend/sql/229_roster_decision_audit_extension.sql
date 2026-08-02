-- ============================================================
-- Migration 229: roster_decision_audit — extend decision_type ENUM
-- and add fairness/HR/audit trail columns required by the full
-- auto-roster engine spec.
--
-- SAFE: MODIFY COLUMN on ENUM is backward compatible — existing rows
-- keep their current values. ADD COLUMN for all new fields.
--
-- ROLLBACK:
--   The ENUM extension cannot be easily rolled back without a table rebuild.
--   Safe approach: the added values are never written until the new engine
--   code is deployed; removing the values before any rows use them is safe
--   via another MODIFY COLUMN reverting to the original ENUM.
--   ALTER TABLE roster_decision_audit
--     DROP COLUMN week_start_date,
--     DROP COLUMN process_id,
--     DROP COLUMN branch_id,
--     DROP COLUMN fairness_score,
--     DROP COLUMN fcfs_rank,
--     DROP COLUMN skill_check_result,
--     DROP COLUMN acted_by_role,
--     DROP COLUMN old_value_json,
--     DROP COLUMN new_value_json;
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
ALTER TABLE roster_decision_audit
  ADD COLUMN week_start_date     DATE          NULL COMMENT 'Roster week for cross-reference'
    AFTER cycle_id,
  ADD COLUMN process_id          VARCHAR(36)   NULL COMMENT 'Denormalised process for fast reporting'
    AFTER week_start_date,
  ADD COLUMN branch_id           VARCHAR(36)   NULL
    AFTER process_id,
  ADD COLUMN fairness_score      DECIMAL(5,2)  NULL COMMENT 'Rotation fairness score at time of decision (lower = due sooner)'
    AFTER rule_applied,
  ADD COLUMN fcfs_rank           INT           NULL COMMENT 'Employee FCFS position when preference was processed'
    AFTER fairness_score,
  ADD COLUMN skill_check_result  VARCHAR(100)  NULL COMMENT 'pass / fail:<reason> for skill/cert validation'
    AFTER fcfs_rank,
  ADD COLUMN acted_by_role       VARCHAR(50)   NULL COMMENT 'Role of the user who triggered this audit row'
    AFTER override_by,
  ADD COLUMN old_value_json      JSON          NULL COMMENT 'Before-state snapshot for change audit'
    AFTER override_reason,
  ADD COLUMN new_value_json      JSON          NULL COMMENT 'After-state snapshot'
    AFTER old_value_json;

-- Index for week-level reporting
ALTER TABLE roster_decision_audit
  ADD INDEX idx_rda_process_week (process_id, week_start_date);

SELECT '229_roster_decision_audit_extension.sql applied successfully' AS migration_status;
