-- 1884_employees_salary_start_check_v2.sql
-- Replace chk_ssd_not_before_doj (migration 1857) with a check that still refuses an
-- unauthorised salary_start_date < date_of_joining, but allows the one sanctioned exception:
-- Payroll Head backdating with a recorded reason (employees.salary_start_pre_joining_approved = 1,
-- set only by salary-start-date.service.ts; see 1883).
--
-- WHY 1857's CHECK HAD TO GO
-- Payroll Head's package assign / approve paths deliberately allow a salary start before joining
-- (owner-confirmed backdating). Their write to employees.salary_start_date then hit 1857's CHECK,
-- and syncSalaryStartDateEverywhere() swallowed the error (`.catch(() => {})`). Result, live
-- 2026-09-25: 70 of 213 HRMS-onboarded employees carry Payroll Head's backdated date on the
-- assignment and validation rows but the joining date on employees.salary_start_date - the column
-- payroll actually reads to skip/cap a month. That silent failure is fixed in the service; this
-- migration removes the constraint that made the sanctioned write impossible.
--
-- Single ALTER (drop + add together) so there is never a window with no constraint, and one table
-- rebuild instead of two. Guarded on the v2 name so a replay is a no-op. The old constraint is
-- dropped only if present (fresh installs get it from 1857 first).

SET @v2_exists = (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employees'
     AND CONSTRAINT_NAME = 'chk_ssd_not_before_doj_v2'
     AND CONSTRAINT_TYPE = 'CHECK'
);
SET @v1_exists = (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employees'
     AND CONSTRAINT_NAME = 'chk_ssd_not_before_doj'
     AND CONSTRAINT_TYPE = 'CHECK'
);
SET @sql = IF(@v2_exists = 0,
  CONCAT(
    'ALTER TABLE employees ',
    IF(@v1_exists > 0, 'DROP CHECK chk_ssd_not_before_doj, ', ''),
    'ADD CONSTRAINT chk_ssd_not_before_doj_v2 CHECK (',
    'salary_start_date IS NULL OR salary_start_date >= date_of_joining OR salary_start_pre_joining_approved = 1)'
  ),
  'SELECT ''employees.chk_ssd_not_before_doj_v2 already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
