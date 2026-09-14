-- 204_leave_type_master_fix.sql
-- Fix leave type master to match db_bill policy

-- CL: 7 days/year, monthly accrual, no carry-forward
UPDATE leave_type_master
SET leave_name = 'Casual Leave', max_days_per_year = 7, carry_forward = 0, active_status = 1
WHERE leave_code = 'CL';

-- ML: repurpose from Maternity → Medical Leave, 5 days/year, monthly accrual, no carry-forward
UPDATE leave_type_master
SET leave_name = 'Medical Leave', max_days_per_year = 5, carry_forward = 0, active_status = 1
WHERE leave_code = 'ML';

-- EL: 18 days/year, monthly accumulation (handled in code), no carry-forward flag (logic is in accrual ledger)
UPDATE leave_type_master
SET max_days_per_year = 18, carry_forward = 0, active_status = 1
WHERE leave_code = 'EL';

-- PTRL: 4 days/year, annual Jan 1 credit, no carry-forward
UPDATE leave_type_master
SET leave_name = 'Paternity Leave', max_days_per_year = 4, carry_forward = 0, active_status = 1
WHERE leave_code = 'PTRL';

-- MTRL: 180 days/year, annual Jan 1 credit, no carry-forward
UPDATE leave_type_master
SET leave_name = 'Maternity Leave', max_days_per_year = 180, carry_forward = 0, active_status = 1
WHERE leave_code = 'MTRL';

-- Deactivate obsolete types
UPDATE leave_type_master
SET active_status = 0
WHERE leave_code IN ('SL', 'PL', 'DL', 'CO', 'PML');
