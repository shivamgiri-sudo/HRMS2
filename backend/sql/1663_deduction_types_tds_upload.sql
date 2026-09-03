-- Migration 1663: Add missing deduction types (Short Collection, Insurance, Prof Tax, Leave Deduction)
-- Safe to re-run: ON DUPLICATE KEY UPDATE

INSERT INTO payroll_deduction_type (deduction_code, deduction_name, is_prorated) VALUES
  ('SHORT_COLL', 'Short Collection', 0),
  ('INSURANCE',  'Insurance',        0),
  ('PROF_TAX',   'Professional Tax', 0),
  ('LEAVE_DED',  'Leave Deduction',  0)
ON DUPLICATE KEY UPDATE deduction_name = VALUES(deduction_name);
