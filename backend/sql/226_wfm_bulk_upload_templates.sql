-- Migration 226: WFM bulk upload template definitions
-- ROSTER_ASSIGNMENT_BULK — manual override upload for roster assignments
-- WEEK_OFF_PREFERENCE_BULK — bulk week-off preference import for WFM team
-- INSERT IGNORE is idempotent — safe to re-run

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'ROSTER_ASSIGNMENT_BULK',
  'Roster Assignment Bulk Upload',
  'wfm_roster_assignment',
  'Manual override: bulk assign shift templates to employees for a specific cycle. Existing auto-generated assignments are superseded. Requires admin/WFM role.',
  JSON_ARRAY('cycle_id', 'employee_code', 'roster_date', 'shift_code'),
  JSON_ARRAY('is_week_off', 'notes'),
  JSON_OBJECT(
    'cycle_id', 'CYCLE-UUID-HERE',
    'employee_code', 'MAS00001',
    'roster_date', '2026-06-23',
    'shift_code', 'DAY',
    'is_week_off', '0',
    'notes', 'Manual override — public holiday swap'
  ),
  1
);

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'WEEK_OFF_PREFERENCE_BULK',
  'Week-Off Preference Bulk Import',
  'week_off_preference',
  'Batch import week-off preferences on behalf of employees (WFM team use). Replaces any existing submitted preference for the same employee/week. Requires WFM/HR role.',
  JSON_ARRAY('employee_code', 'week_start_date', 'preferred_day_1'),
  JSON_ARRAY('preferred_day_2', 'reason'),
  JSON_OBJECT(
    'employee_code', 'MAS00001',
    'week_start_date', '2026-06-23',
    'preferred_day_1', '0',
    'preferred_day_2', '6',
    'reason', 'Pre-approved by manager'
  ),
  1
);

SELECT '226_wfm_bulk_upload_templates.sql applied successfully' AS migration_status;
