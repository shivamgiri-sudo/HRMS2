-- 1557_branch_sal_code_from_db_bill.sql
--
-- SOURCE: db_bill.branch_master.Sal_Branch_Code (read-only, verified 2026-08-24)
--
-- WHAT THIS DOES:
--   1. Adds sal_branch_code VARCHAR(30) NULL to branch_master (salary/establishment code
--      used in payroll and statutory reporting per branch).
--   2. Backfills sal_branch_code from db_bill branch data, matched by branch_code.
--   3. Backfills address where currently NULL, from db_bill branch_address.
--   4. Backfills company_name where currently NULL, from db_bill company_name.
--
-- SAFETY: All UPDATEs are guarded — sal_branch_code only set where NULL, address/company_name
--   only where NULL. Re-running is a no-op. No row loses a value it already has.
--
-- db_bill branches with Sal_Branch_Code and their mapping to mas_hrms branch_code:
--   db_bill branch_code      | db_bill Sal_Branch_Code | mas_hrms branch_code
--   AHMH-JD                  | AHM                     | AHMH-JD
--   CORP                     | CORP                    | CORP
--   Noida                    | NOI                     | Noida
--   NOIDA-2                  | NOI-2                   | NOIDA-2
--   NOIDA-DD                 | NOI-DIA                 | NOIDA-DD
--   NOIDA ISPARK-2           | NOI-ISP-2               | NOIDA ISPARK-2  (or NOIDA_ISPARK-2)
--   NOI/ISPARK               | NOI-ISP                 | NOI/ISPARK
--   DEL (VDF MANPOWER id=17) | VDF-MAN                 | DEL
--   DEL (DELHI id=2)         | DEL                     | 07  (DELHI uses branch_code "07" in mas_hrms)
--   JPR                      | JPR                     | JPR
--   KNL                      | KAR                     | KNL
--   QUAL                     | MAY                     | QUAL
--   CHD                      | MOH                     | CHD
--   PAYPIK                   | PAY                     | PAYPIK

SET NAMES utf8mb4;
SET @db = DATABASE();

