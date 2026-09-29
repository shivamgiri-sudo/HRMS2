-- Migration 1918: Operations Command dashboard indexes.
--
-- Backs the one-stop /operations-dashboard (modules/operations/ops-command.*):
-- date-range scans on attendance/exits/joiners/roster/breaks/KPI facts, grouped by
-- branch / process / manager. All additive, information_schema-guarded, no data changes.

SET @db = DATABASE();

SET @ix0 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_ops_emp_doj');
SET @sql0 = IF(@ix0 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='employees') > 0,
  'ALTER TABLE employees ADD INDEX idx_ops_emp_doj (date_of_joining)', 'SELECT 1');
PREPARE p0 FROM @sql0; EXECUTE p0; DEALLOCATE PREPARE p0;

SET @ix1 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_ops_emp_exit');
SET @sql1 = IF(@ix1 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='employees') > 0,
  'ALTER TABLE employees ADD INDEX idx_ops_emp_exit (date_of_exit)', 'SELECT 1');
PREPARE p1 FROM @sql1; EXECUTE p1; DEALLOCATE PREPARE p1;

SET @ix2 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_ops_emp_leaving');
SET @sql2 = IF(@ix2 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='employees') > 0,
  'ALTER TABLE employees ADD INDEX idx_ops_emp_leaving (date_of_leaving)', 'SELECT 1');
PREPARE p2 FROM @sql2; EXECUTE p2; DEALLOCATE PREPARE p2;

SET @ix3 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_ops_emp_mgr_active');
SET @sql3 = IF(@ix3 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='employees') > 0,
  'ALTER TABLE employees ADD INDEX idx_ops_emp_mgr_active (reporting_manager_id, active_status)', 'SELECT 1');
PREPARE p3 FROM @sql3; EXECUTE p3; DEALLOCATE PREPARE p3;

SET @ix4 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_ops_adr_date_branch');
SET @sql4 = IF(@ix4 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='attendance_daily_record') > 0,
  'ALTER TABLE attendance_daily_record ADD INDEX idx_ops_adr_date_branch (record_date, branch_id)', 'SELECT 1');
PREPARE p4 FROM @sql4; EXECUTE p4; DEALLOCATE PREPARE p4;

SET @ix5 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_ops_adr_date_process');
SET @sql5 = IF(@ix5 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='attendance_daily_record') > 0,
  'ALTER TABLE attendance_daily_record ADD INDEX idx_ops_adr_date_process (record_date, process_id)', 'SELECT 1');
PREPARE p5 FROM @sql5; EXECUTE p5; DEALLOCATE PREPARE p5;

SET @ix6 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'exit_request' AND INDEX_NAME = 'idx_ops_exit_confirmed');
SET @sql6 = IF(@ix6 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='exit_request') > 0,
  'ALTER TABLE exit_request ADD INDEX idx_ops_exit_confirmed (exit_confirmed_at)', 'SELECT 1');
PREPARE p6 FROM @sql6; EXECUTE p6; DEALLOCATE PREPARE p6;

SET @ix7 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'exit_request' AND INDEX_NAME = 'idx_ops_exit_created');
SET @sql7 = IF(@ix7 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='exit_request') > 0,
  'ALTER TABLE exit_request ADD INDEX idx_ops_exit_created (created_at)', 'SELECT 1');
PREPARE p7 FROM @sql7; EXECUTE p7; DEALLOCATE PREPARE p7;

SET @ix8 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'kpi_daily_actual' AND INDEX_NAME = 'idx_ops_kda_date');
SET @sql8 = IF(@ix8 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='kpi_daily_actual') > 0,
  'ALTER TABLE kpi_daily_actual ADD INDEX idx_ops_kda_date (score_date)', 'SELECT 1');
PREPARE p8 FROM @sql8; EXECUTE p8; DEALLOCATE PREPARE p8;

SET @ix9 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'kpi_daily_actual' AND INDEX_NAME = 'idx_ops_kda_process_date');
SET @sql9 = IF(@ix9 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='kpi_daily_actual') > 0,
  'ALTER TABLE kpi_daily_actual ADD INDEX idx_ops_kda_process_date (process_id_at_event, score_date)', 'SELECT 1');
