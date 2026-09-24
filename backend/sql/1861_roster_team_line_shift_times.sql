-- 1861_roster_team_line_shift_times.sql
-- Team Roster lines store the chosen shift AS TIMES. Live rosters do not use wfm_shift_template: their
-- rows carry raw shift_start_time / shift_end_time (VARCHAR(5) 'HH:MM') with shift_template_id NULL, so a
-- line that could only reference a template could never express a working shift.
--   new_shift_start_time / new_shift_end_time : the proposed shift's times (TIME)
--   new_shift_id                              : wfm_shift_master.id when the option came from the shift master
-- new_shift_template_id (1859) stays for template-backed options. old_shift_start_time / old_shift_end_time
-- already exist from 1859 (the CHANGE snapshot), so they are not touched here.
--
-- roster_team_submission_line is brand new and empty; the columns are nullable and added only when absent
-- (information_schema guard), so this is additive and safe to replay. new_shift_id copies its collation from
-- wfm_shift_master.id (see hrms2-new-table-collation-trap); fallback utf8mb4_unicode_ci.

SET @rtl_mc = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_shift_master' AND COLUMN_NAME = 'id' LIMIT 1), 'utf8mb4_unicode_ci');

SET @rtl_has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_team_submission_line' AND COLUMN_NAME = 'new_shift_start_time');
SET @rtl_sql = IF(@rtl_has = 0, 'ALTER TABLE roster_team_submission_line ADD COLUMN new_shift_start_time TIME NULL', 'SELECT 1');
PREPARE rtl_stmt FROM @rtl_sql;
EXECUTE rtl_stmt;
DEALLOCATE PREPARE rtl_stmt;

SET @rtl_has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_team_submission_line' AND COLUMN_NAME = 'new_shift_end_time');
SET @rtl_sql = IF(@rtl_has = 0, 'ALTER TABLE roster_team_submission_line ADD COLUMN new_shift_end_time TIME NULL', 'SELECT 1');
PREPARE rtl_stmt FROM @rtl_sql;
EXECUTE rtl_stmt;
DEALLOCATE PREPARE rtl_stmt;

SET @rtl_has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_team_submission_line' AND COLUMN_NAME = 'new_shift_id');
SET @rtl_sql = IF(@rtl_has = 0,
  CONCAT('ALTER TABLE roster_team_submission_line ADD COLUMN new_shift_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rtl_mc, ' NULL'),
  'SELECT 1');
PREPARE rtl_stmt FROM @rtl_sql;
EXECUTE rtl_stmt;
DEALLOCATE PREPARE rtl_stmt;
