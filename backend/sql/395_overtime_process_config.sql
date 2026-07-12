-- Migration 395: Overtime eligibility configuration per process
-- Overtime is NOT allowed by default; must be explicitly enabled per process.

-- Seed global default: overtime_allowed = false
INSERT IGNORE INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
VALUES
  (UUID(), NULL, NULL, 'overtime_allowed',
   'false',
   'Whether overtime hours/amount can be recorded and paid for employees in this process scope. Must be explicitly enabled per process.');

-- Seed global default: overtime rate multiplier
INSERT IGNORE INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
VALUES
  (UUID(), NULL, NULL, 'overtime_rate_multiplier',
   '1.5',
   'Multiplier applied to per-hour basic rate for overtime calculation. E.g. 1.5 = time-and-a-half.');

-- Seed global default: overtime monthly cap hours (0 = unlimited)
INSERT IGNORE INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
VALUES
  (UUID(), NULL, NULL, 'overtime_monthly_cap_hours',
   '0',
   'Maximum overtime hours allowed per employee per month. 0 = no cap.');

SELECT '395_overtime_process_config.sql applied' AS migration_status;
