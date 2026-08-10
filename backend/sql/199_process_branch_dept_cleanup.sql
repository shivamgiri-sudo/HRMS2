-- ============================================================
-- Migration 199: Process Master Sync, Branch/Dept Cleanup,
--                Employee process_id Backfill from cost_center_code
-- Source of truth: db_bill.cost_master (via cost_center codes)
-- ============================================================

-- -------------------------------------------------------
-- STEP 1: Add client_name column to process_master if missing
-- -------------------------------------------------------
DROP PROCEDURE IF EXISTS _add_client_name_col;
DELIMITER //
CREATE PROCEDURE _add_client_name_col()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'process_master'
      AND COLUMN_NAME = 'client_name'
  ) THEN
    ALTER TABLE process_master
      ADD COLUMN client_name VARCHAR(255) NULL AFTER call_centre_code;
  END IF;
END //
DELIMITER ;
CALL _add_client_name_col();
DROP PROCEDURE IF EXISTS _add_client_name_col;

-- -------------------------------------------------------
-- STEP 2: Deactivate duplicate/legacy process_master rows
--         (keep only the clean set seeded in migration 197/198)
-- -------------------------------------------------------
-- Deactivate old-style generic process codes that came from legacy import
-- (active_status=0 already on most; ensure the stragglers are off)
UPDATE process_master SET active_status = 0, updated_at = NOW()
WHERE active_status = 1
  AND process_code IN (
    'GEN_OPS','QUALITY','HR_OPS','MANAGEMENTCORPORATE','COLLECTION_MANAGEMENT',
    'ITCORPORATE','BSSOTHERS','ACTIVE_FIELD_COLLECTION','CSOTHERS',
    'SOFT_COLLECTION__RETENTION','HRCORPORATE'
  );

-- -------------------------------------------------------
-- STEP 3: Upsert the real, client-linked process records
--         sourced from db_bill.cost_master
-- -------------------------------------------------------

