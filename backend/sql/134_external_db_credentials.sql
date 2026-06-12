-- backend/sql/134_external_db_credentials.sql
USE mas_hrms;

ALTER TABLE integration_config
  ADD COLUMN IF NOT EXISTS encrypted_credentials TEXT NULL AFTER config_json,
  ADD COLUMN IF NOT EXISTS test_ok TINYINT(1) NULL AFTER encrypted_credentials,
  ADD COLUMN IF NOT EXISTS test_error TEXT NULL AFTER test_ok,
  ADD COLUMN IF NOT EXISTS test_at DATETIME NULL AFTER test_error,
  ADD COLUMN IF NOT EXISTS tested_by CHAR(36) NULL AFTER test_at;

INSERT INTO integration_config
  (integration_key, integration_name, integration_type, auth_type, active_status, notes, config_json)
VALUES
  (
    'cosec_biometric',
    'COSEC Biometric',
    'database',
    'basic',
    0,
    'Matrix COSEC attendance system. Configure host/port/db/user/password via Integration Hub.',
    JSON_OBJECT(
      'db_type', 'mssql',
      'host', '',
      'port', 1433,
      'database', 'NCOSEC',
      'username', '',
      'date_column', 'event_time',
      'employee_code_column', 'agent_user'
    )
  ),
  (
    'apr_productivity',
    'APR — Analyst Productivity',
    'database',
    'basic',
    0,
    'Vicidial agent log. UNION ALL across 8 tables. Live read on Performance page.',
    JSON_OBJECT(
      'db_type', 'mysql',
      'host', '122.184.128.90',
      'port', 3306,
      'database', 'dialer_db',
      'username', 'root',
      'date_column', 'event_time',
      'employee_code_column', 'agent_user',
      'tables', JSON_ARRAY(
        'vicidial_agent_log_10_25',
        'vicidial_agent_log_10_4',
        'vicidial_agent_log_11_4',
        'vicidial_agent_log_11_5',
        'vicidial_agent_log_247',
        'vicidial_agent_log_249',
        'vicidial_agent_log_250',
        'vicidial_agent_log_9'
      )
    )
  )
ON DUPLICATE KEY UPDATE
  integration_name = VALUES(integration_name),
  notes = VALUES(notes);
