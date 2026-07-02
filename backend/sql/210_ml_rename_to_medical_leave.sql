-- 210_ml_rename_to_medical_leave.sql
-- ML was originally seeded as 'Maternity Leave' (006_leave.sql) but per company policy
-- ML = Medical Leave (5 days, all employees). MTRL = Maternity Leave (180 days, female only).
-- Migration 204 intended to fix this but was not applied to live DB.

UPDATE leave_type_master
SET leave_name = 'Medical Leave', max_days_per_year = 5, active_status = 1
WHERE leave_code = 'ML';

-- Ensure MTRL is correctly named and active
UPDATE leave_type_master
SET leave_name = 'Maternity Leave', max_days_per_year = 180, active_status = 1
WHERE leave_code = 'MTRL';

-- Ensure PTRL is correctly named and active
UPDATE leave_type_master
SET leave_name = 'Paternity Leave', max_days_per_year = 4, active_status = 1
WHERE leave_code = 'PTRL';

-- Deactivate obsolete types (idempotent)
UPDATE leave_type_master
SET active_status = 0
WHERE leave_code IN ('SL', 'PL', 'DL', 'CO', 'PML');
