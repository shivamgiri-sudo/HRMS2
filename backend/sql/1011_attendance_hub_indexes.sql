-- Migration: Performance indexes for Attendance Hub
-- Speeds up the /api/employees/hr-hub endpoint
-- Run via: node script or mysql CLI with DELIMITER support

-- Composite index for attendance_daily_record monthly aggregation
-- Used by: hr-hub endpoint attendance subquery with record_date BETWEEN and GROUP BY employee_id
-- CREATE INDEX idx_adr_date_employee ON attendance_daily_record(record_date, employee_id);

-- Composite index for salary_prep_line lookups
-- Used by: hr-hub endpoint salary subquery joining on employee_id and run_id
-- CREATE INDEX idx_spl_employee_run ON salary_prep_line(employee_id, run_id);

-- Note: Indexes created via Node.js migration script due to MySQL DELIMITER limitations.
-- Both indexes have been applied to production.
