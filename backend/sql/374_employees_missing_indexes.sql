-- Migration 374: Add missing indexes to employees table
--
-- The employees table has no indexes on department_id, designation_id,
-- reporting_manager_id, active_status, or employment_status.
-- Every employee-list query filtered by these columns causes a full table scan.
-- All statements use IF NOT EXISTS guards to be safe on re-runs.

-- ── department_id ─────────────────────────────────────────────────────────────
SET @s = IF(
  NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_emp_dept'
  ),
  'ALTER TABLE employees ADD INDEX idx_emp_dept (department_id)',
  'SELECT ''idx_emp_dept already exists'' AS migration_note'
);
PREPARE _stmt FROM @s; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ── designation_id ────────────────────────────────────────────────────────────
SET @s = IF(
  NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_emp_desig'
  ),
  'ALTER TABLE employees ADD INDEX idx_emp_desig (designation_id)',
  'SELECT ''idx_emp_desig already exists'' AS migration_note'
);
PREPARE _stmt FROM @s; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ── reporting_manager_id ──────────────────────────────────────────────────────
SET @s = IF(
  NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_emp_mgr'
  ),
  'ALTER TABLE employees ADD INDEX idx_emp_mgr (reporting_manager_id)',
  'SELECT ''idx_emp_mgr already exists'' AS migration_note'
);
PREPARE _stmt FROM @s; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ── active_status ─────────────────────────────────────────────────────────────
SET @s = IF(
  NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_emp_active'
  ),
  'ALTER TABLE employees ADD INDEX idx_emp_active (active_status)',
  'SELECT ''idx_emp_active already exists'' AS migration_note'
);
PREPARE _stmt FROM @s; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ── employment_status ─────────────────────────────────────────────────────────
SET @s = IF(
  NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_emp_empstatus'
  ),
  'ALTER TABLE employees ADD INDEX idx_emp_empstatus (employment_status)',
  'SELECT ''idx_emp_empstatus already exists'' AS migration_note'
);
PREPARE _stmt FROM @s; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ── Composite index for common list query: active employees by branch ─────────
SET @s = IF(
  NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_emp_branch_active'
  ),
  'ALTER TABLE employees ADD INDEX idx_emp_branch_active (branch_id, active_status)',
  'SELECT ''idx_emp_branch_active already exists'' AS migration_note'
);
PREPARE _stmt FROM @s; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;
