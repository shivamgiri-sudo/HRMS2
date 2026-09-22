-- 1842_employee_master_report_window_function_indexes.sql
--
-- Speeds up the Employee Master report (employee.executor.ts, the full
-- unfiltered export) — measured live 2026-09-22 running for over 8 minutes
-- and saturating the shared MySQL server enough to slow down every other
-- concurrent query on the box (including four unrelated pages just fixed for
-- speed in the same session).
--
-- The report's main query LEFT JOINs ~9 derived tables, several shaped as
--   SELECT ..., ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY <cols>) AS rn
--   FROM <table>
-- to pick the latest row per employee (nominee, education, salary
-- assignment). Each of those tables only carried a bare INDEX(employee_id) —
-- enough to look up one employee's rows, but not to satisfy the window
-- function's PARTITION BY + ORDER BY, so MySQL had to read and sort the
-- WHOLE table before it could apply the window function at all, on every
-- run, regardless of how few employees actually matched the report's
-- filters. Adding employee_id + the window's own ORDER BY columns as one
-- composite index lets MySQL walk each table already grouped and ordered
-- per employee ("index for group order"), eliminating that sort.
--
-- (Two structurally identical joins — employee_experience and
-- employee_client_mapping — are UNIQUE on employee_id already: at most one
-- row per employee, so the window function there is free and needs no new
-- index. exit_request's correlated subquery already has INDEX(employee_id)
-- and a small per-employee row count, so it isn't touched either.)
--
-- Idempotent (checks information_schema, whose column values are UPPERCASE
-- on mysql2) and additive: no column, no data and no existing index is
-- touched. Standard InnoDB secondary-index add, ONLINE by default on MySQL 8
-- (ALGORITHM=INPLACE, LOCK=NONE).
--
-- Owner approved 2026-09-22, after being shown the live 8+ minute run.

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_nominee'
    AND INDEX_NAME = 'idx_nominee_emp_latest'
);
SET @sql = IF(
  @idx = 0,
  'CREATE INDEX idx_nominee_emp_latest ON employee_nominee (employee_id, created_at DESC, id DESC)',
  'SELECT ''idx_nominee_emp_latest already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_education'
    AND INDEX_NAME = 'idx_emp_education_latest'
);
SET @sql = IF(
  @idx = 0,
  'CREATE INDEX idx_emp_education_latest ON employee_education (employee_id, created_at DESC, id DESC)',
  'SELECT ''idx_emp_education_latest already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_salary_assignment'
    AND INDEX_NAME = 'idx_esa_emp_active_effdate'
);
SET @sql = IF(
  @idx = 0,
  'CREATE INDEX idx_esa_emp_active_effdate ON employee_salary_assignment (employee_id, active_status, effective_from DESC)',
  'SELECT ''idx_esa_emp_active_effdate already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1842_employee_master_report_window_function_indexes.sql applied' AS migration_status;
