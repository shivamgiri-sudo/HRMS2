-- Migration 1780: employee_master_snapshot -- add salary_effective_date, joining_month
--
-- Owner-requested 2026-09-16: add a "Salary Start Date" column and a "Joining Month" (MMM'YY)
-- column to the Employee Master report. Both are already computed by employeeMasterLive()
-- (employee.executor.ts) -- salary_effective_date from employee_salary_assignment /
-- salary_component_assignments, joining_month derived from date_of_joining -- and now listed in
-- report-catalog.ts's "employee-master" columns and in SNAPSHOT_COLUMNS
-- (employee-master-snapshot.service.ts), so the cached snapshot table this report actually reads
-- from (employee_master_snapshot, migration 1615) needs the matching columns before the next
-- refresh can insert into them.
--
-- Also part of the same 2026-09-16 fix (no schema change needed for this half): CTC/Gross/
-- NetInHand on this report now read salary_component_assignments / employee_salary_assignment
-- first -- the tables Payroll Head's final-salary review actually writes to -- instead of the
-- mostly-empty employee_salary_snapshot mirror that never updates after an employee is hired
-- (root cause of MAS63459/RAVIKAR MISHRA showing a stale CTC).
--
-- TEXT, matching every other column on this table (see 1615's own note: legacy free-text data
-- carries unpredictable garbage lengths, so a sized VARCHAR is a trap on this table).
--
-- Purely additive. Idempotent via individual INFORMATION_SCHEMA.COLUMNS guards (ADD COLUMN IF
-- NOT EXISTS is MariaDB-only syntax MySQL 8.0 rejects).

SET @tbl = 'employee_master_snapshot';

SET @sql = (SELECT IF(COUNT(*)=0,
  CONCAT('ALTER TABLE `',@tbl,'` ADD COLUMN salary_effective_date TEXT NULL COMMENT ''Salary Start Date -- effective_date of the active salary_component_assignments/employee_salary_assignment row'''),
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@tbl AND COLUMN_NAME='salary_effective_date');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(COUNT(*)=0,
  CONCAT('ALTER TABLE `',@tbl,'` ADD COLUMN joining_month TEXT NULL COMMENT ''Joining Month, MMM quote YY format -- derived from date_of_joining'''),
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@tbl AND COLUMN_NAME='joining_month');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
