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

  -- Dispute classification (NULL = plain regularization, value = formal dispute)
SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'dispute_type'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN dispute_type ENUM(
    ''missing_punch'',
    ''wrong_punch'',
    ''late_mark_dispute'',
    ''early_logout_dispute'',
    ''half_day_dispute'',
    ''absent_wrongly_marked'',
    ''week_off_worked'',
    ''holiday_worked'',
    ''shift_mismatch'',
    ''cosec_sync_issue'',
    ''manual_punch_correction''
  ) NULL COMMENT ''NULL = plain regularization; set = formal dispute type''',
  'SELECT "dispute_type already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

  -- Before-state capture (what the record shows before correction)
SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'old_status'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN old_status VARCHAR(50) NULL
    COMMENT ''attendance_status value before this regularization was raised''',
  'SELECT "old_status already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'new_status'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN new_status VARCHAR(50) NULL
    COMMENT ''requested final attendance_status (mirrors requested_status but VARCHAR for flexibility)''',
  'SELECT "new_status already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

SET @mcol_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'old_punch_in'
);
SET @msql_4 = IF(@mcol_4 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN old_punch_in  TIME NULL
    COMMENT ''Actual punch-in recorded before correction''',
  'SELECT "old_punch_in already exists" AS message');
PREPARE mstmt_4 FROM @msql_4;
EXECUTE mstmt_4;
DEALLOCATE PREPARE mstmt_4;

SET @mcol_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'old_punch_out'
);
SET @msql_5 = IF(@mcol_5 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN old_punch_out TIME NULL
    COMMENT ''Actual punch-out recorded before correction''',
  'SELECT "old_punch_out already exists" AS message');
PREPARE mstmt_5 FROM @msql_5;
EXECUTE mstmt_5;
DEALLOCATE PREPARE mstmt_5;

SET @mcol_6 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'new_punch_in'
);
SET @msql_6 = IF(@mcol_6 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN new_punch_in  TIME NULL
    COMMENT ''Corrected punch-in being requested''',
  'SELECT "new_punch_in already exists" AS message');
PREPARE mstmt_6 FROM @msql_6;
EXECUTE mstmt_6;
DEALLOCATE PREPARE mstmt_6;

SET @mcol_7 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'new_punch_out'
);
SET @msql_7 = IF(@mcol_7 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN new_punch_out TIME NULL
    COMMENT ''Corrected punch-out being requested''',
  'SELECT "new_punch_out already exists" AS message');
PREPARE mstmt_7 FROM @msql_7;
EXECUTE mstmt_7;
DEALLOCATE PREPARE mstmt_7;

  -- Payroll impact flags
SET @mcol_8 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'payroll_impact'
);
SET @msql_8 = IF(@mcol_8 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN payroll_impact TINYINT(1) NOT NULL DEFAULT 0
    COMMENT ''1 = this regularization changes payable days / LWP''',
  'SELECT "payroll_impact already exists" AS message');
PREPARE mstmt_8 FROM @msql_8;
EXECUTE mstmt_8;
DEALLOCATE PREPARE mstmt_8;

SET @mcol_9 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'payroll_head_approval_required'
);
SET @msql_9 = IF(@mcol_9 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN payroll_head_approval_required TINYINT(1) NOT NULL DEFAULT 0
    COMMENT ''1 = must reach Payroll Head before final approval''',
  'SELECT "payroll_head_approval_required already exists" AS message');
PREPARE mstmt_9 FROM @msql_9;
EXECUTE mstmt_9;
DEALLOCATE PREPARE mstmt_9;

SET @mcol_10 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'payroll_head_approved_by'
);
SET @msql_10 = IF(@mcol_10 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN payroll_head_approved_by  VARCHAR(36) NULL
    COMMENT ''auth_user.id of Payroll Head who gave final approval''',
  'SELECT "payroll_head_approved_by already exists" AS message');
PREPARE mstmt_10 FROM @msql_10;
EXECUTE mstmt_10;
DEALLOCATE PREPARE mstmt_10;

SET @mcol_11 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'payroll_head_approved_at'
);
SET @msql_11 = IF(@mcol_11 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN payroll_head_approved_at  DATETIME NULL
    COMMENT ''When Payroll Head gave final approval''',
  'SELECT "payroll_head_approved_at already exists" AS message');
PREPARE mstmt_11 FROM @msql_11;
EXECUTE mstmt_11;
DEALLOCATE PREPARE mstmt_11;

  -- Document attachment
SET @mcol_12 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'supporting_doc_id'
);
SET @msql_12 = IF(@mcol_12 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN supporting_doc_id VARCHAR(36) NULL
    COMMENT ''FK upload_batch.id or document reference for supporting evidence''',
  'SELECT "supporting_doc_id already exists" AS message');
