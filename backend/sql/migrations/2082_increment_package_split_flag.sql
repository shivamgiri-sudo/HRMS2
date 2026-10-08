-- Increment-aware package split. Seeds the feature flag OFF. Re-runnable: guarded by NOT EXISTS because
-- branch_id/process_id are NULL in the (branch_id, process_id, config_key) unique key and MySQL treats NULLs as
-- distinct, so INSERT IGNORE alone would add a second row on re-run. Turning it on is an owner decision on the Config Flags screen.
INSERT INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
SELECT UUID(), NULL, NULL, 'increment_package_split_enabled', 'false',
  'When true, an approved and implemented salary increment request is priced by payroll: from its effective date the employee gets the catalog package for the approved CTC, and an increment effective mid-month splits that month by calendar days (days before the effective date at the old package, the rest at the new one). Applies to increment requests only, not the Salary Change screen, and only where the employee package row is older than the increment. Default false = unchanged behaviour.'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM payroll_config_flags
  WHERE branch_id IS NULL AND process_id IS NULL AND config_key = 'increment_package_split_enabled'
);
