-- Rejoin v3 plan 3c: stint-aware payroll. Seeds the feature flag OFF. Re-runnable: guarded by NOT EXISTS because
-- branch_id/process_id are NULL in the (branch_id, process_id, config_key) unique key and MySQL treats NULLs as
-- distinct, so INSERT IGNORE alone would add a second row on re-run. Turning it on is an owner decision on the Config Flags screen.
INSERT INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
SELECT UUID(), NULL, NULL, 'rejoin_stint_payroll_enabled', 'false',
  'When true, payroll pays a rejoined employee only for the days inside their employment stints: the gap between the old last working day and the rejoin date earns no working days, no week-off credit and no holiday credit. Default false = unchanged behaviour.'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM payroll_config_flags
  WHERE branch_id IS NULL AND process_id IS NULL AND config_key = 'rejoin_stint_payroll_enabled'
);