PREPARE mstmt_12 FROM @msql_12;
EXECUTE mstmt_12;
DEALLOCATE PREPARE mstmt_12;

  -- Escalation tracking
SET @mcol_13 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'escalated_to'
);
SET @msql_13 = IF(@mcol_13 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN escalated_to VARCHAR(50) NULL
    COMMENT ''Which queue this was escalated to: hr | payroll_head | super_admin''',
  'SELECT "escalated_to already exists" AS message');
PREPARE mstmt_13 FROM @msql_13;
EXECUTE mstmt_13;
DEALLOCATE PREPARE mstmt_13;

SET @mcol_14 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'escalated_at'
);
SET @msql_14 = IF(@mcol_14 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN escalated_at DATETIME NULL',
  'SELECT "escalated_at already exists" AS message');
PREPARE mstmt_14 FROM @msql_14;
EXECUTE mstmt_14;
DEALLOCATE PREPARE mstmt_14;

SET @mcol_15 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'escalated_by'
);
SET @msql_15 = IF(@mcol_15 = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN escalated_by VARCHAR(36) NULL',
  'SELECT "escalated_by already exists" AS message');
PREPARE mstmt_15 FROM @msql_15;
EXECUTE mstmt_15;
DEALLOCATE PREPARE mstmt_15;

-- Index for dispute_type filtering
SET @midx_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND INDEX_NAME = 'idx_ar_dispute_type'
);
SET @midxsql_1 = IF(@midx_1 = 0,
  'CREATE INDEX idx_ar_dispute_type ON attendance_regularization(dispute_type)',
  'SELECT "idx_ar_dispute_type already exists" AS message');
PREPARE midxstmt_1 FROM @midxsql_1;
EXECUTE midxstmt_1;
DEALLOCATE PREPARE midxstmt_1;
SET @midx_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND INDEX_NAME = 'idx_ar_payroll_impact'
);
SET @midxsql_2 = IF(@midx_2 = 0,
  'CREATE INDEX idx_ar_payroll_impact ON attendance_regularization(payroll_impact)',
  'SELECT "idx_ar_payroll_impact already exists" AS message');
PREPARE midxstmt_2 FROM @midxsql_2;
EXECUTE midxstmt_2;
DEALLOCATE PREPARE midxstmt_2;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Extend attendance_daily_record
-- ═══════════════════════════════════════════════════════════════════════════════

  -- Capture the status BEFORE any override or regularization approval
SET @mcol_16 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'old_attendance_status'
);
SET @msql_16 = IF(@mcol_16 = 0,
  'ALTER TABLE attendance_daily_record ADD COLUMN old_attendance_status VARCHAR(50) NULL
    COMMENT ''attendance_status value captured before the last override/approval — for audit diff''',
  'SELECT "old_attendance_status already exists" AS message');
PREPARE mstmt_16 FROM @msql_16;
EXECUTE mstmt_16;
DEALLOCATE PREPARE mstmt_16;

SET @mcol_17 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'old_lwp_value'
);
SET @msql_17 = IF(@mcol_17 = 0,
  'ALTER TABLE attendance_daily_record ADD COLUMN old_lwp_value DECIMAL(4,2) NULL
    COMMENT ''lwp_value captured before the last override — for audit diff''',
  'SELECT "old_lwp_value already exists" AS message');
PREPARE mstmt_17 FROM @msql_17;
EXECUTE mstmt_17;
DEALLOCATE PREPARE mstmt_17;

  -- Traceable change metadata
SET @mcol_18 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'status_change_reason'
);
SET @msql_18 = IF(@mcol_18 = 0,
  'ALTER TABLE attendance_daily_record ADD COLUMN status_change_reason VARCHAR(500) NULL
    COMMENT ''Human-readable reason for the last status change''',
  'SELECT "status_change_reason already exists" AS message');
PREPARE mstmt_18 FROM @msql_18;
EXECUTE mstmt_18;
DEALLOCATE PREPARE mstmt_18;

SET @mcol_19 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'status_changed_by'
);
SET @msql_19 = IF(@mcol_19 = 0,
  'ALTER TABLE attendance_daily_record ADD COLUMN status_changed_by VARCHAR(36) NULL
    COMMENT ''auth_user.id who last changed the status (separate from override_by)''',
  'SELECT "status_changed_by already exists" AS message');
PREPARE mstmt_19 FROM @msql_19;
EXECUTE mstmt_19;
DEALLOCATE PREPARE mstmt_19;

SET @mcol_20 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'status_changed_at'
);
SET @msql_20 = IF(@mcol_20 = 0,
  'ALTER TABLE attendance_daily_record ADD COLUMN status_changed_at DATETIME NULL
    COMMENT ''When the status was last changed''',
  'SELECT "status_changed_at already exists" AS message');
