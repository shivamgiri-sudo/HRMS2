-- Fix Salary Gap for MAS47814 (Shivam Shiv Giri) - Version 2
-- Employee: MANAGER, TRAINING AND QUALITY, NOIDA-2
-- Issue: No salary records despite being active since 2021

USE mas_hrms;

-- ============================================================================
-- STEP 1: Create salary structure assignment
-- ============================================================================

INSERT INTO employee_salary_assignment (
    id,
    employee_id,
    structure_id,
    ctc_annual,
    effective_from,
    effective_to,
    active_status,
    created_at
)
VALUES (
    UUID(),
    '8b13186b-6584-11f1-adb1-00155d0ab410', -- MAS47814
    'ss-mgr-001', -- Manager Monthly Structure
    480000.00, -- 40,000 per month
    '2021-03-14',
    NULL,
    1,
    NOW()
);

-- ============================================================================
-- STEP 2: Create or get salary prep run for March 2026
-- ============================================================================

-- Check if run exists
SELECT @existing_run := id FROM salary_prep_run
WHERE run_month = '2026-03' AND status = 'FINALIZED'
LIMIT 1;

-- Create run if it doesn't exist
INSERT INTO salary_prep_run (
    id,
    run_month,
    status,
    created_at
)
SELECT UUID(), '2026-03', 'FINALIZED', NOW()
WHERE @existing_run IS NULL;

-- Get the run_id
SELECT @run_id := id FROM salary_prep_run
WHERE run_month = '2026-03'
LIMIT 1;

-- ============================================================================
-- STEP 3: Create salary prep line (monthly payroll)
-- ============================================================================

INSERT INTO salary_prep_line (
    id,
    run_id,
    employee_id,
    employee_code,
    basic,
    hra,
    special_allowance,
    gross_salary,
    total_deductions,
    net_salary,
    employer_pf,
    employer_esic,
    status,
    created_at
)
VALUES (
    UUID(),
    @run_id,
    '8b13186b-6584-11f1-adb1-00155d0ab410',
    'MAS47814',
    16000.00,  -- Basic (40%)
    8000.00,   -- HRA (20%)
    15000.00,  -- Special Allowance
    40000.00,  -- Gross (Manager level)
    1200.00,   -- Deductions (PF + PT)
    38800.00,  -- Net
    1200.00,   -- Employer PF
    0.00,      -- Employer ESIC
    'APPROVED',
    NOW()
);

-- Get line_id for components
SELECT @line_id := id FROM salary_prep_line
WHERE employee_id = '8b13186b-6584-11f1-adb1-00155d0ab410'
AND run_id = @run_id
LIMIT 1;

-- ============================================================================
-- STEP 4: Create component breakdown
-- ============================================================================

INSERT INTO salary_prep_line_component (
    id, line_id, employee_id, component_code, component_name, component_type, amount, taxable, created_at
) VALUES
-- Earnings
(UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'BASIC', 'Basic Salary', 'earning', 16000.00, 1, NOW()),
(UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'HRA', 'House Rent Allowance', 'earning', 8000.00, 1, NOW()),
(UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'SPECIAL', 'Special Allowance', 'earning', 15000.00, 1, NOW()),
(UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'TA', 'Travel Allowance', 'earning', 1000.00, 0, NOW()),
-- Deductions
(UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'PF_EMP', 'Provident Fund (Employee)', 'deduction', 1200.00, 0, NOW()),
(UUID(), @line_id, '8b13186b-6584-11f1-adb1-00155d0ab410', 'PT', 'Professional Tax', 'deduction', 0.00, 0, NOW());

-- ============================================================================
-- STEP 5: Create payslip record
-- ============================================================================

INSERT INTO salary_payslip (
    id,
    employee_id,
    run_id,
    payslip_ref,
    gross_amount,
    net_amount,
    generated_at,
    created_at
)
VALUES (
    UUID(),
    '8b13186b-6584-11f1-adb1-00155d0ab410',
    @run_id,
    CONCAT('PAY-MAS47814-202603'),
    40000.00,
    38800.00,
    NOW(),
    NOW()
);

-- ============================================================================
-- STEP 6: Fix duplicate email - Link auth_user to MAS47814
-- ============================================================================

UPDATE employees
SET user_id = 'a4a4902e-6222-11f1-adb1-00155d0ab410'
WHERE employee_code = 'MAS47814'
AND user_id IS NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT '=== VERIFICATION RESULTS ===' as status;

SELECT 'Salary Structure' as check_name, COUNT(*) as records
FROM employee_salary_assignment
WHERE employee_id = '8b13186b-6584-11f1-adb1-00155d0ab410';

SELECT 'Salary Prep Line' as check_name, COUNT(*) as records
FROM salary_prep_line
WHERE employee_id = '8b13186b-6584-11f1-adb1-00155d0ab410';

SELECT 'Component Breakdown' as check_name, COUNT(*) as records
FROM salary_prep_line_component
WHERE employee_id = '8b13186b-6584-11f1-adb1-00155d0ab410';

SELECT 'Payslip Record' as check_name, COUNT(*) as records
FROM salary_payslip
WHERE employee_id = '8b13186b-6584-11f1-adb1-00155d0ab410';

SELECT
    e.employee_code,
    e.first_name,
    e.last_name,
    CASE WHEN e.user_id IS NOT NULL THEN 'YES' ELSE 'NO' END as can_login,
    spl.gross_salary,
    spl.net_salary
FROM employees e
LEFT JOIN salary_prep_line spl ON CAST(spl.employee_id AS CHAR) = CAST(e.id AS CHAR)
WHERE e.employee_code = 'MAS47814'
LIMIT 1;
