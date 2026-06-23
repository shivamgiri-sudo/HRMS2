-- Performance indexes for high-query tables
-- Guard pattern: each block only runs if the index does not already exist.
-- Compatible with MySQL 8.0. Safe to apply multiple times.

-- attendance_daily_record: composite covering index for batch revenue-risk attendance queries
-- Allows (record_date + attendance_status) filter on 200K+ rows without full scan
DROP PROCEDURE IF EXISTS _add_idx_adr_record_date_status;
DELIMITER ;;
CREATE PROCEDURE _add_idx_adr_record_date_status()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'attendance_daily_record'
      AND INDEX_NAME   = 'idx_adr_record_date_status'
  ) THEN
    ALTER TABLE attendance_daily_record
      ADD INDEX idx_adr_record_date_status (record_date, attendance_status);
  END IF;
END;;
DELIMITER ;
CALL _add_idx_adr_record_date_status();
DROP PROCEDURE IF EXISTS _add_idx_adr_record_date_status;

-- ats_candidate: composite for date-ordered list queries filtered by status
DROP PROCEDURE IF EXISTS _add_idx_ats_created_status;
DELIMITER ;;
CREATE PROCEDURE _add_idx_ats_created_status()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ats_candidate'
      AND INDEX_NAME   = 'idx_ats_candidate_created_status'
  ) THEN
    ALTER TABLE ats_candidate
      ADD INDEX idx_ats_candidate_created_status (created_at, status);
  END IF;
END;;
DELIMITER ;
CALL _add_idx_ats_created_status();
DROP PROCEDURE IF EXISTS _add_idx_ats_created_status;

-- leave_request: extend employee-scoped queries to cover from_date range
-- existing idx_lr_emp_status covers (employee_id, status) but not the date column
DROP PROCEDURE IF EXISTS _add_idx_lr_emp_status_from;
DELIMITER ;;
CREATE PROCEDURE _add_idx_lr_emp_status_from()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'leave_request'
      AND INDEX_NAME   = 'idx_lr_employee_status_from'
  ) THEN
    ALTER TABLE leave_request
      ADD INDEX idx_lr_employee_status_from (employee_id, status, from_date);
  END IF;
END;;
DELIMITER ;
CALL _add_idx_lr_emp_status_from();
DROP PROCEDURE IF EXISTS _add_idx_lr_emp_status_from;

-- workforce_mandate: composite for revenue-risk batch mandate query
DROP PROCEDURE IF EXISTS _add_idx_wm_process_active;
DELIMITER ;;
CREATE PROCEDURE _add_idx_wm_process_active()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'workforce_mandate'
      AND INDEX_NAME   = 'idx_wm_process_active'
  ) THEN
    ALTER TABLE workforce_mandate
      ADD INDEX idx_wm_process_active (process_id, active_status, effective_from, effective_to);
  END IF;
END;;
DELIMITER ;
CALL _add_idx_wm_process_active();
DROP PROCEDURE IF EXISTS _add_idx_wm_process_active;