-- ONFIDO (223 employees on BSS/BO/NOIDA-2/576)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'ONFIDO', 'Onfido', 'Onfido Limited', 'background verification', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- GODFREY PHILIPS (172 employees on BSS/OB/AHMH-JD/465)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'GODFREY_PHILIPS', 'Godfrey Philips India Ltd', 'Godfrey Philips India Ltd', 'UPSELLING & CROSSELLING', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- HOUSING.COM / LOCON (114 employees on BSS/OB/Noida/592)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'HOUSING_COM', 'Housing.com', 'Locon solutions private limited', 'UPSELLING & CROSSELLING', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- IDAM NATURAL (101/120 employees on BSS/IB/Noida/647)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'IDAM', 'IDAM Natural Wellness', 'IDAM NATURAL WELLNESS PRIVATE LIMITED', 'INBOUND CUSTOMER SERVICES', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- DIALDESK SHARED (87 employees on BSS/BO/NOIDA-DD/798)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'DIALDESK_SHARED', 'Dialdesk Shared', 'MCIPL', 'BACK OFFICE', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- BLUEVINE (86 employees on BSS/OB/AHMH-JD/919)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'BLUEVINE', 'Bluevine Technologies', 'Bluevine Technologies Private Limited', 'CUSTOMER PROFILING', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- BACK OFFICE MAS/INTERNAL (52/50 employees on BSS/BO/NOIDA-2/577)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'BACK_OFFICE', 'Back Office', 'MAS CALLNET INDIA PVT LTD', 'BACK OFFICE', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- FINNABLE (35/36 employees on BSS/OB/NOIDA-2/1015)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'FINNABLE', 'Finnable', 'FINNABLE CREDIT PRIVATE LIMITED', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- GUARDIAN HEALTHCARE (34 employees on BSS/BO/Noida/754)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'GUARDIAN_HC', 'Guardian Healthcare', 'GUARDIAN HEALTHCARE SERVICES PRIVATE LIMITED', 'BACK OFFICE', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- BTM VENTURES (28+7=35 employees on BSS/OB/NOIDA-2/972 + BSS/FLD/NOIDA-2/1029)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'BTM', 'BTM Ventures', 'BTM VENTURES PVT LTD', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- CAPTUREATRIP (25 employees on BSS/OB/NOIDA-2/983)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'CAPTUREATRIP', 'Captureatrip', 'Captureatrip India Pvt. Ltd.', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- ERESOLUTION (25 employees on BSS/OB/Noida/1005)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'ERESOLUTION', 'Eresolution', 'Eresolution Consultancy Services Private Limited', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- APPRECIATE WEALTH (22/23 employees on BSS/OB/Noida/923)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'APPRICIATE_WEALTH', 'Appriciate Wealth', 'Appreciate Broking IFSC Private Limited', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- CLOVIA / PURPLE PANDA (17 employees on BSS/IB/Noida/892)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'CLOVIA', 'Clovia', 'Purple Panda Fashions Limited', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- ADANI WILMAR (4 employees on BSS/OB/AHMH-JD/728)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'ADANI_WILMAR', 'Adani Wilmar Limited', 'AWL AGRI BUSINESS LIMITED', 'UPSELLING & CROSSELLING', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- NEEMANS (23 employees on BSS/OB/Noida/961)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'NEEMANS', 'Neemans Private Limited', 'Neemans Private Limited', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- BIRLANU (11 employees on BSS/OB/Noida/966)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'BIRLANU', 'BirlaNu Limited', 'BirlaNu Limited', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- BACK OFFICE AHMH (11/15 employees on BSS/BO/AHMH-JD/560)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'BO_AHMH', 'BO/AHMH', 'Mas Callnet India Pvt.Ltd.', 'BACK OFFICE', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- DU DIGITAL (10 employees on BSS/IB/Noida/654)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'DU_DIGITAL', 'DU Digital', 'DU DIGITAL TECHNOLOGIES LIMITED', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- RELIANCE BACK OFFICE (10/13 employees on BO/)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'RELIANCE_BO', 'Reliance Back Office', 'Reliance Web Store Ltd', 'BACK OFFICE', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- S&M INTERNAL HO (9 employees on BSS/BO/CORP/318)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'HO_SM', 'HO S&M', 'MCIPL', 'BACK OFFICE', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- GS1 INDIA (7 employees on BSS/OB/NOIDA-2/927)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'GS1', 'GS1', 'GS1 India', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- IT SYSTEM INTERNAL (7 employees on IT/SYSTEM)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'IT_SYSTEM', 'IT/System', 'MCIPL', 'IT', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- EXICOM (6 employees on BSS/IB/Noida/534)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'EXICOM', 'Exicom', 'Exicom Tele-Systems Limited', 'INBOUND CUSTOMER SERVICES', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- MANAGEMENT CORPORATE (5 employees on MANAGEMENT-CORPORATE)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'MGT', 'MGT', 'MCIPL', 'MANAGEMENT', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- EBC BRIDGE (4 employees on BSS/OB/Noida/945)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'EBC_BRIDGE', 'EBC Bridge', 'EBC Bridge Private Limited', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- VRINDA NANO (3 employees on BSS/IB/AHMH-JD/763)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'VNT', 'VNT', 'Vrinda Nano Technologies Pvt. Ltd', 'INBOUND CUSTOMER SERVICES', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- HO COMPLIANCE (3 employees on BSS/BLD/CORP/796)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'HO_COMPLIANCE', 'HO Compliance', 'MCIPL', 'BACK OFFICE', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- DALMIA CEMENT (3/12 employees on BSS/BLD/Noida/630)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'DALMIA_CEMENT', 'Dalmia Cement', 'Dalmia Cement (Bharat) Ltd', 'NEW ACQUISITION & ADD ON', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- ASPEYA (3 employees on BSS/OB/Noida/954)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'ASPEYA', 'Aspeya India', 'ASPEYA INDIA PRIVATE LIMITED', 'CS-OTHERS', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- HO INTERNAL (1 employee on BSS/BLD/CORP/319)
INSERT INTO process_master
  (id, process_code, process_name, client_name, business_lob, branch_id, active_status)
