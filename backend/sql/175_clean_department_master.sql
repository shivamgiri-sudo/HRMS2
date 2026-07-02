-- 175_clean_department_master.sql
-- Removes 23 garbage/duplicate department rows from department_master,
-- keeping only the 10 canonical departments matching db_bill.Department_Master.
-- Active employees referencing garbage departments are remapped to canonical ones first.

-- ── Step 1: Remap employees from duplicate/garbage depts → canonical ──────────

-- HUMAN_RESOURCE_AND_DEVELOPMENT (11 emps) → HR
UPDATE employees
SET department_id = (SELECT id FROM department_master WHERE dept_code = 'HR' LIMIT 1)
WHERE department_id = (SELECT id FROM department_master WHERE dept_code = 'HUMAN_RESOURCE_AND_DEVELOPMENT' LIMIT 1);

-- INFORMATION_TECHNOLOGY duplicate (9 emps) → IT
UPDATE employees
SET department_id = (SELECT id FROM department_master WHERE dept_code = 'IT' LIMIT 1)
WHERE department_id = (SELECT id FROM department_master WHERE dept_code = 'INFORMATION_TECHNOLOGY' LIMIT 1);

-- OPS (4 emps) → OPERATIONS
UPDATE employees
SET department_id = (SELECT id FROM department_master WHERE dept_code = 'OPERATIONS' LIMIT 1)
WHERE department_id = (SELECT id FROM department_master WHERE dept_code = 'OPS' LIMIT 1);

-- ADMINISTRATION_FINANCE__ACCOUNTS (1 emp) → ADMIN
UPDATE employees
SET department_id = (SELECT id FROM department_master WHERE dept_code = 'ADMIN' LIMIT 1)
WHERE department_id = (SELECT id FROM department_master WHERE dept_code = 'ADMINISTRATION_FINANCE__ACCOUNTS' LIMIT 1);

-- MANAGEMENT duplicate (1 emp) → MGT
UPDATE employees
SET department_id = (SELECT id FROM department_master WHERE dept_code = 'MGT' LIMIT 1)
WHERE department_id = (SELECT id FROM department_master WHERE dept_code = 'MANAGEMENT' LIMIT 1);

-- QUALITY (1 emp) → TRAINING (TRAINING AND QUALITY)
UPDATE employees
SET department_id = (SELECT id FROM department_master WHERE dept_code = 'TRAINING' LIMIT 1)
WHERE department_id = (SELECT id FROM department_master WHERE dept_code = 'QUALITY' LIMIT 1);

-- 8059435856 garbage (1 emp) → OPERATIONS
UPDATE employees
SET department_id = (SELECT id FROM department_master WHERE dept_code = 'OPERATIONS' LIMIT 1)
WHERE department_id = (SELECT id FROM department_master WHERE dept_code = '8059435856' LIMIT 1);

-- ── Step 2: Also remap any other tables with FK references ─────────────────────

-- cost_centre_master
UPDATE cost_centre_master SET department_id = (SELECT id FROM department_master WHERE dept_code='HR' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='HUMAN_RESOURCE_AND_DEVELOPMENT' LIMIT 1);
UPDATE cost_centre_master SET department_id = (SELECT id FROM department_master WHERE dept_code='IT' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='INFORMATION_TECHNOLOGY' LIMIT 1);
UPDATE cost_centre_master SET department_id = (SELECT id FROM department_master WHERE dept_code='OPERATIONS' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='OPS' LIMIT 1);
UPDATE cost_centre_master SET department_id = (SELECT id FROM department_master WHERE dept_code='ADMIN' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='ADMINISTRATION_FINANCE__ACCOUNTS' LIMIT 1);
UPDATE cost_centre_master SET department_id = (SELECT id FROM department_master WHERE dept_code='MGT' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='MANAGEMENT' LIMIT 1);
UPDATE cost_centre_master SET department_id = (SELECT id FROM department_master WHERE dept_code='TRAINING' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='QUALITY' LIMIT 1);
UPDATE cost_centre_master SET department_id = (SELECT id FROM department_master WHERE dept_code='OPERATIONS' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='8059435856' LIMIT 1);

-- manpower_requisition
UPDATE manpower_requisition SET department_id = (SELECT id FROM department_master WHERE dept_code='HR' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='HUMAN_RESOURCE_AND_DEVELOPMENT' LIMIT 1);
UPDATE manpower_requisition SET department_id = (SELECT id FROM department_master WHERE dept_code='IT' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='INFORMATION_TECHNOLOGY' LIMIT 1);
UPDATE manpower_requisition SET department_id = (SELECT id FROM department_master WHERE dept_code='OPERATIONS' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='OPS' LIMIT 1);
UPDATE manpower_requisition SET department_id = (SELECT id FROM department_master WHERE dept_code='ADMIN' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='ADMINISTRATION_FINANCE__ACCOUNTS' LIMIT 1);
UPDATE manpower_requisition SET department_id = (SELECT id FROM department_master WHERE dept_code='MGT' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='MANAGEMENT' LIMIT 1);
UPDATE manpower_requisition SET department_id = (SELECT id FROM department_master WHERE dept_code='TRAINING' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='QUALITY' LIMIT 1);

-- ats_employment_offer
UPDATE ats_employment_offer SET department_id = (SELECT id FROM department_master WHERE dept_code='HR' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='HUMAN_RESOURCE_AND_DEVELOPMENT' LIMIT 1);
UPDATE ats_employment_offer SET department_id = (SELECT id FROM department_master WHERE dept_code='IT' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='INFORMATION_TECHNOLOGY' LIMIT 1);
UPDATE ats_employment_offer SET department_id = (SELECT id FROM department_master WHERE dept_code='OPERATIONS' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='OPS' LIMIT 1);
UPDATE ats_employment_offer SET department_id = (SELECT id FROM department_master WHERE dept_code='ADMIN' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='ADMINISTRATION_FINANCE__ACCOUNTS' LIMIT 1);
UPDATE ats_employment_offer SET department_id = (SELECT id FROM department_master WHERE dept_code='MGT' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='MANAGEMENT' LIMIT 1);
UPDATE ats_employment_offer SET department_id = (SELECT id FROM department_master WHERE dept_code='TRAINING' LIMIT 1) WHERE department_id = (SELECT id FROM department_master WHERE dept_code='QUALITY' LIMIT 1);

-- ── Step 3: Delete all 23 non-canonical department rows ───────────────────────

DELETE FROM department_master WHERE dept_code NOT IN (
  'MGT', 'FINANCE', 'IT', 'OPERATIONS', 'SALES', 'TRAINING', 'ADMIN', 'HR', 'DIALER', 'COMPLIANCE'
);
