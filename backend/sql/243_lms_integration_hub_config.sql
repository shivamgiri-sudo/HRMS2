-- 243_lms_integration_hub_config.sql
-- Registers MCN LMS as an Integration Hub connector entry.
-- Credentials are stored via POST /api/lms/config (encrypted).
-- Schedule is disabled by default; enable from Integration Hub UI once creds verified.
USE mas_hrms;

INSERT IGNORE INTO integration_config
  (id, integration_key, integration_name, integration_type, vendor_name,
   config_json, active_status, notes)
VALUES
  (UUID(), 'lms_sync', 'MCN LMS Sync', 'database', 'MCN LMS',
   JSON_OBJECT(
     'db_type', 'mysql',
     'host', '192.168.11.225',
     'port', 3306,
     'database', 'mcn_lms',
     'description', 'Read-only sync: trainee progress, certifications, mappings from deployed MCN LMS'
   ),
   1,
   'Pulls trainee progress and certifications from mcn_lms into HRMS snapshot tables. Set credentials via LMS Integration page.');

INSERT IGNORE INTO integration_schedule
  (id, integration_key, cron_expression, enabled)
VALUES
  (UUID(), 'lms_sync', '0 */6 * * *', 0);
