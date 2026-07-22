-- Migration 1006: Extend payroll_branch_readiness for process-level granularity
--
-- Strategy: add process_id (empty string = branch-level sentinel, existing rows unaffected)
-- and widen the unique key to (process_month, branch_id, process_id).
-- Also adds:
--   - attendance_data_ready: WFM manual declaration that attendance data is complete
--   - process_manager_signoff: process-level sign-off distinct from branch_head_signoff
--   - employee_count_active / employee_count_left: were in ensureTable() DDL but missing from .sql
--
-- SAFE TO RE-RUN: all ADD COLUMN steps are guarded with IF NOT EXISTS where supported,
-- or wrapped in IF blocks. DROP/ADD index is idempotent via the guard below.
--
-- ROLLBACK (additive — restore original state):
--   ALTER TABLE payroll_branch_readiness
--     DROP COLUMN process_id, DROP COLUMN process_name,
--     DROP COLUMN attendance_data_ready, DROP COLUMN attendance_data_ready_at,
--     DROP COLUMN attendance_data_ready_by,
--     DROP COLUMN process_manager_signoff, DROP COLUMN process_manager_signoff_at,
--     DROP COLUMN process_manager_signoff_by, DROP COLUMN process_manager_remarks;
--   ALTER TABLE payroll_branch_readiness DROP INDEX uk_readiness_month_branch_process;
--   ALTER TABLE payroll_branch_readiness ADD UNIQUE KEY uk_readiness_month_branch (process_month, branch_id);

-- ── 1. Add process_id / process_name ────────────────────────────────────────
ALTER TABLE payroll_branch_readiness
  ADD COLUMN IF NOT EXISTS process_id   VARCHAR(36)  NOT NULL DEFAULT ''
    COMMENT 'Empty string = branch-level aggregate record. UUID = process-scoped record.'
    AFTER branch_id,
  ADD COLUMN IF NOT EXISTS process_name VARCHAR(255) NOT NULL DEFAULT ''
    COMMENT 'Denormalised process name for display without JOIN'
    AFTER process_id;

-- index for process-scoped lookups
ALTER TABLE payroll_branch_readiness
  ADD INDEX IF NOT EXISTS idx_pbr_process (process_id);

-- ── 2. Add WFM attendance declaration columns ────────────────────────────────
ALTER TABLE payroll_branch_readiness
  ADD COLUMN IF NOT EXISTS attendance_data_ready    TINYINT(1)  NOT NULL DEFAULT 0
    COMMENT 'WFM manual declaration: attendance punching / regularisation complete for this process'
    AFTER attendance_frozen_by,
  ADD COLUMN IF NOT EXISTS attendance_data_ready_at DATETIME    NULL
    AFTER attendance_data_ready,
  ADD COLUMN IF NOT EXISTS attendance_data_ready_by VARCHAR(36) NULL
    AFTER attendance_data_ready_at;

-- ── 3. Add process manager sign-off columns ──────────────────────────────────
ALTER TABLE payroll_branch_readiness
  ADD COLUMN IF NOT EXISTS process_manager_signoff    TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Process Manager sign-off for this process (distinct from branch_head_signoff)'
    AFTER branch_head_remarks,
  ADD COLUMN IF NOT EXISTS process_manager_signoff_at DATETIME    NULL
    AFTER process_manager_signoff,
  ADD COLUMN IF NOT EXISTS process_manager_signoff_by VARCHAR(36) NULL
    AFTER process_manager_signoff_at,
  ADD COLUMN IF NOT EXISTS process_manager_remarks    TEXT        NULL
    AFTER process_manager_signoff_by;

-- ── 4. Add employee_count_active / employee_count_left (were missing from .sql) ──
ALTER TABLE payroll_branch_readiness
  ADD COLUMN IF NOT EXISTS employee_count_active INT NOT NULL DEFAULT 0
    AFTER employee_count,
  ADD COLUMN IF NOT EXISTS employee_count_left   INT NOT NULL DEFAULT 0
    AFTER employee_count_active;

-- ── 5. Widen the unique key to include process_id ───────────────────────────
-- Drop the old 2-column key if it still exists, then add the 3-column key.
SET @ck_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'payroll_branch_readiness'
    AND INDEX_NAME   = 'uk_readiness_month_branch'
);
SET @drop_sql = IF(@ck_exists > 0,
  'ALTER TABLE payroll_branch_readiness DROP INDEX uk_readiness_month_branch',
  'SELECT "uk_readiness_month_branch already removed" AS info'
);
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ck3_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'payroll_branch_readiness'
    AND INDEX_NAME   = 'uk_readiness_month_branch_process'
);
SET @add_sql = IF(@ck3_exists = 0,
  'ALTER TABLE payroll_branch_readiness ADD UNIQUE KEY uk_readiness_month_branch_process (process_month, branch_id, process_id)',
  'SELECT "uk_readiness_month_branch_process already exists" AS info'
);
PREPARE stmt FROM @add_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1006_payroll_process_readiness_extend.sql applied successfully' AS migration_status;