PREPARE p9 FROM @sql9; EXECUTE p9; DEALLOCATE PREPARE p9;

SET @ix10 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'break_daily_summary' AND INDEX_NAME = 'idx_ops_break_date_process');
SET @sql10 = IF(@ix10 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='break_daily_summary') > 0,
  'ALTER TABLE break_daily_summary ADD INDEX idx_ops_break_date_process (shift_date, process_id)', 'SELECT 1');
PREPARE p10 FROM @sql10; EXECUTE p10; DEALLOCATE PREPARE p10;

SET @ix11 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'break_daily_summary' AND INDEX_NAME = 'idx_ops_break_date_branch');
SET @sql11 = IF(@ix11 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='break_daily_summary') > 0,
  'ALTER TABLE break_daily_summary ADD INDEX idx_ops_break_date_branch (shift_date, branch_id)', 'SELECT 1');
PREPARE p11 FROM @sql11; EXECUTE p11; DEALLOCATE PREPARE p11;

SET @ix12 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_warning' AND INDEX_NAME = 'idx_ops_warn_status_date');
SET @sql12 = IF(@ix12 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='employee_warning') > 0,
  'ALTER TABLE employee_warning ADD INDEX idx_ops_warn_status_date (status, warning_date)', 'SELECT 1');
PREPARE p12 FROM @sql12; EXECUTE p12; DEALLOCATE PREPARE p12;

SET @ix13 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'pip_record' AND INDEX_NAME = 'idx_ops_pip_status');
SET @sql13 = IF(@ix13 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='pip_record') > 0,
  'ALTER TABLE pip_record ADD INDEX idx_ops_pip_status (status)', 'SELECT 1');
PREPARE p13 FROM @sql13; EXECUTE p13; DEALLOCATE PREPARE p13;

SET @ix14 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'job_requisition' AND INDEX_NAME = 'idx_ops_jr_process_status');
SET @sql14 = IF(@ix14 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='job_requisition') > 0,
  'ALTER TABLE job_requisition ADD INDEX idx_ops_jr_process_status (process_id, approval_status)', 'SELECT 1');
PREPARE p14 FROM @sql14; EXECUTE p14; DEALLOCATE PREPARE p14;

SET @ix15 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wfm_attendance_session' AND INDEX_NAME = 'idx_ops_session_date_status');
SET @sql15 = IF(@ix15 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='wfm_attendance_session') > 0,
  'ALTER TABLE wfm_attendance_session ADD INDEX idx_ops_session_date_status (session_date, current_status)', 'SELECT 1');
PREPARE p15 FROM @sql15; EXECUTE p15; DEALLOCATE PREPARE p15;

SET @ix16 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wfm_slot_requirement' AND INDEX_NAME = 'idx_ops_slot_date_process');
SET @sql16 = IF(@ix16 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='wfm_slot_requirement') > 0,
  'ALTER TABLE wfm_slot_requirement ADD INDEX idx_ops_slot_date_process (requirement_date, process_id, is_active)', 'SELECT 1');
PREPARE p16 FROM @sql16; EXECUTE p16; DEALLOCATE PREPARE p16;

SET @ix17 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'process_metric_employee_actual' AND INDEX_NAME = 'idx_ops_pmea_date');
SET @sql17 = IF(@ix17 = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='process_metric_employee_actual') > 0,
  'ALTER TABLE process_metric_employee_actual ADD INDEX idx_ops_pmea_date (score_date, process_id, metric_key)', 'SELECT 1');
PREPARE p17 FROM @sql17; EXECUTE p17; DEALLOCATE PREPARE p17;

-- Covering index for the attendance scan behind every Operations Command view: the whole window is read from
-- the index alone (no per-row lookups into the wide attendance_daily_record rows).
SET @ixc = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_ops_adr_cover');
SET @sqlc = IF(@ixc = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='attendance_daily_record') > 0,
  'ALTER TABLE attendance_daily_record ADD INDEX idx_ops_adr_cover (record_date, employee_id, attendance_status, late_mark, raw_minutes, biometric_minutes, dialler_minutes, mismatch_flag, mismatch_resolved_at)', 'SELECT 1');
PREPARE pc FROM @sqlc; EXECUTE pc; DEALLOCATE PREPARE pc;