VALUES (UUID(), 'HO_INTERNAL', 'HO Internal', 'MCIPL', 'BACK OFFICE', NULL, 1)
ON DUPLICATE KEY UPDATE
  process_name = VALUES(process_name),
  client_name  = VALUES(client_name),
  active_status = 1, updated_at = NOW();

-- -------------------------------------------------------
-- STEP 4: Seed integration_process_alias
--         cost_center_code → process_id for employee backfill
-- -------------------------------------------------------
INSERT IGNORE INTO integration_process_alias (id, source_value, process_id, active_status)
SELECT UUID(), cc, pm.id, 1
FROM (
  SELECT 'BSS/BO/NOIDA-2/576'  AS cc, 'ONFIDO'          AS code UNION ALL
  SELECT 'BSS/OB/AHMH-JD/465',         'GODFREY_PHILIPS'        UNION ALL
  SELECT 'BSS/OB/Noida/592',           'HOUSING_COM'            UNION ALL
  SELECT 'BSS/IB/Noida/647',           'IDAM'                   UNION ALL
  SELECT 'BSS/BO/NOIDA-DD/798',        'DIALDESK_SHARED'        UNION ALL
  SELECT 'BSS/OB/AHMH-JD/919',         'BLUEVINE'               UNION ALL
  SELECT 'BSS/BO/NOIDA-2/577',         'BACK_OFFICE'            UNION ALL
  SELECT 'BSS/OB/NOIDA-2/1015',        'FINNABLE'               UNION ALL
  SELECT 'BSS/BO/Noida/754',           'GUARDIAN_HC'            UNION ALL
  SELECT 'BSS/OB/NOIDA-2/972',         'BTM'                    UNION ALL
  SELECT 'BSS/FLD/NOIDA-2/1029',       'BTM'                    UNION ALL
  SELECT 'BSS/OB/NOIDA-2/983',         'CAPTUREATRIP'           UNION ALL
  SELECT 'BSS/OB/Noida/1005',          'ERESOLUTION'            UNION ALL
  SELECT 'BSS/OB/Noida/923',           'APPRICIATE_WEALTH'      UNION ALL
  SELECT 'BSS/IB/Noida/892',           'CLOVIA'                 UNION ALL
  SELECT 'BSS/OB/AHMH-JD/728',         'ADANI_WILMAR'           UNION ALL
  SELECT 'BSS/OB/Noida/961',           'NEEMANS'                UNION ALL
  SELECT 'BSS/OB/Noida/966',           'BIRLANU'                UNION ALL
  SELECT 'BSS/BO/AHMH-JD/560',         'BO_AHMH'                UNION ALL
  SELECT 'BSS/IB/Noida/654',           'DU_DIGITAL'             UNION ALL
  SELECT 'BO/',                         'RELIANCE_BO'            UNION ALL
  SELECT 'BSS/BO/CORP/318',            'HO_SM'                  UNION ALL
  SELECT 'BSS/OB/NOIDA-2/927',         'GS1'                    UNION ALL
  SELECT 'IT/SYSTEM',                  'IT_SYSTEM'              UNION ALL
  SELECT 'BSS/IB/Noida/534',           'EXICOM'                 UNION ALL
  SELECT 'MANAGEMENT-CORPORATE',       'MGT'                    UNION ALL
  SELECT 'BSS/OB/Noida/945',           'EBC_BRIDGE'             UNION ALL
  SELECT 'BSS/IB/AHMH-JD/763',         'VNT'                    UNION ALL
  SELECT 'BSS/BLD/CORP/796',           'HO_COMPLIANCE'          UNION ALL
  SELECT 'BSS/BLD/Noida/630',          'DALMIA_CEMENT'          UNION ALL
  SELECT 'BSS/OB/Noida/954',           'ASPEYA'                 UNION ALL
  SELECT 'BSS/BLD/CORP/319',           'HO_INTERNAL'            UNION ALL
  SELECT 'BSS-OTHERS',                 'OTHERS'
) mapping
JOIN process_master pm ON pm.process_code = mapping.code
WHERE NOT EXISTS (
  SELECT 1 FROM integration_process_alias ipa WHERE ipa.source_value = mapping.cc
);

