-- ============================================================
-- Migration 234: CREATE process_weekoff_day_rule
--
-- Justified by audit finding: process_weekoff_capacity has NO min_hc
-- columns — it only stores max_weekoff_count and max_weekoff_percentage.
-- The auto week-off engine needs per-day minimum HC to do demand-
-- protection (i.e., "don't grant week-off on Monday if doing so would
-- drop HC below client projection").
--
-- This table does NOT replace process_weekoff_capacity.
-- process_weekoff_capacity = upper bound (max week-offs allowed)
-- process_weekoff_day_rule = lower bound (min HC required, policy flags)
--
-- Both tables are consulted by the auto week-off engine:
--   1. Check: allocated_count < process_weekoff_capacity.max_weekoff_count
--   2. Check: (rostered_hc - 1) >= process_weekoff_day_rule.min_hc_required_<day>
--   Both must pass for a week-off to be granted.
--
-- Per-week rows allow seasonal adjustment (e.g. higher min HC during
-- campaign peaks, lower during slow weeks).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS process_weekoff_day_rule;
-- ============================================================

CREATE TABLE IF NOT EXISTS process_weekoff_day_rule (
  id              VARCHAR(36)   NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      VARCHAR(36)   NOT NULL,
  branch_id       VARCHAR(36)   NULL     COMMENT 'NULL = applies to all branches',
  week_start_date DATE          NOT NULL COMMENT 'Monday of the roster week this rule governs',

  -- ── Per-day minimum HC required (demand protection) ───────────────────────
  -- These are FLOOR values: engine will not grant a week-off that would
  -- drop same-day scheduled HC below these numbers.
  min_hc_monday    INT NOT NULL DEFAULT 0,
  min_hc_tuesday   INT NOT NULL DEFAULT 0,
  min_hc_wednesday INT NOT NULL DEFAULT 0,
  min_hc_thursday  INT NOT NULL DEFAULT 0,
  min_hc_friday    INT NOT NULL DEFAULT 0,
  min_hc_saturday  INT NOT NULL DEFAULT 0,
  min_hc_sunday    INT NOT NULL DEFAULT 0,

  -- ── Per-day maximum week-offs (mirrors process_weekoff_capacity but
  --    allows week-specific overrides — when NULL, use process_weekoff_capacity) ─
  max_weekoff_monday    INT NULL,
  max_weekoff_tuesday   INT NULL,
  max_weekoff_wednesday INT NULL,
  max_weekoff_thursday  INT NULL,
  max_weekoff_friday    INT NULL,
  max_weekoff_saturday  INT NULL,
  max_weekoff_sunday    INT NULL,

  -- ── Policy flags ──────────────────────────────────────────────────────────
  weekend_weekoff_allowed       TINYINT(1) NOT NULL DEFAULT 1  COMMENT '0 = no Sat/Sun week-offs allowed',
  fcfs_enabled                  TINYINT(1) NOT NULL DEFAULT 1  COMMENT 'Use FCFS for preference tie-breaking',
  preference_priority_enabled   TINYINT(1) NOT NULL DEFAULT 1  COMMENT 'Submitted preferences get priority over auto-assign',
  fairness_rotation_enabled     TINYINT(1) NOT NULL DEFAULT 1  COMMENT 'Track last week-off day per employee for rotation fairness',
  skill_based_restriction_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Require skill check before granting week-off',
  manager_override_allowed      TINYINT(1) NOT NULL DEFAULT 1,
  employee_rejection_allowed    TINYINT(1) NOT NULL DEFAULT 1,
  force_approval_allowed        TINYINT(1) NOT NULL DEFAULT 1  COMMENT 'Manager can force-approve despite capacity rules',

  -- ── Metadata ──────────────────────────────────────────────────────────────
  notes       TEXT        NULL,
  created_by  VARCHAR(36) NULL,
  updated_by  VARCHAR(36) NULL,
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_pwdr_process_week (process_id, branch_id, week_start_date),
  INDEX idx_pwdr_process_week (process_id, week_start_date),
  CONSTRAINT fk_pwdr_process FOREIGN KEY (process_id)
    REFERENCES process_master(id) ON DELETE CASCADE,
  CONSTRAINT fk_pwdr_branch  FOREIGN KEY (branch_id)
    REFERENCES branch_master(id)  ON DELETE SET NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-week per-day minimum HC floor and week-off policy flags; consulted alongside process_weekoff_capacity';

-- ── Additional notification seeds ─────────────────────────────────────────────
-- New WFM notification templates for the demand-aware engine.
-- INSERT IGNORE is idempotent.

INSERT IGNORE INTO notification_template
  (id, template_code, template_name, subject_template, body_template, channel, category, active_status)
VALUES
  (UUID(), 'WEEKOFF_DEMAND_CONFLICT',
   'Week-Off: Demand Conflict', 'Your Week-Off Request Could Not Be Accommodated',
   'Hi {{employee_name}}, your preferred week-off for {{week_start_date}} ({{preferred_day}}) could not be granted as the process needs minimum {{min_hc_required}} staff on that day. An alternate day has been assigned: {{assigned_day}}.',
   'in_app', 'wfm', 1),

  (UUID(), 'WEEKOFF_ALTERNATE_ASSIGNED',
   'Week-Off: Alternate Day Assigned', 'Your Week-Off Has Been Assigned',
   'Hi {{employee_name}}, your week-off for week of {{week_start_date}} has been assigned on {{assigned_day}}. Your preferred day {{preferred_day}} was not available but this alternate meets process requirements.',
   'in_app', 'wfm', 1),

  (UUID(), 'WEEKOFF_NO_PREFERENCE_AUTO_ASSIGNED',
   'Week-Off Auto-Assigned', 'Your Week-Off Day Has Been Auto-Assigned',
   'Hi {{employee_name}}, no week-off preference was submitted for {{week_start_date}}. The system has auto-assigned your week-off to {{assigned_day}} based on process requirements and fairness rotation.',
   'in_app', 'wfm', 1),

  (UUID(), 'MANAGER_REALIGNMENT_DONE',
   'Roster Realigned by Manager', 'Your Roster Has Been Updated',
   'Hi {{employee_name}}, your reporting manager has realigned your week-off for {{week_start_date}} to {{new_day}}. Reason: {{reason}}.',
   'in_app', 'wfm', 1),

  (UUID(), 'MANAGER_FORCE_APPROVED',
   'Roster Force-Approved', 'Your Assigned Roster Has Been Confirmed',
   'Hi {{employee_name}}, your reporting manager has confirmed your assigned week-off ({{assigned_day}}) for {{week_start_date}}. Your rejection request has been reviewed. Reason: {{reason}}.',
   'in_app', 'wfm', 1),

  (UUID(), 'ROSTER_ESCALATED_TO_HR',
   'Roster Escalated to HR', 'Your Roster Dispute Has Been Escalated',
   'Hi {{employee_name}}, your roster dispute for {{week_start_date}} has been escalated to HR/WFM for review. You will be notified once a decision is made.',
   'in_app', 'wfm', 1),

  (UUID(), 'COVERAGE_SHORTAGE_ALERT',
   'WFM Alert: Coverage Shortage', 'Coverage Shortage Alert — {{process_name}} {{date}}',
   'WFM Alert: Process {{process_name}} on {{date}} has a coverage shortage. Required HC: {{required_hc}}, Scheduled HC: {{scheduled_hc}}, Gap: {{gap}}. Manager review required.',
   'in_app', 'wfm', 1),

  (UUID(), 'FINAL_ROSTER_PUBLISHED',
   'Final Roster Published', 'Roster Published for Week of {{week_start_date}}',
   'The final approved roster for week of {{week_start_date}} has been published to the live tracker. All planned assignments are now active for attendance tracking.',
   'in_app', 'wfm', 1);

SELECT '234_process_weekoff_day_rule.sql applied successfully' AS migration_status;