-- Step 1: Add sal_branch_code column if not present
SELECT COUNT(*) INTO @has_sal_code
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'branch_master' AND COLUMN_NAME = 'sal_branch_code';
SET @sql = IF(@has_sal_code = 0,
  "ALTER TABLE branch_master ADD COLUMN sal_branch_code VARCHAR(30) NULL COMMENT 'Salary/establishment code from db_bill Sal_Branch_Code' AFTER branch_code",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── sal_branch_code ─────────────────────────────────────────────────────────

-- AHMEDABAD-JALDARSHAN (AHMH-JD) → AHM
UPDATE branch_master SET sal_branch_code = 'AHM'
WHERE branch_code = 'AHMH-JD' AND sal_branch_code IS NULL;

-- HEAD OFFICE (CORP) → CORP
UPDATE branch_master SET sal_branch_code = 'CORP'
WHERE branch_code = 'CORP' AND sal_branch_code IS NULL;

-- NOIDA (branch_code = 'Noida' in mas_hrms, as imported from db_bill) → NOI
UPDATE branch_master SET sal_branch_code = 'NOI'
WHERE branch_code = 'Noida' AND sal_branch_code IS NULL;

-- NOIDA-2 → NOI-2
UPDATE branch_master SET sal_branch_code = 'NOI-2'
WHERE branch_code = 'NOIDA-2' AND sal_branch_code IS NULL;

-- NOIDA-DIALDESK (NOIDA-DD) → NOI-DIA
UPDATE branch_master SET sal_branch_code = 'NOI-DIA'
WHERE branch_code = 'NOIDA-DD' AND sal_branch_code IS NULL;

-- NOIDA ISPARK-2 (branch_code may be "NOIDA ISPARK-2" or "NOIDA_ISPARK-2")
UPDATE branch_master SET sal_branch_code = 'NOI-ISP-2'
WHERE branch_code IN ('NOIDA ISPARK-2', 'NOIDA_ISPARK-2') AND sal_branch_code IS NULL;

-- NOIDA-ISPARK (NOI/ISPARK) → NOI-ISP
UPDATE branch_master SET sal_branch_code = 'NOI-ISP'
WHERE branch_code = 'NOI/ISPARK' AND sal_branch_code IS NULL;

-- VDF MANPOWER (DEL) → VDF-MAN
-- Note: mas_hrms branch_code DEL = VDF Manpower per 1243 migration commentary.
UPDATE branch_master SET sal_branch_code = 'VDF-MAN'
WHERE branch_code = 'DEL' AND sal_branch_code IS NULL;

-- DELHI (branch_code "07" in mas_hrms matches db_bill branch_code "07") → DEL
UPDATE branch_master SET sal_branch_code = 'DEL'
WHERE branch_code = '07' AND sal_branch_code IS NULL;

-- JAIPUR (JPR) → JPR
UPDATE branch_master SET sal_branch_code = 'JPR'
WHERE branch_code = 'JPR' AND sal_branch_code IS NULL;

-- KARNAL (KNL) → KAR
UPDATE branch_master SET sal_branch_code = 'KAR'
WHERE branch_code = 'KNL' AND sal_branch_code IS NULL;

-- MAYAPURI (QUAL) → MAY
UPDATE branch_master SET sal_branch_code = 'MAY'
WHERE branch_code = 'QUAL' AND sal_branch_code IS NULL;

-- MOHALI (CHD) → MOH
UPDATE branch_master SET sal_branch_code = 'MOH'
WHERE branch_code = 'CHD' AND sal_branch_code IS NULL;

-- PAYPIK → PAY
UPDATE branch_master SET sal_branch_code = 'PAY'
WHERE branch_code = 'PAYPIK' AND sal_branch_code IS NULL;

-- ─── address backfill (only where currently NULL) ────────────────────────────

UPDATE branch_master SET address = 'F/09, F/14, F/15, Jaldarshan CO. OP. Housing Soc. Ltd. (Commercial building), Opp. Natraj Cinema, Ashram Road, Ahmedabad-380009'
WHERE branch_code = 'AHMH-JD' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'PLOT NO-506, GROUND FLOOR, 1ST FLOOR, 2ND FLOOR, ASHA ARCADE, OPPOSITE GANDHI GRAM RAILWAY STATION, ASHRAM ROAD, Ahmedabad, Gujarat, 380006'
WHERE branch_code = 'AHMH' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'PLOT NO-506, GROUND FLOOR, 1ST FLOOR, 2ND FLOOR, ASHA ARCADE, OPPOSITE GANDHI GRAM RAILWAY STATION, ASHRAM ROAD, Ahmedabad, Gujarat, 380006'
WHERE branch_code = 'AHMHO' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = '4TH FLOOR, NEELKANTH AVENUE-1, NR. C U SHAH COLLEGE, ASHRAM ROAD, AHMEDABAD'
WHERE branch_code = 'Ahmedabad-Neelakanth' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'UM-A111A, ANSAL PLAZA, VAISHALI, SECTOR-1, GHAZIABAD, U.P.-201010'
WHERE branch_code = 'CORP' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'Unit No-302 A and B, 3rd Floor, B-5, Okaya Centre, Tower-1, Sector-62, Noida, Gautam Buddha, Uttar Pradesh 201301'
WHERE branch_code = 'Noida' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'Unit No-302 A and B, 3rd Floor, B-5, Okaya Centre, Tower-1, Sector-62, Noida, Gautam Buddha, Uttar Pradesh 201301'
WHERE branch_code = 'NOIDA-2' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'A-94/10, 2nd Floor, Sector 58, Noida, U.P. 201301'
WHERE branch_code IN ('NOIDA ISPARK-2', 'NOIDA_ISPARK-2') AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'UMA-111A, Ansal Plaza, Vaishali Road, Vaishali, Ghaziabad, Uttar Pradesh 201010'
WHERE branch_code = 'NOIDA-DD' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'A-94/10, 2nd Floor, Sector 58, Noida, U.P. 201301'
WHERE branch_code = 'NOI/ISPARK' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'Unit No-302 A and B, 3rd Floor, B-5, Okaya Centre, Tower-1, Sector-62, Noida, Gautam Buddha, Uttar Pradesh 201301'
WHERE branch_code = '09' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'B-24, 1st Floor, Okhla Industrial Area, Phase-2, New Delhi-110020'
WHERE branch_code = 'DEL' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'B-24, 1st Floor, Okhla Industrial Area, Phase-II, New Delhi-110020'
WHERE branch_code = '07' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = '1-160/7, 7A, 7B & 7C, 4th Floor, Becon Towers, Musheerabad, Hyderabad-500020, Telangana'
WHERE branch_code = 'HYD' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'F-202-204, RIICO Industrial Area, Mansarovar, Jaipur, Rajasthan-302020'
WHERE branch_code = 'JPR' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'F-202-204, Major Complex, 3rd Floor, RIICO Industrial Area, Mansarovar, Nr. Galaxy Cinema, Jaipur, Rajasthan-302020'
WHERE branch_code = 'JAID' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'Plot No.67, 1st Floor, Sector-3, Karnal-132001, Haryana'
WHERE branch_code = 'KNL' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'B-131, Block-B, Mayapuri Industrial Area, Phase-1, Mayapuri, New Delhi-110064'
WHERE branch_code = 'QUAL' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'B-131, Block-B, Mayapuri Industrial Area, Phase-1, Mayapuri, New Delhi-110064'
WHERE branch_code = 'QUAL-MP' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'DC-8, Opposite D-158, Shastri Nagar, Near Arya Samaj Mandir, Meerut, U.P. 250002'
WHERE branch_code = 'MRT' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'SCO No.97, Sahi Majra Balongi Road, Phase-5, Mohali, Near PCL Chowk, Mohali-160059'
WHERE branch_code = 'CHD' AND (address IS NULL OR address = '');

UPDATE branch_master SET address = 'A-94/10, 2nd Floor, Sector 58, Noida, U.P. 201301'
WHERE branch_code = 'PAYPIK' AND (address IS NULL OR address = '');

-- ─── company_name backfill (only where currently NULL) ───────────────────────

UPDATE branch_master SET company_name = 'Mas Callnet India Pvt. Ltd.'
WHERE branch_code = 'AHMH-JD' AND (company_name IS NULL OR company_name = '');

UPDATE branch_master SET company_name = 'MAS Call Net India Pvt Ltd'
WHERE branch_code IN ('AHMH','AHMHO','CORP','DEL','HYD','JPR','KNL','QUAL','QUAL-MP','MRT','CHD','NOI/ISPARK','PAYPIK','NOIDA-2')
  AND (company_name IS NULL OR company_name = '');

UPDATE branch_master SET company_name = 'MAS CALLNET INDIA PVT LTD'
WHERE branch_code IN ('07','Ahmedabad-Neelakanth')
  AND (company_name IS NULL OR company_name = '');

UPDATE branch_master SET company_name = 'Mas Callnet India Pvt. Ltd.'
WHERE branch_code IN ('Noida','09','Mas_Skill')
  AND (company_name IS NULL OR company_name = '');

UPDATE branch_master SET company_name = 'Ispark Dataconnect Pvt Ltd'
WHERE branch_code = 'NOIDA-DD' AND (company_name IS NULL OR company_name = '');

UPDATE branch_master SET company_name = 'NOIDA ISPARK-2'
WHERE branch_code IN ('NOIDA ISPARK-2','NOIDA_ISPARK-2') AND (company_name IS NULL OR company_name = '');

SELECT CONCAT('1557_branch_sal_code_from_db_bill.sql applied — ',
  (SELECT COUNT(*) FROM branch_master WHERE sal_branch_code IS NOT NULL),
  ' branches now have sal_branch_code') AS migration_status;
