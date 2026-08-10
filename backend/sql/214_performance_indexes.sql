-- Performance indexes for high-traffic queries
-- Migration: 214_performance_indexes.sql
-- Uses stored procedure for MySQL 8.0 compatibility (CREATE INDEX IF NOT EXISTS not supported on all 8.0.x builds)

DROP PROCEDURE IF EXISTS create_index_if_not_exists;
DELIMITER //
CREATE PROCEDURE create_index_if_not_exists(
  IN tbl VARCHAR(100), IN idx VARCHAR(100), IN cols VARCHAR(500)
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = tbl
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = tbl AND index_name = idx
  ) THEN
    SET @sql = CONCAT('CREATE INDEX ', idx, ' ON ', tbl, ' (', cols, ')');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL create_index_if_not_exists('employee_salary_assignment', 'idx_esa_emp_active',    'employee_id, active_status');
CALL create_index_if_not_exists('attendance_daily_record',    'idx_adr_emp_date',      'employee_id, record_date');
CALL create_index_if_not_exists('wfm_attendance_session',     'idx_was_emp_date',      'employee_id, session_date');
CALL create_index_if_not_exists('leave_request',              'idx_lr_emp_status',     'employee_id, status');
CALL create_index_if_not_exists('leave_request',              'idx_lr_status',         'status');
CALL create_index_if_not_exists('salary_prep_line',           'idx_spl_run_emp',       'run_id, employee_id');
CALL create_index_if_not_exists('employees',                  'idx_emp_active_process','active_status, process_id');
CALL create_index_if_not_exists('employees',                  'idx_emp_active_branch', 'active_status, branch_id');
CALL create_index_if_not_exists('employees',                  'idx_emp_active_dept',   'active_status, department_id');
CALL create_index_if_not_exists('salary_advance_log',         'idx_sal_emp_status',    'employee_id, status');
CALL create_index_if_not_exists('tax_declaration',            'idx_td_emp_fy',         'employee_id, financial_year');
CALL create_index_if_not_exists('employee_journey_log',       'idx_ejl_emp_date',      'employee_id, event_date');

DROP PROCEDURE IF EXISTS create_index_if_not_exists;
