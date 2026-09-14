-- backend/sql/migrations/1604_employee_performance_daily_snapshot.sql
-- Foundation table for the Employee Performance Scorecard feature (Task 1).
-- employee_id collation verified live against `employees`.`id`
-- (char(36) COLLATE utf8mb4_unicode_ci) 2026-08-25 via SHOW CREATE TABLE employees.
CREATE TABLE IF NOT EXISTS employee_performance_daily_snapshot (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci,
  snapshot_date DATE NOT NULL,
  attendance_status VARCHAR(20) NULL,
  late_by_minutes INT NOT NULL DEFAULT 0,
  unplanned_leave_flag TINYINT(1) NOT NULL DEFAULT 0,
  pip_status VARCHAR(20) NULL,
  designation_id VARCHAR(36) NULL,
  quality_score DECIMAL(6,2) NULL,
  template_metrics JSON NULL,
  team_attrition_pct DECIMAL(6,2) NULL,
  team_shrinkage_pct DECIMAL(6,2) NULL,
  team_revenue DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_perf_snapshot (employee_id, snapshot_date),
  KEY idx_perf_snapshot_date (snapshot_date),
  CONSTRAINT fk_emp_perf_snapshot_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
