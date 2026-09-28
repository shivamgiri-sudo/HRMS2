-- Lets a data source find its process through the employee on each row.
--
-- WHY
-- ---
-- process_key_kind offered two ways to attribute a row to a client: every row
-- belongs to one process ('constant'), or a column in the table names it
-- ('column'). Almost none of this application's own operational tables can do
-- either, because they carry an employee and no process at all:
--
--   cosec_daily_agg           284,270 rows   user_id, shift_date, work_minutes
--   wfm_roster_assignment     408,594 rows   employee_id
--   wfh_attendance_snapshot   275,724 rows
--   biometric_attendance_log  179,793 rows   employee_id
--
-- That is roughly 1.1M rows of punctuality, roster and working-hours data with no
-- route into a process metric, purely for want of a join. attendance_daily_record
-- was the lone exception, and only because it happens to carry process_id.
--
-- 'employee' joins the employees table on the source's own employee column and
-- filters by that employee's process. Verified before writing this: joining
-- cosec_daily_agg.user_id to employees.employee_code matches 14,000 of 14,781
-- rows for June 2026 and resolves to real processes with plausible hours
-- (Onfido 568 min/shift, Housing.com 570, Godfrey Philips 496).
--
-- The join is refused for an integration_connector source, at save time and again
-- at query-build time: employees lives in THIS database, and a connector pool
-- points at somebody else's server where the join would not resolve.
--
-- SAFETY: widens an enum by adding one value. Existing rows keep their value and
-- the default stays 'none', so nothing already configured changes meaning. The
-- guard checks for the new member rather than for the column, so re-running is a
-- no-op; MySQL rejects MariaDB's ADD COLUMN IF NOT EXISTS, hence PREPARE/EXECUTE.

SET @needs := (SELECT COUNT(1) FROM information_schema.columns
                WHERE table_schema = DATABASE()
                  AND table_name = 'kpi_studio_data_source'
                  AND column_name = 'process_key_kind'
                  AND COLUMN_TYPE NOT LIKE '%employee%');
SET @ddl := IF(@needs = 1,
  'ALTER TABLE kpi_studio_data_source MODIFY COLUMN process_key_kind ENUM(''none'',''constant'',''column'',''employee'') NOT NULL DEFAULT ''none'' COMMENT ''How a row is attributed to a process: one process for the whole source, a column that names the client, or looked up from the employee on the row.''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
