-- Corrects the HRMS_ATTENDANCE_DAILY data source seeded by 1644.
--
-- It was seeded with date_column = 'attendance_date'. That column does not
-- exist: attendance_daily_record's date column is `record_date`, which is what
-- all 19 other references to that table across the codebase use. Any KPI built
-- on this source therefore failed at the database with
--   "Unknown column 'attendance_date' in 'field list'"
-- and returned no_data for every employee.
--
-- Found 2026-09-07 by running the first real computation through the Studio
-- after mounting its router — the module had never been reachable, so its
-- seeded source had never been exercised and the wrong name was never surfaced.
--
-- Guarded on the wrong value specifically, so an administrator who has already
-- corrected this by hand is not overwritten. 1644 is left untouched: it is an
-- applied migration, and this repo fixes forward rather than editing history.

UPDATE kpi_studio_data_source
   SET date_column = 'record_date',
       updated_at  = NOW()
 WHERE source_code = 'HRMS_ATTENDANCE_DAILY'
   AND date_column = 'attendance_date';
