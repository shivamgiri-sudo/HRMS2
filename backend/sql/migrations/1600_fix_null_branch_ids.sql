-- Fix employees with NULL branch_id by matching to branch_master
-- Run: mysql -u root -p mas_hrms < migrations/1600_fix_null_branch_ids.sql

-- First, show current state
SELECT 'Employees with NULL branch_id (Active):' AS status;
SELECT employee_code, full_name, branch_id, cost_centre_name
FROM employees
WHERE branch_id IS NULL AND employment_status = 'Active'
ORDER BY employee_code;

-- Show available branches
SELECT 'Available branches:' AS status;
SELECT id, branch_name, branch_code FROM branch_master ORDER BY branch_name;

-- Update employees where we can match cost_centre_name to branch_name
UPDATE employees e
JOIN branch_master bm ON UPPER(TRIM(e.cost_centre_name)) = UPPER(TRIM(bm.branch_name))
SET e.branch_id = bm.id
WHERE e.branch_id IS NULL
  AND e.employment_status = 'Active'
  AND e.cost_centre_name IS NOT NULL;

SELECT CONCAT('Updated via cost_centre_name match: ', ROW_COUNT()) AS result;

-- Specific fix: MAS53006 → NOIDA (if still NULL)
UPDATE employees e
JOIN branch_master bm ON bm.branch_name = 'NOIDA'
SET e.branch_id = bm.id
WHERE e.employee_code = 'MAS53006'
  AND e.branch_id IS NULL;

SELECT CONCAT('Updated MAS53006 to NOIDA: ', ROW_COUNT()) AS result;

-- Show remaining NULL branch_id employees
SELECT 'Remaining employees with NULL branch_id:' AS status;
SELECT employee_code, full_name, branch_id, cost_centre_name
FROM employees
WHERE branch_id IS NULL AND employment_status = 'Active'
ORDER BY employee_code;
