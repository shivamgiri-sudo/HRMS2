-- Migration: Handle 6 duplicate employees (db_bill vs mas_hrms)
-- Generated: 2026-09-01
--
-- TREATMENT PLAN:
--
-- RENAME + STATUS UPDATE (Jaswant, Altaf, Nitin):
--   Old code → New db_bill code, update status/data to match db_bill
--
-- REJOIN (Naman, Harsh, Saif):
--   Old record = previous stint → mark date_of_leaving, keep as historical
--   New record = new stint with db_bill code → INSERT fresh row
--
-- NOIDA-2 branch_id = febd8777-6583-11f1-adb1-00155d0ab410

START TRANSACTION;

-- ══════════════════════════════════════════════════════════════
-- GROUP 1: RENAME + STATUS UPDATE
-- ══════════════════════════════════════════════════════════════

-- JASWANT SINGH: MAS63430 → MAS63390, status Active → inactive (db_bill correct)
UPDATE employees
SET employee_code    = 'MAS63390',
    employment_status = 'inactive',
    date_of_joining   = '2026-08-26',
    email             = 'js80985@gmail.com',
    aadhaar_number    = '724866822743',
    updated_at        = NOW()
WHERE employee_code = 'MAS63430';

-- ALTAF RAJA: MAS63313 → MAS63396, status Active → inactive, fix name case + add PAN
UPDATE employees
SET employee_code    = 'MAS63396',
    first_name       = 'ALTAF',
    last_name        = 'RAJA',
    employment_status = 'inactive',
    date_of_joining   = '2026-08-26',
    email             = 'altafraja7369892024@gmail.com',
    pan_number        = 'GGZPR1154P',
    aadhaar_number    = '319551836697',
    updated_at        = NOW()
WHERE employee_code = 'MAS63313';

-- NITIN RANA: MAS63449 → MAS63401, status preboarding → inactive (db_bill correct)
UPDATE employees
SET employee_code    = 'MAS63401',
    employment_status = 'inactive',
    date_of_joining   = '2026-08-26',
    email             = 'nitinrana41152@gmail.com',
    pan_number        = 'FNQPR0118L',
    aadhaar_number    = '840608979981',
    updated_at        = NOW()
WHERE employee_code = 'MAS63449';

-- ══════════════════════════════════════════════════════════════
-- GROUP 2: REJOIN CASES
-- Old record → mark as left (set employment_status = 'inactive', date_of_leaving = day before new DOJ)
-- New record → INSERT with db_bill code as fresh row
-- ══════════════════════════════════════════════════════════════

-- NAMAN KUMAR SHARMA: MAS61901 = old stint (DOJ 2026-03-22), MAS63392 = new stint (DOJ 2026-08-26)
UPDATE employees
SET employment_status = 'inactive',
    date_of_leaving   = '2026-08-25',
    updated_at        = NOW()
WHERE employee_code = 'MAS61901';

INSERT INTO employees (id, employee_code, first_name, last_name, date_of_joining, branch_id, mobile, email, pan_number, aadhaar_number, employment_status, created_at, updated_at)
VALUES (
  UUID(), 'MAS63392', 'NAMAN', 'KUMAR SHARMA',
  '2026-08-26',
  'febd8777-6583-11f1-adb1-00155d0ab410',
  '9058607013', 'vanshbsr1@gmail.com', 'OPZPS5956F', '628535411644',
  'inactive', NOW(), NOW()
);

-- HARSH SIROHI: MAS57089 = old stint (DOJ 2024-09-26), MAS63397 = new stint (DOJ 2026-08-26)
UPDATE employees
SET employment_status = 'inactive',
    date_of_leaving   = '2026-08-25',
    updated_at        = NOW()
WHERE employee_code = 'MAS57089';

INSERT INTO employees (id, employee_code, first_name, last_name, date_of_joining, branch_id, mobile, email, pan_number, aadhaar_number, employment_status, created_at, updated_at)
VALUES (
  UUID(), 'MAS63397', 'HARSH', 'SIROHI',
  '2026-08-26',
  'febd8777-6583-11f1-adb1-00155d0ab410',
  '9643053312', 'harshsirohi72@gmail.com', 'MMOPS8578P', '676742360106',
  'inactive', NOW(), NOW()
);

-- SAIF ANSARI: MAS63292 = old stint (DOJ 2026-08-12), MAS63399 = new stint (DOJ 2026-08-26)
UPDATE employees
SET employment_status = 'inactive',
    date_of_leaving   = '2026-08-25',
    updated_at        = NOW()
WHERE employee_code = 'MAS63292';

INSERT INTO employees (id, employee_code, first_name, last_name, date_of_joining, branch_id, mobile, email, pan_number, aadhaar_number, employment_status, created_at, updated_at)
VALUES (
  UUID(), 'MAS63399', 'SAIF', 'ANSARI',
  '2026-08-26',
  'febd8777-6583-11f1-adb1-00155d0ab410',
  '6387856040', 'saifansari4334@gmail.com', 'FLPPA8647N', '937628852198',
  'inactive', NOW(), NOW()
);

-- ══════════════════════════════════════════════════════════════
-- VERIFY
-- ══════════════════════════════════════════════════════════════
SELECT employee_code, full_name, employment_status, date_of_joining, date_of_leaving
FROM employees
WHERE employee_code IN (
  'MAS63390','MAS63396','MAS63401',       -- renamed
  'MAS61901','MAS57089','MAS63292',       -- old stints (should show date_of_leaving)
  'MAS63392','MAS63397','MAS63399'        -- new stints (rejoins)
)
ORDER BY employee_code;

COMMIT;
