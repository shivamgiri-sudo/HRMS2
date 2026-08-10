-- Migration 237: Attendance Dispute / Regularization Schema Extension
-- Purpose: Extend attendance_regularization, attendance_daily_record, and
--          sensitive_action_log to support structured dispute tracking,
--          punch history, payroll impact, and structured audit fields.
-- Risk: LOW — additive only. No existing columns removed or renamed.
--       No data changed. All new columns are nullable or have safe defaults.
-- Requires: MySQL 8.0.16+ (ADD COLUMN IF NOT EXISTS)
-- Rollback: See ROLLBACK section at bottom.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Extend attendance_regularization
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE attendance_regularization
  -- Dispute classification (NULL = plain regularization, value = formal dispute)
  ADD COLUMN IF NOT EXISTS dispute_type ENUM(
    'missing_punch',
    'wrong_punch',
    'late_mark_dispute',
    'early_logout_dispute',
    'half_day_dispute',
    'absent_wrongly_marked',
    'week_off_worked',
    'holiday_worked',
    'shift_mismatch',
    'cosec_sync_issue',
    'manual_punch_correction'
  ) NULL COMMENT 'NULL = plain regularization; set = formal dispute type',

  -- Before-state capture (what the record shows before correction)
  ADD COLUMN IF NOT EXISTS old_status VARCHAR(50) NULL
    COMMENT 'attendance_status value before this regularization was raised',
  ADD COLUMN IF NOT EXISTS new_status VARCHAR(50) NULL
    COMMENT 'requested final attendance_status (mirrors requested_status but VARCHAR for flexibility)',
  ADD COLUMN IF NOT EXISTS old_punch_in  TIME NULL
    COMMENT 'Actual punch-in recorded before correction',
  ADD COLUMN IF NOT EXISTS old_punch_out TIME NULL
    COMMENT 'Actual punch-out recorded before correction',
  ADD COLUMN IF NOT EXISTS new_punch_in  TIME NULL
    COMMENT 'Corrected punch-in being requested',
  ADD COLUMN IF NOT EXISTS new_punch_out TIME NULL
    COMMENT 'Corrected punch-out being requested',

  -- Payroll impact flags
  ADD COLUMN IF NOT EXISTS payroll_impact TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = this regularization changes payable days / LWP',
  ADD COLUMN IF NOT EXISTS payroll_head_approval_required TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = must reach Payroll Head before final approval',
  ADD COLUMN IF NOT EXISTS payroll_head_approved_by  VARCHAR(36) NULL
    COMMENT 'auth_user.id of Payroll Head who gave final approval',
  ADD COLUMN IF NOT EXISTS payroll_head_approved_at  DATETIME NULL
    COMMENT 'When Payroll Head gave final approval',

  -- Document attachment
  ADD COLUMN IF NOT EXISTS supporting_doc_id VARCHAR(36) NULL
    COMMENT 'FK upload_batch.id or document reference for supporting evidence',

  -- Escalation tracking
  ADD COLUMN IF NOT EXISTS escalated_to VARCHAR(50) NULL
    COMMENT 'Which queue this was escalated to: hr | payroll_head | super_admin',
  ADD COLUMN IF NOT EXISTS escalated_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS escalated_by VARCHAR(36) NULL;

-- Index for dispute_type filtering
CREATE INDEX IF NOT EXISTS idx_ar_dispute_type ON attendance_regularization(dispute_type);
CREATE INDEX IF NOT EXISTS idx_ar_payroll_impact ON attendance_regularization(payroll_impact);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Extend attendance_daily_record
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE attendance_daily_record
  -- Capture the status BEFORE any override or regularization approval
  ADD COLUMN IF NOT EXISTS old_attendance_status VARCHAR(50) NULL
    COMMENT 'attendance_status value captured before the last override/approval — for audit diff',
  ADD COLUMN IF NOT EXISTS old_lwp_value DECIMAL(4,2) NULL
    COMMENT 'lwp_value captured before the last override — for audit diff',

  -- Traceable change metadata
  ADD COLUMN IF NOT EXISTS status_change_reason VARCHAR(500) NULL
    COMMENT 'Human-readable reason for the last status change',
  ADD COLUMN IF NOT EXISTS status_changed_by VARCHAR(36) NULL
    COMMENT 'auth_user.id who last changed the status (separate from override_by)',
  ADD COLUMN IF NOT EXISTS status_changed_at DATETIME NULL
    COMMENT 'When the status was last changed';

