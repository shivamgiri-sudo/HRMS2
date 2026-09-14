-- 1665: Sync incentive_master to canonical list provided by owner (2026-09-03)
-- Adds missing types and corrects names; existing rows kept via ON DUPLICATE KEY UPDATE.

-- Update existing entry name: Overtime Allowance → Overtime Incentive
UPDATE incentive_master SET incentive_name = 'Overtime Incentive' WHERE incentive_code = 'OT';

-- Ensure all canonical types exist (insert or update name/status)
INSERT INTO incentive_master (incentive_code, incentive_name, taxable, active_status) VALUES
  ('ATT_INC',    'Attendance Incentive',              1, 1),
  ('CPI',        'Client Paid Incentive',             1, 1),
  ('CPI_HOU',    'Client Paid Incentive-Housing.com', 1, 1),
  ('EXTRA_DAYS', 'Extra Days Incentive',              1, 1),
  ('LAPTOP',     'Laptop Reimbursement',              0, 1),
  ('LOCAL_CONV', 'Local Conveyance',                  0, 1),
  ('NSA',        'Night Shift Allowance',             1, 1),
  ('OT',         'Overtime Incentive',                1, 1),
  ('PERF',       'Performance Incentive',             1, 1),
  ('PERF_ONFIDO','Performance Incentive Onfido',      1, 1),
  ('PLI',        'Performance Linked Incentive',      1, 1),
  ('PREV_DISP',  'Previous month dispute',            1, 1),
  ('REF',        'Referral Incentive',                1, 1),
  ('SAL_DIFF',   'Salary Diff. Days',                 1, 1),
  ('STI',        'Short Term Incentive',              1, 1),
  ('WO_ADJ',     'WO deduction adjustment',           1, 1)
ON DUPLICATE KEY UPDATE
  incentive_name  = VALUES(incentive_name),
  active_status   = VALUES(active_status);
