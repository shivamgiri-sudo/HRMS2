-- Migration 1006: Extend payroll_branch_readiness for process-level granularity
--
-- Strategy: add process_id (empty string = branch-level sentinel, existing rows unaffected)
-- and widen the unique key to (process_month, branch_id, process_id).
-- Also adds:
--   - attendance_data_ready: WFM manual declaration that attendance data is complete
--   - process_manager_signoff: process-level sign-off distinct from branch_head_signoff
--   - employee_count_active / employee_count_left: were in ensureTable() DDL but missing from .sql
--
-- FIXED 2026-08-13: `ADD COLUMN IF NOT EXISTS` / `ADD INDEX IF NOT EXISTS` is not accepted by
-- this server's MySQL 8.0.42 build — confirmed live, every variant (bare, with COMMENT, with
-- AFTER, multi-column) throws ER_PARSE_ERROR at the `IF NOT EXISTS` token itself, not a
-- semantic "already exists" error. That parse failure blocked production startup entirely
-- (STOP_ON_FIRST_FAILURE), since runPendingMigrations treats a failed migration as fatal.
-- All columns/indexes below were already present on the live table (added previously via
-- ensureTable()'s runtime DDL, per the original comment two lines up), so this rewrite only
-- had to become idempotent by construction — same information_schema-guard + PREPARE/EXECUTE
-- pattern the unique-key section below already used — not add anything new.
--
-- SAFE TO RE-RUN: every ADD is guarded by an information_schema existence check before the
-- dynamic ALTER runs, so this is a true no-op on a server where everything already exists.
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
SET @c_process_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'process_id'
);
SET @sql = IF(@c_process_id = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN process_id VARCHAR(36) NOT NULL DEFAULT '''' COMMENT ''Empty string = branch-level aggregate record. UUID = process-scoped record.'' AFTER branch_id',
  'SELECT "process_id already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_process_name = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'process_name'
);
SET @sql = IF(@c_process_name = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN process_name VARCHAR(255) NOT NULL DEFAULT '''' COMMENT ''Denormalised process name for display without JOIN'' AFTER process_id',
  'SELECT "process_name already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- index for process-scoped lookups
SET @i_process = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND INDEX_NAME = 'idx_pbr_process'
);
SET @sql = IF(@i_process = 0,
  'ALTER TABLE payroll_branch_readiness ADD INDEX idx_pbr_process (process_id)',
  'SELECT "idx_pbr_process already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. Add WFM attendance declaration columns ────────────────────────────────
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'attendance_data_ready');
SET @sql = IF(@c1 = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN attendance_data_ready TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''WFM manual declaration: attendance punching / regularisation complete for this process'' AFTER attendance_frozen_by',
  'SELECT "attendance_data_ready already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'attendance_data_ready_at');
SET @sql = IF(@c2 = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN attendance_data_ready_at DATETIME NULL AFTER attendance_data_ready',
  'SELECT "attendance_data_ready_at already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'attendance_data_ready_by');
SET @sql = IF(@c3 = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN attendance_data_ready_by VARCHAR(36) NULL AFTER attendance_data_ready_at',
  'SELECT "attendance_data_ready_by already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. Add process manager sign-off columns ──────────────────────────────────
SET @c4 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'process_manager_signoff');
SET @sql = IF(@c4 = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN process_manager_signoff TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''Process Manager sign-off for this process (distinct from branch_head_signoff)'' AFTER branch_head_remarks',
  'SELECT "process_manager_signoff already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c5 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'process_manager_signoff_at');
SET @sql = IF(@c5 = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN process_manager_signoff_at DATETIME NULL AFTER process_manager_signoff',
  'SELECT "process_manager_signoff_at already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c6 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'process_manager_signoff_by');
SET @sql = IF(@c6 = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN process_manager_signoff_by VARCHAR(36) NULL AFTER process_manager_signoff_at',
  'SELECT "process_manager_signoff_by already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c7 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'process_manager_remarks');
SET @sql = IF(@c7 = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN process_manager_remarks TEXT NULL AFTER process_manager_signoff_by',
  'SELECT "process_manager_remarks already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 4. Add employee_count_active / employee_count_left (were missing from .sql) ──
SET @c8 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'employee_count_active');
SET @sql = IF(@c8 = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN employee_count_active INT NOT NULL DEFAULT 0 AFTER employee_count',
  'SELECT "employee_count_active already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c9 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'employee_count_left');
SET @sql = IF(@c9 = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN employee_count_left INT NOT NULL DEFAULT 0 AFTER employee_count_active',
  'SELECT "employee_count_left already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

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
