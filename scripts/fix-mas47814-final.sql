-- Fix Salary Gap for MAS47814 - FINAL VERSION
USE mas_hrms;

-- Step 1: Create salary structure assignment
INSERT INTO employee_salary_assignment (
    id, employee_id, structure_id, ctc_annual, effective_from, effective_to, active_status, created_at
) VALUES (
    UUID(),
    '8b13186b-6584-11f1-adb1-00155d0ab410',
    'ss-mgr-001',
    480000.00,
    '2021-03-14',
    NULL,
    1,
    NOW()
);

-- Step 2: Get run_id for March 2026
SET @run_id = (SELECT id FROM salary_prep_run WHERE run_month = '2026-03' LIMIT 1);

-- If no run exists, create one
INSERT INTO salary_prep_run (id, run_month, status, created_at)
SELECT UUID(), '2026-03', 'FINALIZED', NOW()
WHERE @run_id IS NULL;

SET @run_id = (SELECT id FROM salary_prep_run WHERE run_month = '2026-03' LIMIT 1);

-- Step 3: Create salary prep line with correct columns
INSERT INTO salary_prep_line (
    id,
    run_id,
    employee_id,
    employee_code,
    working_days,
    present_days,
    leave_days,
    lwp_days,
    late_marks,
    gross_salary,
    total_deductions,
    net_salary,
    pf_employee,
    pf_employer,
    esic_employee,
    esic_employer,
    professional_tax,
    tds,
    tds_amount,
    lwp_deduction,
    advance_recovery,
    basic,
    hra,
    special_allowance,
    status,
    created_at
) VALUES (
    UUID(),
    @run_id,
    '8b13186b-6584-11f1-adb1-00155d0ab410',
    'MAS47814',
    26.00,      -- working_days
    26.00,      -- present_days
    0.00,       -- leave_days
    0.00,       -- lwp_days
    0,          -- late_marks
    40000.00,   -- gross_salary
    1200.00,    -- total_deductions
    38800.00,   -- net_salary
    1200.00,    -- pf_employee
    1200.00,    -- pf_employer
    0.00,       -- esic_employee
    0.00,       -- esic_employer
    0.00,       -- professional_tax
    0.00,       -- tds
    0.00,       -- tds_amount
    0.00,       -- lwp_deduction
    0.00,       -- advance_recovery
    16000.00,   -- basic
    8000.00,    -- hra
    15000.00,   -- special_allowance
    'APPROVED',
    NOW()
);

-- Step 4: Get line_id
SET @line_id = (
    SELECT id FROM salary_prep_line
    WHERE employee_id = '8b13186b-6584-11f1-adb1-00155d0ab410'
    AND run_id = @run_id
    LIMIT 1
);

-- Step 5: Create components
INSERT INTO salary_prep_line_component
    (id, line_id, employee_id, component_code, component_name, component_type, amount, taxable, created_at)
VALUES
    (UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'BASIC', 'Basic Salary', 'earning', 16000.00, 1, NOW()),
    (UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'HRA', 'House Rent Allowance', 'earning', 8000.00, 1, NOW()),
    (UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'SPECIAL', 'Special Allowance', 'earning', 15000.00, 1, NOW()),
    (UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'TA', 'Travel Allowance', 'earning', 1000.00, 0, NOW()),
    (UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'PF_EMP', 'Provident Fund', 'deduction', 1200.00, 0, NOW()),
    (UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'PT', 'Professional Tax', 'deduction', 0.00, 0, NOW());

-- Step 6: Create payslip
INSERT INTO salary_payslip (
    id, employee_id, run_id, payslip_ref, gross_amount, net_amount, generated_at, created_at
) VALUES (
    UUID(),
    '8b13186b-6584-11f1-adb1-00155d0ab410',
    @run_id,
    'PAY-MAS47814-202603',
    40000.00,
    38800.00,
    NOW(),
    NOW()
);

-- Step 7: Fix auth - link user_id
UPDATE employees
SET user_id = 'a4a4902e-6222-11f1-adb1-00155d0ab410'
WHERE employee_code = 'MAS47814' AND user_id IS NULL;

-- VERIFICATION
SELECT '✅ Fix Complete' as status;
SELECT employee_code, first_name, gross_salary, net_salary
FROM salary_prep_line spl
JOIN employees e ON CAST(e.id AS CHAR) = CAST(spl.employee_id AS CHAR)
WHERE employee_code = 'MAS47814';
