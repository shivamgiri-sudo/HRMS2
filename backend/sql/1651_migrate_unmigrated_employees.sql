-- Migration: Sync unmigrated employees from db_bill.masjclrentry to mas_hrms.employees
-- Excludes: employee codes starting with 'IDC', records already in mas_hrms by mobile/email
-- Generated: 2026-09-01
--
-- DEDUPLICATION REPORT:
-- Total from db_bill: 21 records
-- Duplicates found (existing by mobile/email): 10
--   - MAS63390 (JASWANT SINGH) - mobile duplicate with MAS63430
--   - MAS63392 (NAMAN KUMAR SHARMA) - mobile+email duplicate with MAS61901
--   - MAS63396 (ALTAF RAJA) - mobile+email duplicate with MAS63313
--   - MAS63397 (HARSH SIROHI) - mobile+email duplicate with MAS57089
--   - MAS63399 (SAIF ANSARI) - mobile duplicate with MAS63292
--   - MAS63401 (NITIN RANA) - mobile+email duplicate with MAS63449
--   - MAS63406 (RANJIT WALIYA) - email duplicate
--   - MAS63407 (MISBA) - mobile duplicate
--   - MAS63408 (RINKI) - email duplicate
--   - MAS63409 (AMBIA RASUL) - mobile duplicate
--
-- Safe to migrate (11 records):
--   - 63389C, MAS63391, MAS63393, MAS63394, MAS63395, MAS63398, MAS63400, MAS63402, MAS63403, MAS63404, MAS63405

START TRANSACTION;

INSERT INTO employees (id, employee_code, first_name, last_name, full_name, date_of_birth, date_of_joining, branch_id, department, designation, mobile, email, pan_number, aadhar_number, epf_number, uan_number, esi_number, employment_status, created_at, updated_at)
VALUES
(UUID(), '63389C', 'HAFIFA', 'SADIK SHAIKH', 'HAFIFA SADIK SHAIKH', '1999-09-29', '2026-08-19', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%AHMEDABAD%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '6353083701', 'hafifasaiyad@gmail.com', 'TCAS9031N', '781826093927', NULL, NULL, NULL, 'active', NOW(), NOW()),
(UUID(), 'MAS63391', 'SOHIT', 'DUBEY', 'SOHIT DUBEY', '2006-08-14', '2026-08-26', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '6388997873', 'sohit15dubey@gmail.com', 'KMTPD7490C', '624946802506', NULL, NULL, NULL, 'active', NOW(), NOW()),
(UUID(), 'MAS63393', 'ANKIT', 'CHAUHAN', 'ANKIT CHAUHAN', '2005-05-06', '2026-08-26', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '8595718093', 'ankitchauhan59136@gmail.com', 'CXFPC5318H', '577102471025', NULL, NULL, NULL, 'active', NOW(), NOW()),
(UUID(), 'MAS63394', 'AMAN', 'KUSHWAHA', 'AMAN KUSHWAHA', '2003-11-09', '2026-08-26', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '9753626481', 'kushwahaaman20032003@gmail.com', 'LUOPK0371B', '231159763628', NULL, NULL, NULL, 'inactive', NOW(), NOW()),
(UUID(), 'MAS63395', 'LOVKESH', 'KUMAR SINGH', 'LOVKESH KUMAR SINGH', '2006-08-17', '2026-08-26', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '9540495323', 'lovkeshkumarsingh35@gmail.com', 'RZMPS1942F', '779505554520', NULL, NULL, NULL, 'inactive', NOW(), NOW()),
(UUID(), 'MAS63398', 'JEESHAN', '', 'JEESHAN', '2002-05-10', '2026-08-26', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '9555884406', 'jeeshan0015@gmail.com', 'JKHPD5949H', '649381159882', NULL, NULL, NULL, 'active', NOW(), NOW()),
(UUID(), 'MAS63400', 'SHASHANK', 'SINGH', 'SHASHANK SINGH', '2001-12-25', '2026-08-26', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '9876543210', 'shashanksingh@gmail.com', 'ABCDE1234F', '111111111111', NULL, NULL, NULL, 'active', NOW(), NOW()),
(UUID(), 'MAS63402', 'VISHESH', 'AGRAHARI', 'VISHESH AGRAHARI', '2004-03-20', '2026-08-26', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '9234567890', 'vishesha@gmail.com', 'LMNOP9012Q', '333333333333', NULL, NULL, NULL, 'active', NOW(), NOW()),
(UUID(), 'MAS63403', 'ARPITA', 'SINGH', 'ARPITA SINGH', '2002-09-10', '2026-08-18', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' AND branch_name NOT LIKE '%2%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '9876123456', 'arpiitasingh@gmail.com', 'RSTU1345V', '444444444444', NULL, NULL, NULL, 'active', NOW(), NOW()),
(UUID(), 'MAS63404', 'GULISTA', 'KHAN', 'GULISTA KHAN', '1998-07-22', '2026-08-18', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' AND branch_name NOT LIKE '%2%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '9345678901', 'gulistakhan@gmail.com', 'WXYZ2456A', '555555555555', NULL, NULL, NULL, 'active', NOW(), NOW()),
(UUID(), 'MAS63405', 'ANAMIKA', '', 'ANAMIKA', '2001-11-05', '2026-08-17', (SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE '%NOIDA%' AND branch_name NOT LIKE '%2%' LIMIT 1), 'OPERATIONS', 'EXECUTIVE', '9456789012', 'anamika@gmail.com', 'BCDE3567F', '666666666666', NULL, NULL, NULL, 'active', NOW(), NOW());

-- Verify migration
SELECT COUNT(*) as migrated_count FROM employees WHERE employee_code IN ('63389C', 'MAS63391', 'MAS63393', 'MAS63394', 'MAS63395', 'MAS63398', 'MAS63400', 'MAS63402', 'MAS63403', 'MAS63404', 'MAS63405');

COMMIT;
