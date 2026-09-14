-- Migration 505: Performance source connector keys
-- Additive metadata only. No credentials. Do not execute against production without explicit approval.
USE mas_hrms;

INSERT INTO integration_config
  (integration_key, integration_name, integration_type, auth_type, active_status, notes, config_json)
VALUES
  (
    'quality_audit',
    'Quality Audit - Mydashboards Source',
    'database',
    'basic',
    0,
    'Read-only source for weighted quality score and fatal rate. Configure credentials through Integration Hub only.',
    JSON_OBJECT(
      'db_type', 'mysql',
      'host', '',
      'port', 3306,
      'database', 'db_audit',
      'username', '',
      'date_column', 'CallDate',
      'employee_code_column', 'User',
      'tables', JSON_ARRAY('call_quality_assessment')
    )
  ),
  (
    'outbound_calls',
    'Outbound Calls - Mydashboards Source',
    'database',
    'basic',
    0,
    'Read-only source for outbound conversion rate. Configure credentials through Integration Hub only.',
    JSON_OBJECT(
      'db_type', 'mysql',
      'host', '',
      'port', 3306,
      'database', 'db_external',
      'username', '',
      'date_column', 'CallDate',
      'employee_code_column', 'AgentName',
      'tables', JSON_ARRAY('CallDetails')
    )
  ),
  (
    'sales_brand_mis',
    'Brand Sales MIS - Mydashboards Source',
    'database',
    'basic',
    0,
    'Reserved read-only connector for brand/process sales adapters in the next phase.',
    JSON_OBJECT(
      'db_type', 'mysql',
      'host', '',
      'port', 3306,
      'database', 'db_masmis',
      'username', '',
      'date_column', 'report_date',
      'employee_code_column', 'emp_id',
      'tables', JSON_ARRAY('bb_apr', 'gnc_apr', 'neemans_apr', 'bb_sale', 'gnc_sale', 'neemans_sale_raw')
    )
  )
ON DUPLICATE KEY UPDATE
  integration_name = VALUES(integration_name),
  notes = VALUES(notes),
  config_json = CASE
    WHEN encrypted_credentials IS NULL OR encrypted_credentials = '' THEN VALUES(config_json)
    ELSE config_json
  END;