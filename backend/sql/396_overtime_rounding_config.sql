-- Migration 396: Overtime rounding and minimum-hour configuration
-- Controls how raw OT hours are rounded before storage.
-- Default: min 1h required, floor to nearest full hour.

INSERT IGNORE INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
VALUES
  (UUID(), NULL, NULL, 'overtime_minimum_hours',
   '1',
   'Minimum OT hours threshold. Below this, OT counts as 0. E.g. 1 means 45 min OT = 0h.'),

  (UUID(), NULL, NULL, 'overtime_rounding_unit',
   '1',
   'OT rounding granularity (floor). E.g. 1 = floor to full hour (1.5h→1h), 0.5 = floor to half-hour (1.7h→1.5h).');

SELECT '396_overtime_rounding_config.sql applied' AS migration_status;
