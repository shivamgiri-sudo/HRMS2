USE mas_hrms;

SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'employees',
    'process_master',
    'branch_master',
    'wfm_shift',
    'wfm_roster_plan',
    'wfm_roster_assignment',
    'roster_template',
    'week_off_preference',
    'process_weekoff_capacity',
    'weekoff_allocation_log',
    'leave_request',
    'role_page_access'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT
  CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_plan') THEN 'OK' ELSE 'MISSING' END AS wfm_roster_plan,
  CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment') THEN 'OK' ELSE 'MISSING' END AS wfm_roster_assignment,
  CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_shift') THEN 'OK' ELSE 'MISSING' END AS wfm_shift,
  CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'week_off_preference') THEN 'OK' ELSE 'MISSING' END AS week_off_preference;
