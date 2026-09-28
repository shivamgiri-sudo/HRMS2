-- Fix employees where salary_start_date was incorrectly set before date_of_joining.
-- Root cause: direct-create and PATCH-update paths had no >= DOJ guard, allowing
-- batch imports to store salary_start_date = start-of-month regardless of actual DOJ.
-- Corrective action: reset salary_start_date to date_of_joining for all affected rows.

UPDATE employees
SET    salary_start_date = date_of_joining
WHERE  salary_start_date IS NOT NULL
  AND  date_of_joining   IS NOT NULL
  AND  salary_start_date < date_of_joining;

-- Confirm: after this migration the count below must be 0.
-- SELECT COUNT(*) FROM employees
-- WHERE salary_start_date < date_of_joining;
