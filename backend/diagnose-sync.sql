-- Biometric Sync Diagnostic Report
-- Run this directly in MySQL to diagnose sync issues

SELECT '=== 1. Integration Config ===' as '';
SELECT integration_key, integration_name, active_status, created_at, updated_at
FROM integration_config
WHERE integration_key = 'cosec_biometric';

SELECT '=== 2. Schedule Status ===' as '';
SELECT integration_key, cron_expression, enabled,
       last_run_at, next_run_at,
       TIMESTAMPDIFF(MINUTE, last_run_at, NOW()) as minutes_since_last_run
FROM integration_schedule
WHERE integration_key = 'cosec_biometric';

SELECT '=== 3. Recent Sync Runs ===' as '';
SELECT id, status, started_at, completed_at,
       records_in, records_out, records_error,
       SUBSTRING(error_summary, 1, 200) as error_summary_preview
FROM integration_connector_run
WHERE integration_key = 'cosec_biometric'
ORDER BY started_at DESC
LIMIT 5;

SELECT '=== 4. Biometric Data Status ===' as '';
SELECT
  (SELECT COUNT(*) FROM biometric_attendance_log) as total_biometric_records,
  (SELECT COUNT(*) FROM biometric_attendance_log WHERE punch_date = CURDATE()) as today_records,
  (SELECT MAX(migrated_at) FROM biometric_attendance_log) as latest_sync_time,
  (SELECT TIMESTAMPDIFF(MINUTE, MAX(migrated_at), NOW()) FROM biometric_attendance_log) as minutes_since_last_data;

SELECT '=== 5. Recent Errors ===' as '';
SELECT event_type, description, created_at
FROM integration_event_log
WHERE integration_key = 'cosec_biometric'
  AND event_type LIKE '%error%'
ORDER BY created_at DESC
LIMIT 5;

SELECT '=== 6. Sample Recent Biometric Records ===' as '';
SELECT employee_id, punch_date, first_punch_in, last_punch_out, total_punches, migrated_at
FROM biometric_attendance_log
ORDER BY migrated_at DESC
LIMIT 3;
