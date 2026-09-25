-- 1884_employees_salary_start_check_v2.sql
-- Drop employees CHECK chk_ssd_not_before_doj (migration 1857).
--
-- WHY. Payroll Head's package assign / approve paths deliberately allow a salary start before
-- joining (owner-confirmed backdating). Their write to employees.salary_start_date hit this CHECK
-- and the old sync helper swallowed the error, so employees.salary_start_date - the column payroll
-- reads - stayed on the joining date for 70 of 213 HRMS-onboarded employees (live 2026-09-25).
--
-- DROP CHECK is metadata-only (no table rebuild). The rule it enforced is now enforced by
-- salary-start-date.service.ts on every write path (a date before joining needs payroll_head /
-- super_admin authority and a recorded reason). A replacement database-level CHECK that honours
-- employees.salary_start_pre_joining_approved (added in 1883) needs a full rebuild of employees
-- (~15+ minutes on production, writes blocked), so it is deliberately left for a maintenance window.
-- Guarded, replay-safe.

SET @v1_exists = (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employees'
     AND CONSTRAINT_NAME = 'chk_ssd_not_before_doj'
     AND CONSTRAINT_TYPE = 'CHECK'
);
SET @sql = IF(@v1_exists > 0,
  'ALTER TABLE employees DROP CHECK chk_ssd_not_before_doj',
  'SELECT ''employees.chk_ssd_not_before_doj already dropped'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
