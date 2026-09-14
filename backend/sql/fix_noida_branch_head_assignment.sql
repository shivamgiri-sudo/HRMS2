-- Fix: assign Sudeep Negi as active Branch Head for Noida branch
-- Run this on mas_hrms AFTER confirming the correct employee UUID.
--
-- Step 1: verify Sudeep Negi's employee ID and Noida's exact branch_name
SELECT e.id AS employee_id, e.full_name, e.employee_code, e.active_status
FROM employees e
WHERE e.full_name LIKE '%Sudeep%Negi%'
  AND e.active_status = 1
LIMIT 5;

SELECT id AS branch_master_id, branch_name, city
FROM branch_master
WHERE branch_name LIKE '%NOIDA%' OR branch_name LIKE '%Noida%' OR city LIKE '%Noida%'
LIMIT 5;

-- Step 2: deactivate any existing placeholder/incorrect assignments for Noida
-- (replace 'NOIDA' with the exact branch_name from the SELECT above)
UPDATE branch_head_assignments
SET is_active = FALSE
WHERE branch_name = 'NOIDA'  -- ← replace with exact branch_name from Step 1
  AND is_active = TRUE;

-- Step 3: insert the correct assignment
-- Replace the UUIDs below with actual values from Step 1.
INSERT INTO branch_head_assignments
  (id, branch_name, branch_head_id, is_active, assigned_by, notes)
VALUES (
  UUID(),
  'NOIDA',                                           -- ← exact branch_name from branch_master
  'REPLACE_WITH_SUDEEP_NEGI_EMPLOYEE_UUID',          -- ← e.id from Step 1
  TRUE,
  'REPLACE_WITH_SUPER_ADMIN_EMPLOYEE_UUID',          -- ← super admin who is authorising this
  'Noida Branch Head — Sudeep Negi (assigned 2026-08-25)'
);

-- Step 4: verify the assignment is live
SELECT bha.id, bha.branch_name, bha.is_active, e.full_name, e.employee_code
FROM branch_head_assignments bha
JOIN employees e ON e.id = bha.branch_head_id
WHERE bha.branch_name LIKE '%NOIDA%' OR bha.branch_name LIKE '%Noida%'
ORDER BY bha.is_active DESC;
