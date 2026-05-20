-- 008_integration_hub.sql
USE mas_hrms;

-- secret_name stores the Supabase Vault key name only — actual credential never stored here
CREATE TABLE IF NOT EXISTS integration_config (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key  VARCHAR(100) NOT NULL UNIQUE,
  integration_name VARCHAR(255) NOT NULL,
  integration_type VARCHAR(50)  NOT NULL,
  vendor_name      VARCHAR(255),
  base_url         VARCHAR(500),
  auth_type        VARCHAR(50),
  secret_name      VARCHAR(255),
  config_json      JSON,
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  notes            TEXT,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_integration_key (integration_key)
);

CREATE TABLE IF NOT EXISTS integration_schedule (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key VARCHAR(100) NOT NULL UNIQUE,
  cron_expression VARCHAR(100) NOT NULL DEFAULT '0 */15 * * * *',
  enabled         TINYINT(1)   NOT NULL DEFAULT 0,
  last_run_at     DATETIME,
  next_run_at     DATETIME,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (integration_key) REFERENCES integration_config(integration_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_connector_run (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key VARCHAR(100) NOT NULL,
  triggered_by    VARCHAR(50)  NOT NULL DEFAULT 'schedule',
  triggered_user  CHAR(36),
  status          VARCHAR(50)  NOT NULL DEFAULT 'running',
  rows_fetched    INT          NOT NULL DEFAULT 0,
  rows_staged     INT          NOT NULL DEFAULT 0,
  rows_promoted   INT          NOT NULL DEFAULT 0,
  rows_failed     INT          NOT NULL DEFAULT 0,
  duration_ms     INT,
  error_message   TEXT,
  started_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME,
  INDEX idx_run_key (integration_key),
  INDEX idx_run_started (started_at)
);

CREATE TABLE IF NOT EXISTS integration_raw_payload (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id          CHAR(36)     NOT NULL,
  integration_key VARCHAR(100) NOT NULL,
  payload         LONGTEXT     NOT NULL,
  payload_hash    VARCHAR(64),
  row_count       INT          NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payload_run (run_id),
  FOREIGN KEY (run_id) REFERENCES integration_connector_run(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_schema_snapshot (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key VARCHAR(100) NOT NULL,
  run_id          CHAR(36)     NOT NULL,
  detected_fields JSON         NOT NULL,
  snapshot_hash   VARCHAR(64),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_schema_key (integration_key),
  FOREIGN KEY (run_id) REFERENCES integration_connector_run(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_field_map (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key VARCHAR(100) NOT NULL,
  source_field    VARCHAR(255) NOT NULL,
  target_table    VARCHAR(100) NOT NULL,
  target_column   VARCHAR(100) NOT NULL,
  transform       VARCHAR(500),
  confirmed_by    CHAR(36),
  confirmed_at    DATETIME,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_map_key_field (integration_key, source_field),
  INDEX idx_map_key (integration_key)
);

CREATE TABLE IF NOT EXISTS integration_field_map_suggestion (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key  VARCHAR(100)  NOT NULL,
  source_field     VARCHAR(255)  NOT NULL,
  suggested_table  VARCHAR(100),
  suggested_column VARCHAR(100),
  confidence_score DECIMAL(5,2)  NOT NULL DEFAULT 0,
  status           VARCHAR(50)   NOT NULL DEFAULT 'pending',
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_suggest_key (integration_key)
);

CREATE TABLE IF NOT EXISTS integration_event_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key VARCHAR(100) NOT NULL,
  event_type      VARCHAR(100) NOT NULL,
  triggered_by    CHAR(36),
  description     TEXT,
  metadata        JSON,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_key (integration_key),
  INDEX idx_event_created (created_at)
);

-- Each dialer gets its own row. Admin renames dialer_1/dialer_2 to actual vendor names via UI.
-- Consolidated login time = SUM(login_minutes) in dialer_session_log GROUP BY employee_code, session_date
INSERT INTO integration_config (integration_key, integration_name, integration_type, auth_type, notes) VALUES
  ('dialer_1',         'Dialer 1',                'rest_pull',   'api_key',  'First dialer. Set integration_name, base_url, secret_name via admin UI.'),
  ('dialer_2',         'Dialer 2',                'rest_pull',   'api_key',  'Second dialer. Set integration_name, base_url, secret_name via admin UI.'),
  ('facial_biometric', 'Facial Biometric Device', 'rest_pull',   'basic',    'Biometric punch data. Set base_url and secret_name before enabling.'),
  ('payroll',          'Payroll System',           'sftp',        'sftp_key', 'External payroll import. Set secret_name before enabling.'),
  ('bgv',              'BGV Vendor',               'rest_pull',   'api_key',  'Background verification. Set base_url and secret_name before enabling.'),
  ('crm',              'CRM System',               'rest_pull',   'bearer',   'CRM agent data sync. Set base_url and secret_name before enabling.'),
  ('sms_gateway',      'SMS Gateway',              'rest_push',   'api_key',  'SMS notifications. Set base_url and secret_name before enabling.'),
  ('whatsapp_gateway', 'WhatsApp Gateway',         'rest_push',   'bearer',   'WhatsApp notifications. Set base_url and secret_name before enabling.'),
  ('ispark',           'iSpark Legacy HR',         'file_upload', 'none',     'Employee data migration from iSpark via CSV upload.')
ON DUPLICATE KEY UPDATE integration_name = VALUES(integration_name);
