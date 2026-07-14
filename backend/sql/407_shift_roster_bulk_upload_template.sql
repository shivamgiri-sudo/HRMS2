-- Migration 407: Shift Roster Bulk Upload template
-- SHIFT_ROSTER_BULK — weekly shift assignment upload per employee
-- Simpler than ROSTER_ASSIGNMENT_BULK: uses week_start_date + per-day shift codes
-- INSERT IGNORE is idempotent — safe to re-run

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'SHIFT_ROSTER_BULK',
  'Shift Roster Bulk Upload',
  'wfm_roster_assignment',
  'Upload weekly shift roster for employees. Specify shift code (e.g. DAY, NIGHT, SPLIT) or WO for week-off for each day. Requires WFM/Admin role.',
  JSON_ARRAY('employee_code', 'week_start_date'),
  JSON_ARRAY('mon_shift', 'tue_shift', 'wed_shift', 'thu_shift', 'fri_shift', 'sat_shift', 'sun_shift', 'notes'),
  JSON_OBJECT(
    'employee_code', 'MAS00001',
    'week_start_date', '2026-07-14',
    'mon_shift', 'DAY',
    'tue_shift', 'DAY',
    'wed_shift', 'NIGHT',
    'thu_shift', 'NIGHT',
    'fri_shift', 'DAY',
    'sat_shift', 'WO',
    'sun_shift', 'WO',
    'notes', 'Standard week'
  ),
  1
);

SELECT '407_shift_roster_bulk_upload_template.sql applied successfully' AS migration_status;
