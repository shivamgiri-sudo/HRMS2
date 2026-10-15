-- Performance indexes for slow tables identified 2026-10-15.
-- Uses a stored procedure to skip creation if the index already exists (compatible with MySQL 5.7+).

DROP PROCEDURE IF EXISTS _add_index;
DELIMITER $$
CREATE PROCEDURE _add_index(
  IN tbl VARCHAR(128),
  IN idx VARCHAR(128),
  IN col VARCHAR(256)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND INDEX_NAME = idx
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD INDEX `', idx, '` (', col, ')');
    PREPARE _stmt FROM @sql;
    EXECUTE _stmt;
    DEALLOCATE PREPARE _stmt;
  END IF;
END$$
DELIMITER ;

CALL _add_index('salary_prep_line_component',   'idx_spl_component_employee_id',   '`employee_id`');
CALL _add_index('wfm_roster_assignment',         'idx_wfm_roster_assignment_cat',   '`created_at`');
CALL _add_index('attendance_regularization',     'idx_att_reg_branch_id',           '`branch_id`');
CALL _add_index('employee_salary_history',       'idx_emp_salary_history_cat',      '`created_at`');
CALL _add_index('ats_recruiter_hiring_activity', 'idx_ats_hiring_activity_emp_id',  '`employee_id`');
CALL _add_index('he_ex_employee',                'idx_he_ex_employee_emp_id',       '`employee_id`');
CALL _add_index('wfm_roster_import_row',         'idx_wfm_roster_import_row_cat',   '`created_at`');

DROP PROCEDURE IF EXISTS _add_index;
