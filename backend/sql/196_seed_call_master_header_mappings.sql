-- Seed confirmed Integration Hub table/header mappings for connected call-master databases.
USE mas_hrms;

SET @system_user_id = (
  SELECT id FROM auth_user
   WHERE LOWER(email) IN ('shivam.giri@teammas.in', 'careers@teammas.in')
   ORDER BY LOWER(email) = 'shivam.giri@teammas.in' DESC
   LIMIT 1
);

INSERT INTO integration_table_map
  (id, integration_key, source_table, target_table, sync_mode, confirmed_by, confirmed_at)
VALUES
  (UUID(), 'dialer_2', 'v_call_master_inbound', 'integration_call_daily', 'daily_aggregate', @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'v_call_master_outbound', 'integration_call_daily', 'daily_aggregate', @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'daily_performance_snapshot', 'integration_call_daily', 'daily_aggregate', @system_user_id, NOW())
ON DUPLICATE KEY UPDATE
  target_table = VALUES(target_table),
  sync_mode = VALUES(sync_mode),
  confirmed_by = VALUES(confirmed_by),
  confirmed_at = NOW(),
  active_status = 1;

INSERT INTO integration_field_map
  (id, integration_key, source_table, source_field, target_table, target_column, transform, confirmed_by, confirmed_at)
VALUES
  (UUID(), 'dialer_2', 'v_call_master_inbound', 'agent_employee_code', 'integration_call_daily', 'employee_code', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'v_call_master_inbound', 'call_date', 'integration_call_daily', 'activity_date', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'v_call_master_inbound', 'length_in_sec', 'integration_call_daily', 'talk_minutes', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'v_call_master_inbound', 'process_name', 'integration_call_daily', 'process_name', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'v_call_master_outbound', 'agent_employee_code', 'integration_call_daily', 'employee_code', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'v_call_master_outbound', 'call_date', 'integration_call_daily', 'activity_date', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'v_call_master_outbound', 'length_in_sec', 'integration_call_daily', 'talk_minutes', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'v_call_master_outbound', 'process_name', 'integration_call_daily', 'process_name', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'daily_performance_snapshot', 'agent_employee_code', 'integration_call_daily', 'employee_code', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'daily_performance_snapshot', 'snapshot_date', 'integration_call_daily', 'activity_date', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'daily_performance_snapshot', 'total_calls', 'integration_call_daily', 'total_calls', NULL, @system_user_id, NOW()),
  (UUID(), 'dialer_2', 'daily_performance_snapshot', 'process_name', 'integration_call_daily', 'process_name', NULL, @system_user_id, NOW())
ON DUPLICATE KEY UPDATE
  target_table = VALUES(target_table),
  target_column = VALUES(target_column),
  transform = VALUES(transform),
  confirmed_by = VALUES(confirmed_by),
  confirmed_at = NOW(),
  active_status = 1;