-- -------------------------------------------------------
-- STEP 5: Backfill employees.process_id from cost_center_code
-- -------------------------------------------------------
UPDATE employees e
JOIN integration_process_alias ipa ON ipa.source_value = e.cost_center_code
SET e.process_id = ipa.process_id, e.updated_at = NOW()
WHERE e.employment_status = 'active'
  AND e.process_id IS NULL
  AND e.cost_center_code IS NOT NULL
  AND e.cost_center_code != ''
  AND ipa.active_status = 1;

-- -------------------------------------------------------
-- STEP 6: Deactivate zero-employee duplicate branch_master rows
--         Keep the ones with employees; deactivate legacy duplicates
-- -------------------------------------------------------

-- Branches with employees but inactive — keep them (do NOT change)
-- Branches with zero employees AND duplicated name — deactivate
UPDATE branch_master SET active_status = 0, updated_at = NOW()
WHERE branch_code IN (
  -- Legacy codes superseded by the migration-197 set
  'AHEMDABAD','AHEMDABAD_HOUSE','AHEMDABAD_OTHERS',
  'DEL_OTHERS','HEAD_OFFICE',
  'HYDERABAD','JAIPUR','JAIPUR_IDC','KARNAL',
  'MEERUT','MOHALI','SCAN_N_SMILE',
  'JALDARSHAN','NEELKANTH',
  -- Empty new codes with no employees
  'NOIDA_ISPARK-2','09','07','AHMEDABAD-NEELAKANTH',
  'NOI_ISPARK','PAYPIK','JAID','KNL','MAS_SKILL',
  'QUAL','QUAL-MP','MRT','CHD','JPR','AHMH','AHMHO'
)
AND id NOT IN (
  -- Never deactivate a branch that has active employees
  SELECT DISTINCT branch_id FROM employees WHERE employment_status='active' AND branch_id IS NOT NULL
);

-- -------------------------------------------------------
-- STEP 7: Deactivate zero-employee duplicate department rows
-- -------------------------------------------------------
UPDATE department_master SET active_status = 0, updated_at = NOW()
WHERE dept_code IN (
  -- Duplicates / legacy codes with zero employees
  'OPS','ADMINHR','FIELD_RETENTION','QUALITIES','CALL_CENTER',
  'ITSYSTEM','BACKOFICE_DEO','MARKETING','FACILITIES',
  'FINANCEACCOUNTS','HUMAR_RESOURCE','MIS','SALES__MARKETING',
  'HUMAN_RESOURCE','CREDIT_MANAGEMENT','INFORMATION_TECHNOLOGY',
  'HUMAN_RESOURCE_AND_DEVELOPMENT','MANAGEMENT'
)
AND id NOT IN (
  SELECT DISTINCT department_id FROM employees WHERE employment_status='active' AND department_id IS NOT NULL
);

-- -------------------------------------------------------
-- STEP 8: Verification queries (read-only, safe to run)
-- -------------------------------------------------------
SELECT 'PROCESS BACKFILL RESULT' AS check_name,
  COUNT(*) AS total_active,
  SUM(CASE WHEN process_id IS NOT NULL THEN 1 ELSE 0 END) AS now_has_process,
  SUM(CASE WHEN process_id IS NULL THEN 1 ELSE 0 END) AS still_missing
FROM employees WHERE employment_status = 'active';

SELECT 'ACTIVE BRANCHES' AS check_name, COUNT(*) AS cnt
FROM branch_master WHERE active_status = 1;

SELECT 'ACTIVE DEPARTMENTS' AS check_name, COUNT(*) AS cnt
FROM department_master WHERE active_status = 1;

SELECT 'ACTIVE PROCESSES' AS check_name, COUNT(*) AS cnt
FROM process_master WHERE active_status = 1;
