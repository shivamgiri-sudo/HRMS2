-- ============================================================
-- Migration 228: wfm_roster_assignment — full lifecycle status columns
--
-- Adds employee acknowledgement, manager action, and RTA publish
-- tracking directly to the operational roster assignment table.
-- This table becomes the single source of truth for RTA state.
--
-- SAFE: All ADD COLUMN IF NOT EXISTS, all nullable or have safe defaults.
-- Existing rows: all new status columns default to NULL / 'pending' /
--   'generated' — engine and RTA sync guard handle NULL as legacy draft.
--
-- ROLLBACK:
--   ALTER TABLE wfm_roster_assignment
--     DROP COLUMN IF EXISTS cycle_id,
--     DROP COLUMN IF EXISTS shift_template_id,
--     DROP COLUMN IF EXISTS is_week_off,
--     DROP COLUMN IF EXISTS final_roster_status,
--     DROP COLUMN IF EXISTS employee_ack_status,
--     DROP COLUMN IF EXISTS employee_ack_at,
--     DROP COLUMN IF EXISTS employee_rejection_reason,
--     DROP COLUMN IF EXISTS manager_action_status,
--     DROP COLUMN IF EXISTS manager_action_by,
--     DROP COLUMN IF EXISTS manager_action_at,
--     DROP COLUMN IF EXISTS manager_action_reason,
--     DROP COLUMN IF EXISTS system_decision_reason,
--     DROP COLUMN IF EXISTS published_to_rta_at;
--   DROP INDEX IF EXISTS idx_wra_cycle ON wfm_roster_assignment;
--   DROP INDEX IF EXISTS idx_wra_final_status ON wfm_roster_assignment;
--   DROP INDEX IF EXISTS idx_wra_ack_status ON wfm_roster_assignment;
-- ============================================================

ALTER TABLE wfm_roster_assignment
  -- Link to governance cycle (roster_daily_assignment is the governance table;
  -- this FK gives us the cross-reference without duplicating data)
  ADD COLUMN IF NOT EXISTS cycle_id          VARCHAR(36)  NULL COMMENT 'FK weekly_roster_cycle.id — set when assignment originates from a cycle'
    AFTER plan_id,

  -- Shift template reference (wfm_shift_template) in addition to legacy shift_id (wfm_shift_master)
  ADD COLUMN IF NOT EXISTS shift_template_id VARCHAR(36)  NULL COMMENT 'FK wfm_shift_template.id — preferred over shift_id for new assignments'
    AFTER cycle_id,

  -- Week-off flag
  ADD COLUMN IF NOT EXISTS is_week_off       TINYINT(1)   NOT NULL DEFAULT 0
    AFTER shift_template_id,

  -- ── Final lifecycle status (source of truth for RTA) ──────────────────────
  ADD COLUMN IF NOT EXISTS final_roster_status ENUM(
    'generated',
    'pending_employee_ack',
    'acknowledged',
    'rejected_by_employee',
    'pending_manager_action',
    'realigned_by_manager',
    'force_approved_by_manager',
    'escalated_to_hr',
    'approved_final',
    'published_to_rta'
  ) NOT NULL DEFAULT 'generated'
  COMMENT 'Lifecycle status — RTA must only consume approved_final / force_approved_by_manager / realigned_by_manager / published_to_rta',

  -- ── Employee acknowledgement ───────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS employee_ack_status       ENUM('pending','acknowledged','rejected')
                                                     NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS employee_ack_at           DATETIME     NULL,
  ADD COLUMN IF NOT EXISTS employee_rejection_reason VARCHAR(500) NULL,

  -- ── Manager action ─────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS manager_action_status     ENUM(
    'pending','realigned','force_approved','escalated','rejected_request'
  ) NULL,
  ADD COLUMN IF NOT EXISTS manager_action_by         VARCHAR(36)  NULL COMMENT 'auth_user.id who acted',
  ADD COLUMN IF NOT EXISTS manager_action_at         DATETIME     NULL,
  ADD COLUMN IF NOT EXISTS manager_action_reason     VARCHAR(500) NULL,

  -- ── System / engine metadata ───────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS system_decision_reason    VARCHAR(500) NULL COMMENT 'Why the engine made this assignment',
  ADD COLUMN IF NOT EXISTS published_to_rta_at       DATETIME     NULL;

-- Indexes for RTA sync and manager review queue
ALTER TABLE wfm_roster_assignment
  ADD INDEX IF NOT EXISTS idx_wra_cycle        (cycle_id),
  ADD INDEX IF NOT EXISTS idx_wra_final_status (final_roster_status),
  ADD INDEX IF NOT EXISTS idx_wra_ack_status   (employee_ack_status);

SELECT '228_wfm_roster_assignment_lifecycle.sql applied successfully' AS migration_status;
