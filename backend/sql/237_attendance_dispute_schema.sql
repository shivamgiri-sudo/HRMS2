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
  ADD COLUMN dispute_type ENUM(
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
  ADD COLUMN old_status VARCHAR(50) NULL
    COMMENT 'attendance_status value before this regularization was raised',
  ADD COLUMN new_status VARCHAR(50) NULL
    COMMENT 'requested final attendance_status (mirrors requested_status but VARCHAR for flexibility)',
  ADD COLUMN old_punch_in  TIME NULL
    COMMENT 'Actual punch-in recorded before correction',
  ADD COLUMN old_punch_out TIME NULL
    COMMENT 'Actual punch-out recorded before correction',
  ADD COLUMN new_punch_in  TIME NULL
    COMMENT 'Corrected punch-in being requested',
  ADD COLUMN new_punch_out TIME NULL
    COMMENT 'Corrected punch-out being requested',

  -- Payroll impact flags
  ADD COLUMN payroll_impact TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = this regularization changes payable days / LWP',
  ADD COLUMN payroll_head_approval_required TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = must reach Payroll Head before final approval',
  ADD COLUMN payroll_head_approved_by  VARCHAR(36) NULL
    COMMENT 'auth_user.id of Payroll Head who gave final approval',
  ADD COLUMN payroll_head_approved_at  DATETIME NULL
    COMMENT 'When Payroll Head gave final approval',

  -- Document attachment
  ADD COLUMN supporting_doc_id VARCHAR(36) NULL
    COMMENT 'FK upload_batch.id or document reference for supporting evidence',

  -- Escalation tracking
  ADD COLUMN escalated_to VARCHAR(50) NULL
    COMMENT 'Which queue this was escalated to: hr | payroll_head | super_admin',
  ADD COLUMN escalated_at DATETIME NULL,
  ADD COLUMN escalated_by VARCHAR(36) NULL;

-- Index for dispute_type filtering
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_ar_dispute_type = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND INDEX_NAME = 'idx_ar_dispute_type'
);
SET @col_idx_ar_dispute_type = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME IN ('dispute_type')
);
SET @sql = IF(@idx_idx_ar_dispute_type = 0 AND @col_idx_ar_dispute_type = 1,
  'CREATE INDEX idx_ar_dispute_type ON attendance_regularization (dispute_type)',
  'SELECT ''idx_ar_dispute_type skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_ar_payroll_impact = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND INDEX_NAME = 'idx_ar_payroll_impact'
);
SET @col_idx_ar_payroll_impact = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME IN ('payroll_impact')
);
SET @sql = IF(@idx_idx_ar_payroll_impact = 0 AND @col_idx_ar_payroll_impact = 1,
  'CREATE INDEX idx_ar_payroll_impact ON attendance_regularization (payroll_impact)',
  'SELECT ''idx_ar_payroll_impact skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Extend attendance_daily_record
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE attendance_daily_record
  -- Capture the status BEFORE any override or regularization approval
  ADD COLUMN old_attendance_status VARCHAR(50) NULL
    COMMENT 'attendance_status value captured before the last override/approval — for audit diff',
  ADD COLUMN old_lwp_value DECIMAL(4,2) NULL
    COMMENT 'lwp_value captured before the last override — for audit diff',

  -- Traceable change metadata
  ADD COLUMN status_change_reason VARCHAR(500) NULL
    COMMENT 'Human-readable reason for the last status change',
  ADD COLUMN status_changed_by VARCHAR(36) NULL
    COMMENT 'auth_user.id who last changed the status (separate from override_by)',
  ADD COLUMN status_changed_at DATETIME NULL
    COMMENT 'When the status was last changed';

-- Index for audit queries on changed records
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_adr_status_changed = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_adr_status_changed'
);
SET @col_idx_adr_status_changed = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME IN ('status_changed_at')
);
SET @sql = IF(@idx_idx_adr_status_changed = 0 AND @col_idx_adr_status_changed = 1,
  'CREATE INDEX idx_adr_status_changed ON attendance_daily_record (status_changed_at)',
  'SELECT ''idx_adr_status_changed skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Extend sensitive_action_log
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE sensitive_action_log
  -- Structured before/after (replaces opaque change_summary for new code)
  ADD COLUMN old_value_json JSON NULL
    COMMENT 'State before the action — structured, queryable',
  ADD COLUMN new_value_json JSON NULL
    COMMENT 'State after the action — structured, queryable',

  -- Subject of the action (separate from actor)
  ADD COLUMN employee_id VARCHAR(36) NULL
    COMMENT 'Employee whose data was affected (not necessarily the actor)',

  -- Role context
  ADD COLUMN actor_role VARCHAR(50) NULL
    COMMENT 'Role of the actor at the time of action (admin, hr, wfm, manager, payroll_head…)',

  -- Mandatory reason for sensitive actions
  ADD COLUMN reason TEXT NULL
    COMMENT 'Reason provided by actor for sensitive/override actions';

-- Index for employee-centric audit queries
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_sal_employee = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND INDEX_NAME = 'idx_sal_employee'
);
SET @col_idx_sal_employee = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND COLUMN_NAME IN ('employee_id')
);
SET @sql = IF(@idx_idx_sal_employee = 0 AND @col_idx_sal_employee = 1,
  'CREATE INDEX idx_sal_employee ON sensitive_action_log (employee_id)',
  'SELECT ''idx_sal_employee skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_sal_actor_role = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND INDEX_NAME = 'idx_sal_actor_role'
);
SET @col_idx_sal_actor_role = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND COLUMN_NAME IN ('actor_role')
);
SET @sql = IF(@idx_idx_sal_actor_role = 0 AND @col_idx_sal_actor_role = 1,
  'CREATE INDEX idx_sal_actor_role ON sensitive_action_log (actor_role)',
  'SELECT ''idx_sal_actor_role skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- Run these statements in reverse order to undo migration 237.
-- Safe only if no production rows depend on the new columns.
-- ═══════════════════════════════════════════════════════════════════════════════
/*
-- 3. Revert sensitive_action_log
DROP INDEX idx_sal_employee ON sensitive_action_log;
DROP INDEX idx_sal_actor_role ON sensitive_action_log;
ALTER TABLE sensitive_action_log
  DROP COLUMN old_value_json,
  DROP COLUMN new_value_json,
  DROP COLUMN employee_id,
  DROP COLUMN actor_role,
  DROP COLUMN reason;

-- 2. Revert attendance_daily_record
DROP INDEX idx_adr_status_changed ON attendance_daily_record;
ALTER TABLE attendance_daily_record
  DROP COLUMN old_attendance_status,
  DROP COLUMN old_lwp_value,
  DROP COLUMN status_change_reason,
  DROP COLUMN status_changed_by,
  DROP COLUMN status_changed_at;

-- 1. Revert attendance_regularization
DROP INDEX idx_ar_dispute_type ON attendance_regularization;
DROP INDEX idx_ar_payroll_impact ON attendance_regularization;
ALTER TABLE attendance_regularization
  DROP COLUMN dispute_type,
  DROP COLUMN old_status,
  DROP COLUMN new_status,
  DROP COLUMN old_punch_in,
  DROP COLUMN old_punch_out,
  DROP COLUMN new_punch_in,
  DROP COLUMN new_punch_out,
  DROP COLUMN payroll_impact,
  DROP COLUMN payroll_head_approval_required,
  DROP COLUMN payroll_head_approved_by,
  DROP COLUMN payroll_head_approved_at,
  DROP COLUMN supporting_doc_id,
  DROP COLUMN escalated_to,
  DROP COLUMN escalated_at,
  DROP COLUMN escalated_by;
*/
