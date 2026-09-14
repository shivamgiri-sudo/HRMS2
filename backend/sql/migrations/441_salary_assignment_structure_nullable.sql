-- 441_salary_assignment_structure_nullable.sql
-- employee_salary_assignment.structure_id was NOT NULL with a FK to
-- salary_structure_master. The orchestrator hardcoded 'ss-std-001', which only
-- exists in demo data (043_demo_data.sql), so every production offer approval
-- threw ER_NO_REFERENCED_ROW_2 -> 500 "An unexpected server error occurred."
-- No employee was created; the branch-head decision row was left as 'approved'
-- with no employee behind it (the same stranded-state bug documented in
-- offerApprovalCrash.contract.test.ts for the Sofiya Sultan incident).
--
-- Fix: make structure_id nullable and drop the now-unenforceable FK.
-- Payroll HR can assign a structure later via the salary-increment workflow.

SET @db = DATABASE();

-- 1. Drop the FK if it exists (constraint name varies; locate it first).
SET @fk = (
  SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = @db
     AND TABLE_NAME   = 'employee_salary_assignment'
     AND COLUMN_NAME  = 'structure_id'
     AND REFERENCED_TABLE_NAME = 'salary_structure_master'
   LIMIT 1
);

SET @drop_fk = IF(
  @fk IS NOT NULL,
  CONCAT('ALTER TABLE employee_salary_assignment DROP FOREIGN KEY `', @fk, '`'),
  'SELECT "no FK to drop" AS info'
);
PREPARE _s FROM @drop_fk; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 2. Make the column nullable.
SET @col_nullable = (
  SELECT IS_NULLABLE
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db
     AND TABLE_NAME   = 'employee_salary_assignment'
     AND COLUMN_NAME  = 'structure_id'
);

SET @alter = IF(
  @col_nullable = 'NO',
  'ALTER TABLE employee_salary_assignment MODIFY COLUMN structure_id CHAR(36) NULL',
  'SELECT "structure_id already nullable" AS info'
);
PREPARE _s FROM @alter; EXECUTE _s; DEALLOCATE PREPARE _s;