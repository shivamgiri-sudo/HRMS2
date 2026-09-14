-- Migration: 445_salary_component_assignments_employee_pf_esic.sql
-- Purpose: Add employee-side PF/ESIC amount columns to salary_component_assignments
--          and backfill them from salary_package_master.
-- Date: 2026-08-26
-- Issue: salary_component_assignments has no column for the employee-side PF/ESIC
--        amounts — only pf_applicable/esi_applicable booleans and employer_pf/
--        employer_esi (the EMPLOYER-side amounts). The real employee-side amounts
--        live in salary_package_master.epf_employee/esic_employee. The Payroll Head
--        salary-review aggregation query (payroll-head-review.service.ts) already
--        joins salary_package_master and computes pf_employee_amt/esic_employee_amt,
--        but never sent them to the frontend under the field names it actually reads
--        (sc.pf_employee / sc.esic_employee), so PF (Emp) / ESIC (Emp) always showed
--        "No"/"—" even when a real amount exists. This migration adds the two
--        columns so the amount can be written at assignment time going forward and
--        backfills existing rows from the linked package. Purely additive: it does
--        not touch pf_applicable, esi_applicable, employer_pf, employer_esi or any
--        other existing column.

-- ============================================================================
-- 1. Add pf_employee / esic_employee columns, idempotently.
-- ============================================================================

SET @pf_employee_col_exists = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'salary_component_assignments'
     AND COLUMN_NAME = 'pf_employee'
);

SET @sql = IF(@pf_employee_col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN pf_employee DECIMAL(10,2) NULL AFTER employer_esi',
  'SELECT ''pf_employee column already exists on salary_component_assignments'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @esic_employee_col_exists = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'salary_component_assignments'
     AND COLUMN_NAME = 'esic_employee'
);

SET @sql = IF(@esic_employee_col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN esic_employee DECIMAL(10,2) NULL AFTER pf_employee',
  'SELECT ''esic_employee column already exists on salary_component_assignments'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 2. Backfill existing rows from the linked package — only where currently
--    NULL, so a re-run of this migration (or a future run against rows that
--    already have a real assigned value) is a no-op and never overwrites
--    anything already set.
-- ============================================================================

UPDATE salary_component_assignments sca
  JOIN salary_package_master pm ON pm.id = sca.package_id
   SET sca.pf_employee = pm.epf_employee,
       sca.esic_employee = pm.esic_employee
 WHERE sca.pf_employee IS NULL
   AND pm.epf_employee IS NOT NULL;

SELECT '✓ Migration 445_salary_component_assignments_employee_pf_esic.sql complete' AS status;
