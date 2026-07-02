-- backend/sql/134_external_db_credentials.sql
USE mas_hrms;

-- MySQL 5.7 does not support ADD COLUMN IF NOT EXISTS. Use dynamic DDL so
-- this migration remains idempotent across the production and local engines.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'integration_config'
      AND column_name = 'encrypted_credentials') = 0,
  'ALTER TABLE integration_config ADD COLUMN encrypted_credentials TEXT NULL AFTER config_json',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'integration_config'
      AND column_name = 'test_ok') = 0,
  'ALTER TABLE integration_config ADD COLUMN test_ok TINYINT(1) NULL AFTER encrypted_credentials',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'integration_config'
      AND column_name = 'test_error') = 0,
  'ALTER TABLE integration_config ADD COLUMN test_error TEXT NULL AFTER test_ok',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'integration_config'
      AND column_name = 'test_at') = 0,
  'ALTER TABLE integration_config ADD COLUMN test_at DATETIME NULL AFTER test_error',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'integration_config'
      AND column_name = 'tested_by') = 0,
  'ALTER TABLE integration_config ADD COLUMN tested_by CHAR(36) NULL AFTER test_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

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
      'host', '',
      'port', 3306,
      'database', 'dialer_db',
      'username', '',
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
