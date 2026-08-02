-- Migration 550: Performance indexes for Attendance Hub (/hr/attendance-lookup)
-- Fixes slow loading issue caused by full table scans on large attendance data

-- Index 1: Composite index for attendance_daily_record monthly aggregation
-- Covers the date range filter (record_date BETWEEN) and GROUP BY employee_id
-- Speedup: Converts full table scan to index range scan
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_adr_record_date_employee = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_adr_record_date_employee'
);
SET @sql = IF(@idx_idx_adr_record_date_employee = 0,
  'CREATE INDEX idx_adr_record_date_employee ON attendance_daily_record (record_date, employee_id)',
  'SELECT ''idx_adr_record_date_employee already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index 2: Additional covering index for attendance aggregation with status
-- Covers common WHERE clauses in attendance queries
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_adr_employee_date_status = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_adr_employee_date_status'
);
SET @sql = IF(@idx_idx_adr_employee_date_status = 0,
  'CREATE INDEX idx_adr_employee_date_status ON attendance_daily_record (employee_id, record_date, attendance_status)',
  'SELECT ''idx_adr_employee_date_status already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index 3: Composite index for salary_prep_line latest salary lookups
-- Covers the LATERAL join in hr-hub query (employee_id + ORDER BY run_id)
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_spl_employee_run = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND INDEX_NAME = 'idx_spl_employee_run'
);
SET @sql = IF(@idx_idx_spl_employee_run = 0,
  'CREATE INDEX idx_spl_employee_run ON salary_prep_line (employee_id, run_id)',
  'SELECT ''idx_spl_employee_run already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index 4: Index on salary_prep_run for month sorting
-- Speeds up ORDER BY run_month DESC in salary subquery
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_spr_run_month_created = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND INDEX_NAME = 'idx_spr_run_month_created'
);
SET @sql = IF(@idx_idx_spr_run_month_created = 0,
  'CREATE INDEX idx_spr_run_month_created ON salary_prep_run (run_month DESC, created_at DESC)',
  'SELECT ''idx_spr_run_month_created already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index 5: Employee full_name for search optimization
-- Speeds up LIKE '%search%' queries on employee names
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_employees_full_name = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_employees_full_name'
);
SET @sql = IF(@idx_idx_employees_full_name = 0,
  'CREATE INDEX idx_employees_full_name ON employees (full_name)',
  'SELECT ''idx_employees_full_name already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index 6: Employee code for search optimization
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_employees_code = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_employees_code'
);
SET @sql = IF(@idx_idx_employees_code = 0,
  'CREATE INDEX idx_employees_code ON employees (employee_code)',
  'SELECT ''idx_employees_code already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Attendance Hub performance indexes created successfully' AS status;
