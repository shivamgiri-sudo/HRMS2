-- Migration: Update 6 duplicate employees with db_bill data (where available/newer)
-- These records exist in mas_hrms but have incomplete/outdated info in db_bill
-- WARNING: Changing employee_code breaks FKs, payroll history, role assignments
-- Instead, UPDATE with missing/newer data from db_bill
-- Generated: 2026-09-01

START TRANSACTION;

-- MAS63430 (JASWANT SINGH): Update email (db_bill has js80985@gmail.com, mas has js380985@gmail.com)
-- Keep mas_hrms code since it may have payroll/history attached
UPDATE employees
SET email = 'js80985@gmail.com',
    updated_at = NOW()
WHERE employee_code = 'MAS63430' AND full_name LIKE '%JASWANT SINGH%';

-- MAS61901 (NAMAN KUMAR SHARMA): Add EPF/UAN from db_bill
UPDATE employees
SET epf_number = 'DSNHP00320260000031346',
    uan_number = '102315791088',
    updated_at = NOW()
WHERE employee_code = 'MAS61901' AND full_name LIKE '%NAMAN%SHARMA%';

-- MAS63313 (ALTAF RAJA): Normalize name case, add PAN
UPDATE employees
SET full_name = 'ALTAF RAJA',
    pan_number = 'GGZPR1154P',
    updated_at = NOW()
WHERE employee_code = 'MAS63313';

-- MAS57089 (HARSH SIROHI): All fields match, no update needed
-- SKIP - MAS63397 data in db_bill matches perfectly

-- MAS63292 (SAIF ANSARI): Update email (db_bill has saifansari4334@gmail.com, mas has saifansari72214@gmail.com)
-- Decision: Keep mas_hrms email (may be more recent/verified). Comment for manual review.
-- UPDATE employees
-- SET email = 'saifansari4334@gmail.com',
--     updated_at = NOW()
-- WHERE employee_code = 'MAS63292' AND full_name LIKE '%SAIF%ANSARI%';

-- MAS63449 (NITIN RANA): Add PAN from db_bill
UPDATE employees
SET pan_number = 'FNQPR0118L',
    updated_at = NOW()
WHERE employee_code = 'MAS63449' AND full_name LIKE '%NITIN%RANA%';

-- Verify updates
SELECT employee_code, full_name, email, pan_number, epf_number, uan_number
FROM employees
WHERE employee_code IN ('MAS63430', 'MAS61901', 'MAS63313', 'MAS57089', 'MAS63292', 'MAS63449')
ORDER BY employee_code;

COMMIT;