-- Index for audit queries on changed records
CREATE INDEX IF NOT EXISTS idx_adr_status_changed ON attendance_daily_record(status_changed_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Extend sensitive_action_log
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE sensitive_action_log
  -- Structured before/after (replaces opaque change_summary for new code)
  ADD COLUMN IF NOT EXISTS old_value_json JSON NULL
    COMMENT 'State before the action — structured, queryable',
  ADD COLUMN IF NOT EXISTS new_value_json JSON NULL
    COMMENT 'State after the action — structured, queryable',

  -- Subject of the action (separate from actor)
  ADD COLUMN IF NOT EXISTS employee_id VARCHAR(36) NULL
    COMMENT 'Employee whose data was affected (not necessarily the actor)',

  -- Role context
  ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50) NULL
    COMMENT 'Role of the actor at the time of action (admin, hr, wfm, manager, payroll_head…)',

  -- Mandatory reason for sensitive actions
  ADD COLUMN IF NOT EXISTS reason TEXT NULL
    COMMENT 'Reason provided by actor for sensitive/override actions';

-- Index for employee-centric audit queries
CREATE INDEX IF NOT EXISTS idx_sal_employee ON sensitive_action_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_sal_actor_role ON sensitive_action_log(actor_role);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- Run these statements in reverse order to undo migration 237.
-- Safe only if no production rows depend on the new columns.
-- ═══════════════════════════════════════════════════════════════════════════════
/*
-- 3. Revert sensitive_action_log
DROP INDEX IF EXISTS idx_sal_employee ON sensitive_action_log;
DROP INDEX IF EXISTS idx_sal_actor_role ON sensitive_action_log;
ALTER TABLE sensitive_action_log
  DROP COLUMN IF EXISTS old_value_json,
  DROP COLUMN IF EXISTS new_value_json,
  DROP COLUMN IF EXISTS employee_id,
  DROP COLUMN IF EXISTS actor_role,
  DROP COLUMN IF EXISTS reason;

-- 2. Revert attendance_daily_record
DROP INDEX IF EXISTS idx_adr_status_changed ON attendance_daily_record;
ALTER TABLE attendance_daily_record
  DROP COLUMN IF EXISTS old_attendance_status,
  DROP COLUMN IF EXISTS old_lwp_value,
  DROP COLUMN IF EXISTS status_change_reason,
  DROP COLUMN IF EXISTS status_changed_by,
  DROP COLUMN IF EXISTS status_changed_at;

-- 1. Revert attendance_regularization
DROP INDEX IF EXISTS idx_ar_dispute_type ON attendance_regularization;
DROP INDEX IF EXISTS idx_ar_payroll_impact ON attendance_regularization;
ALTER TABLE attendance_regularization
  DROP COLUMN IF EXISTS dispute_type,
  DROP COLUMN IF EXISTS old_status,
  DROP COLUMN IF EXISTS new_status,
  DROP COLUMN IF EXISTS old_punch_in,
  DROP COLUMN IF EXISTS old_punch_out,
  DROP COLUMN IF EXISTS new_punch_in,
  DROP COLUMN IF EXISTS new_punch_out,
  DROP COLUMN IF EXISTS payroll_impact,
  DROP COLUMN IF EXISTS payroll_head_approval_required,
  DROP COLUMN IF EXISTS payroll_head_approved_by,
  DROP COLUMN IF EXISTS payroll_head_approved_at,
  DROP COLUMN IF EXISTS supporting_doc_id,
  DROP COLUMN IF EXISTS escalated_to,
  DROP COLUMN IF EXISTS escalated_at,
  DROP COLUMN IF EXISTS escalated_by;
*/
