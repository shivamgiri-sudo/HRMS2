-- 205_leave_policy_config_fix.sql
-- Add pool_with column to leave_policy_config for CL+ML combined pool
-- Note: MySQL 8.0 does not support ADD COLUMN IF NOT EXISTS; run only if column is absent
ALTER TABLE leave_policy_config
ADD COLUMN pool_with VARCHAR(20) NULL COMMENT 'leave_code to pool balance with (e.g. CL pools with ML)';

-- Fix CL policy: 0.583/month, max 7/year, pools with ML
UPDATE leave_policy_config lpc
JOIN leave_type_master lt ON lt.id = lpc.leave_type_id
SET lpc.monthly_credit_days = 0.583,
    lpc.annual_credit_days = 0,
    lpc.credit_on_jan_first = 0,
    lpc.max_days_per_month = 0,
    lpc.max_occurrences_per_year = 0,
    lpc.max_days_per_occurrence = 0,
    lpc.pool_with = 'ML'
WHERE lt.leave_code = 'CL';

-- Fix ML policy: 0.417/month, max 5/year, pools with CL
-- NOT EXISTS guard prevents duplicate insertion on re-run
INSERT INTO leave_policy_config (id, leave_type_id, monthly_credit_days, annual_credit_days, credit_on_jan_first, max_days_per_month, max_occurrences_per_year, max_days_per_occurrence, pool_with)
SELECT UUID(), lt.id, 0.417, 0, 0, 0, 0, 0, 'CL'
FROM leave_type_master lt
WHERE lt.leave_code = 'ML'
AND NOT EXISTS (SELECT 1 FROM leave_policy_config lpc2 JOIN leave_type_master lt2 ON lt2.id = lpc2.leave_type_id WHERE lt2.leave_code = 'ML');

-- Fix EL policy: 1.5/month accumulation, no annual lump sum, no Jan 1 credit
UPDATE leave_policy_config lpc
JOIN leave_type_master lt ON lt.id = lpc.leave_type_id
SET lpc.monthly_credit_days = 1.500,
    lpc.annual_credit_days = 0,
    lpc.credit_on_jan_first = 0,
    lpc.pool_with = NULL
WHERE lt.leave_code = 'EL';

-- Add PTRL policy: 4 days annual on Jan 1
INSERT INTO leave_policy_config (id, leave_type_id, monthly_credit_days, annual_credit_days, credit_on_jan_first, max_days_per_month, max_occurrences_per_year, max_days_per_occurrence, pool_with)
SELECT UUID(), lt.id, 0, 4, 1, 0, 0, 4, NULL
FROM leave_type_master lt
WHERE lt.leave_code = 'PTRL'
AND NOT EXISTS (SELECT 1 FROM leave_policy_config lpc2 JOIN leave_type_master lt2 ON lt2.id = lpc2.leave_type_id WHERE lt2.leave_code = 'PTRL');

-- Add MTRL policy: 180 days annual on Jan 1
INSERT INTO leave_policy_config (id, leave_type_id, monthly_credit_days, annual_credit_days, credit_on_jan_first, max_days_per_month, max_occurrences_per_year, max_days_per_occurrence, pool_with)
SELECT UUID(), lt.id, 0, 180, 1, 0, 0, 180, NULL
FROM leave_type_master lt
WHERE lt.leave_code = 'MTRL'
AND NOT EXISTS (SELECT 1 FROM leave_policy_config lpc2 JOIN leave_type_master lt2 ON lt2.id = lpc2.leave_type_id WHERE lt2.leave_code = 'MTRL');