PREPARE mstmt_20 FROM @msql_20;
EXECUTE mstmt_20;
DEALLOCATE PREPARE mstmt_20;

-- Index for audit queries on changed records
SET @midx_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_adr_status_changed'
);
SET @midxsql_3 = IF(@midx_3 = 0,
  'CREATE INDEX idx_adr_status_changed ON attendance_daily_record(status_changed_at)',
  'SELECT "idx_adr_status_changed already exists" AS message');
PREPARE midxstmt_3 FROM @midxsql_3;
EXECUTE midxstmt_3;
DEALLOCATE PREPARE midxstmt_3;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Extend sensitive_action_log
-- ═══════════════════════════════════════════════════════════════════════════════

  -- Structured before/after (replaces opaque change_summary for new code)
SET @mcol_21 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND COLUMN_NAME = 'old_value_json'
);
SET @msql_21 = IF(@mcol_21 = 0,
  'ALTER TABLE sensitive_action_log ADD COLUMN old_value_json JSON NULL
    COMMENT ''State before the action — structured, queryable''',
  'SELECT "old_value_json already exists" AS message');
PREPARE mstmt_21 FROM @msql_21;
EXECUTE mstmt_21;
DEALLOCATE PREPARE mstmt_21;

SET @mcol_22 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND COLUMN_NAME = 'new_value_json'
);
SET @msql_22 = IF(@mcol_22 = 0,
  'ALTER TABLE sensitive_action_log ADD COLUMN new_value_json JSON NULL
    COMMENT ''State after the action — structured, queryable''',
  'SELECT "new_value_json already exists" AS message');
PREPARE mstmt_22 FROM @msql_22;
EXECUTE mstmt_22;
DEALLOCATE PREPARE mstmt_22;

  -- Subject of the action (separate from actor)
SET @mcol_23 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND COLUMN_NAME = 'employee_id'
);
SET @msql_23 = IF(@mcol_23 = 0,
  'ALTER TABLE sensitive_action_log ADD COLUMN employee_id VARCHAR(36) NULL
    COMMENT ''Employee whose data was affected (not necessarily the actor)''',
  'SELECT "employee_id already exists" AS message');
PREPARE mstmt_23 FROM @msql_23;
EXECUTE mstmt_23;
DEALLOCATE PREPARE mstmt_23;

  -- Role context
SET @mcol_24 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND COLUMN_NAME = 'actor_role'
);
SET @msql_24 = IF(@mcol_24 = 0,
  'ALTER TABLE sensitive_action_log ADD COLUMN actor_role VARCHAR(50) NULL
    COMMENT ''Role of the actor at the time of action (admin, hr, wfm, manager, payroll_head…)''',
  'SELECT "actor_role already exists" AS message');
PREPARE mstmt_24 FROM @msql_24;
EXECUTE mstmt_24;
DEALLOCATE PREPARE mstmt_24;

  -- Mandatory reason for sensitive actions
SET @mcol_25 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND COLUMN_NAME = 'reason'
);
SET @msql_25 = IF(@mcol_25 = 0,
  'ALTER TABLE sensitive_action_log ADD COLUMN reason TEXT NULL
    COMMENT ''Reason provided by actor for sensitive/override actions''',
  'SELECT "reason already exists" AS message');
PREPARE mstmt_25 FROM @msql_25;
EXECUTE mstmt_25;
DEALLOCATE PREPARE mstmt_25;

-- Index for employee-centric audit queries
SET @midx_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND INDEX_NAME = 'idx_sal_employee'
);
SET @midxsql_4 = IF(@midx_4 = 0,
  'CREATE INDEX idx_sal_employee ON sensitive_action_log(employee_id)',
  'SELECT "idx_sal_employee already exists" AS message');
PREPARE midxstmt_4 FROM @midxsql_4;
EXECUTE midxstmt_4;
DEALLOCATE PREPARE midxstmt_4;
SET @midx_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensitive_action_log' AND INDEX_NAME = 'idx_sal_actor_role'
);
SET @midxsql_5 = IF(@midx_5 = 0,
  'CREATE INDEX idx_sal_actor_role ON sensitive_action_log(actor_role)',
  'SELECT "idx_sal_actor_role already exists" AS message');
PREPARE midxstmt_5 FROM @midxsql_5;
EXECUTE midxstmt_5;
DEALLOCATE PREPARE midxstmt_5;

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
