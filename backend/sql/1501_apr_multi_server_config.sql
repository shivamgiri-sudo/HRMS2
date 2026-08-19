-- 1501_apr_multi_server_config.sql
-- Add APR server configurations for GPI VICIdial servers
-- These servers contain agent productivity data not currently in the APR union
--
-- Servers:
--   192.168.1.6   - GPI01 campaign (~48 users)
--   192.168.1.7   - GPI02 campaign (~61 users)
--   192.168.1.153 - GPI5 + VRINDA campaigns (~68 users)
--
-- The apr-vicidial-sync.worker.ts reads all active integration_config rows where
-- integration_key LIKE 'apr_server_%' and syncs each to the apr table.
--
-- Credentials must be entered through the external DB credential screen/API so
-- they are encrypted with the environment key. This migration intentionally seeds
-- the server metadata as inactive and stores no username/password.

INSERT INTO integration_config
  (integration_key, integration_name, integration_type, auth_type, active_status, notes, config_json, encrypted_credentials)
VALUES
  (
    'apr_server_gpi01',
    'APR Server - GPI01 (192.168.1.6)',
    'database',
    'basic',
    0,
    'VICIdial server for GPI01 campaign (Godfrey Philips India). ~48 active agents.',
    JSON_OBJECT(
      'db_type', 'mysql',
      'host', '192.168.1.6',
      'port', 3306,
      'database', 'asterisk',
      'table', 'vicidial_agent_log',
      'date_column', 'event_time',
      'employee_code_column', 'user'
    ),
    NULL
  ),
  (
    'apr_server_gpi02',
    'APR Server - GPI02 (192.168.1.7)',
    'database',
    'basic',
    0,
    'VICIdial server for GPI02 campaign (Godfrey Philips India). ~61 active agents.',
    JSON_OBJECT(
      'db_type', 'mysql',
      'host', '192.168.1.7',
      'port', 3306,
      'database', 'asterisk',
      'table', 'vicidial_agent_log',
      'date_column', 'event_time',
      'employee_code_column', 'user'
    ),
    NULL
  ),
  (
    'apr_server_gpi5',
    'APR Server - GPI5/VRINDA (192.168.1.153)',
    'database',
    'basic',
    0,
    'VICIdial server for GPI5 and VRINDA campaigns. ~68 active agents.',
    JSON_OBJECT(
      'db_type', 'mysql',
      'host', '192.168.1.153',
      'port', 3306,
      'database', 'asterisk',
      'table', 'vicidial_agent_log',
      'date_column', 'event_time',
      'employee_code_column', 'user'
    ),
    NULL
  )
ON DUPLICATE KEY UPDATE
  integration_name = VALUES(integration_name),
  config_json = VALUES(config_json),
  notes = VALUES(notes),
  active_status = VALUES(active_status),
  encrypted_credentials = COALESCE(integration_config.encrypted_credentials, VALUES(encrypted_credentials));
