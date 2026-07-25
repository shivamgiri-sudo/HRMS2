-- Migration 550: Performance indexes for Attendance Hub (/hr/attendance-lookup)
-- Fixes slow loading issue caused by full table scans on large attendance data

-- Index 1: Composite index for attendance_daily_record monthly aggregation
-- Covers the date range filter (record_date BETWEEN) and GROUP BY employee_id
-- Speedup: Converts full table scan to index range scan
CREATE INDEX IF NOT EXISTS idx_adr_record_date_employee
  ON attendance_daily_record(record_date, employee_id);

-- Index 2: Additional covering index for attendance aggregation with status
-- Covers common WHERE clauses in attendance queries
CREATE INDEX IF NOT EXISTS idx_adr_employee_date_status
  ON attendance_daily_record(employee_id, record_date, attendance_status);

-- Index 3: Composite index for salary_prep_line latest salary lookups
-- Covers the LATERAL join in hr-hub query (employee_id + ORDER BY run_id)
CREATE INDEX IF NOT EXISTS idx_spl_employee_run
  ON salary_prep_line(employee_id, run_id);

-- Index 4: Index on salary_prep_run for month sorting
-- Speeds up ORDER BY run_month DESC in salary subquery
CREATE INDEX IF NOT EXISTS idx_spr_run_month_created
  ON salary_prep_run(run_month DESC, created_at DESC);

-- Index 5: Employee full_name for search optimization
-- Speeds up LIKE '%search%' queries on employee names
CREATE INDEX IF NOT EXISTS idx_employees_full_name
  ON employees(full_name);

-- Index 6: Employee code for search optimization
CREATE INDEX IF NOT EXISTS idx_employees_code
  ON employees(employee_code);

SELECT 'Attendance Hub performance indexes created successfully' AS status;
