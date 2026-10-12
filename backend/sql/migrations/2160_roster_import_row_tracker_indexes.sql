-- Migration 2160: indexes so the Roster Upload Tracker stops scanning wfm_roster_import_row.
--
-- The table only had (batch_id), (batch_id, validation_state) and (employee_id, roster_date).
-- The tracker's coverage query filters rows by roster_date and groups by employee_id_raw, and the
-- cell drawer asks "has this employee code any committed row this week" per employee; neither could
-- use an index, so every tracker load took ~37s and opening a cell ~120s on live data.
--   idx_rir_date_batch_emp  (roster_date, batch_id, employee_id_raw)  covers the coverage query
--   idx_rir_emp_date_batch  (employee_id_raw, roster_date, batch_id)  covers the per-employee lookups
-- Additive and idempotent (online InnoDB DDL, no rows change).

SET @s = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_rir_date_batch_emp ON wfm_roster_import_row (roster_date, batch_id, employee_id_raw)', 'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'wfm_roster_import_row' AND index_name = 'idx_rir_date_batch_emp');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_rir_emp_date_batch ON wfm_roster_import_row (employee_id_raw, roster_date, batch_id)', 'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'wfm_roster_import_row' AND index_name = 'idx_rir_emp_date_batch');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
