-- Update CL/ML combined monthly cap from 1 to 2
-- Policy: employees may take up to 2 combined CL+ML days per calendar month
UPDATE business_policy_config
SET config_value  = '2',
    default_value = '2'
WHERE domain_key  = 'leave'
  AND section_key = 'cl_ml_policy'
  AND config_key  = 'monthly_cap_days';
