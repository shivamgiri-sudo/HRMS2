-- Migration 1857: Add CHECK constraint to prevent salary_start_date < date_of_joining
-- This is the DB-level safety net that backs up all application-level guards.
-- MySQL 8.0.16+ enforces CHECK constraints at write time.
--
-- The corrective migration 1856 already fixed all 35 bad rows in production,
-- so this constraint will apply cleanly with no existing violations.
--
-- NOTE: Payroll Head intentional backdating goes through salary_component_assignments /
-- employee_salary_assignment, NOT the employees.salary_start_date column directly.
-- That column tracks the "display" date, which must stay >= DOJ. Payroll Head's
-- effective_from on the assignment row is a different field not covered here.

ALTER TABLE employees
  ADD CONSTRAINT chk_ssd_not_before_doj
  CHECK (salary_start_date IS NULL OR salary_start_date >= date_of_joining);
