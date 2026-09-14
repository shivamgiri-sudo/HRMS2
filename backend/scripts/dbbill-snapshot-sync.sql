-- ============================================================
-- db_bill → mas_hrms ONE-TIME SNAPSHOT SYNC
-- Run directly on MySQL server (both DBs must be accessible)
-- Safe to re-run: uses COALESCE / ON DUPLICATE KEY / WHERE guards
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- FIX 1+5 : Deactivate left employees + map DOL + set status
-- ────────────────────────────────────────────────────────────
UPDATE mas_hrms.employees e
JOIN db_bill.masjclrentry b ON b.EmpCode = e.employee_code
SET
  e.active_status       = 0,
  e.employment_status   = CASE
                            WHEN b.left_type = 'Voluntary'     THEN 'resigned'
                            WHEN b.left_type = 'Non Voluntary' THEN 'terminated'
                            WHEN b.left_type = 'Absconding'    THEN 'absconded'
                            WHEN b.left_type IS NOT NULL       THEN 'separated'
                            ELSE COALESCE(NULLIF(e.employment_status,'active'), 'separated')
                          END,
  e.date_of_leaving     = COALESCE(e.date_of_leaving,  IF(b.DOL IS NOT NULL AND b.DOL != '0000-00-00', DATE(b.DOL), NULL)),
  e.date_of_exit        = COALESCE(e.date_of_exit,     IF(b.DOL IS NOT NULL AND b.DOL != '0000-00-00', DATE(b.DOL), NULL)),
  e.resignation_date    = COALESCE(e.resignation_date, IF(b.ResignationDate IS NOT NULL AND b.ResignationDate != '0000-00-00', DATE(b.ResignationDate), NULL))
WHERE (b.DOL IS NOT NULL OR b.Status != '1')
  AND b.EmpCode NOT LIKE 'IDC%'
  AND b.EmpCode IS NOT NULL
  AND b.EmpCode != '';

-- ────────────────────────────────────────────────────────────
-- FIX 2a : Fix CTC mismatches in employee_salary_assignment
-- ────────────────────────────────────────────────────────────
UPDATE mas_hrms.employee_salary_assignment esa
JOIN mas_hrms.employees e ON e.id = esa.employee_id
JOIN db_bill.masjclrentry b ON b.EmpCode = e.employee_code
SET esa.ctc_annual = CAST(b.CTC AS UNSIGNED) * 12
WHERE esa.active_status = 1
  AND b.Status = '1'
  AND b.CTC IS NOT NULL AND b.CTC != '' AND CAST(b.CTC AS UNSIGNED) > 0
  AND ABS(esa.ctc_annual / 12 - CAST(b.CTC AS UNSIGNED)) > 100
  AND b.EmpCode NOT LIKE 'IDC%';

-- ────────────────────────────────────────────────────────────
-- FIX 2b : Create missing salary assignments for active emps
-- ────────────────────────────────────────────────────────────
INSERT INTO mas_hrms.employee_salary_assignment
  (id, employee_id, structure_id, ctc_annual, governance_mode, effective_from, active_status, created_at)
SELECT
  UUID(),
  e.id,
  '450abc3f-6592-11f1-adb1-00155d0ab410',
  CAST(b.CTC AS UNSIGNED) * 12,
  'LEGACY_IMPORT',
  COALESCE(e.date_of_joining, CURDATE()),
  1,
  NOW()
FROM mas_hrms.employees e
JOIN db_bill.masjclrentry b ON b.EmpCode = e.employee_code
WHERE e.active_status = 1
  AND b.Status = '1'
  AND b.CTC IS NOT NULL AND b.CTC != '' AND CAST(b.CTC AS UNSIGNED) > 0
  AND b.EmpCode NOT LIKE 'IDC%'
  AND NOT EXISTS (
    SELECT 1 FROM mas_hrms.employee_salary_assignment esa2
    WHERE esa2.employee_id = e.id AND esa2.active_status = 1
  );

-- ────────────────────────────────────────────────────────────
-- FIX 2c : Populate salary_component_assignments from db_bill
-- ────────────────────────────────────────────────────────────
INSERT INTO mas_hrms.salary_component_assignments
  (id, employee_id, effective_date, salary_slab,
   basic, hra, conveyance, special_allowance, gross,
   pf_applicable, esi_applicable, employer_pf, employer_esi,
   ctc, net_estimate, status, created_at)
SELECT
  UUID(),
  e.id,
  COALESCE(e.date_of_joining, CURDATE()),
  'LEGACY',
  COALESCE(CAST(b.bs   AS UNSIGNED), 0),
  COALESCE(CAST(b.hra  AS UNSIGNED), 0),
  COALESCE(CAST(b.conv AS UNSIGNED), 0),
  COALESCE(CAST(b.sa   AS UNSIGNED), 0) +
    COALESCE(CAST(b.da   AS UNSIGNED), 0) +
    COALESCE(CAST(b.portf AS UNSIGNED), 0) +
    COALESCE(CAST(b.oa   AS UNSIGNED), 0),
  COALESCE(CAST(b.Gross AS UNSIGNED), 0),
  IF(b.pfelig  = 'YES', 1, 0),
  IF(b.esielig = 'YES', 1, 0),
  COALESCE(CAST(b.EPFCO  AS UNSIGNED), 0),
  COALESCE(CAST(b.ESICCO AS UNSIGNED), 0),
  COALESCE(CAST(b.CTC       AS UNSIGNED), 0),
  COALESCE(CAST(b.NetInhand AS UNSIGNED), 0),
  'active',
  NOW()
FROM mas_hrms.employees e
JOIN mas_hrms.employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
JOIN db_bill.masjclrentry b ON b.EmpCode = e.employee_code
WHERE b.CTC IS NOT NULL AND b.CTC != '' AND CAST(b.CTC AS UNSIGNED) > 0
  AND b.EmpCode NOT LIKE 'IDC%'
ON DUPLICATE KEY UPDATE
  basic             = VALUES(basic),
  hra               = VALUES(hra),
  conveyance        = VALUES(conveyance),
  special_allowance = VALUES(special_allowance),
  gross             = VALUES(gross),
  employer_pf       = VALUES(employer_pf),
  employer_esi      = VALUES(employer_esi),
  ctc               = VALUES(ctc),
  net_estimate      = VALUES(net_estimate),
  status            = 'active';

-- ────────────────────────────────────────────────────────────
-- FIX 2d : Deactivate salary assignments for inactive employees
-- ────────────────────────────────────────────────────────────
UPDATE mas_hrms.employee_salary_assignment esa
JOIN mas_hrms.employees e ON e.id = esa.employee_id
SET esa.active_status = 0
WHERE e.active_status = 0
  AND esa.active_status = 1;

-- ────────────────────────────────────────────────────────────
-- FIX 3 : Import missing documents from db_bill
-- (Only new docs not yet in HRMS via legacy_ref_id watermark)
-- ────────────────────────────────────────────────────────────
INSERT IGNORE INTO mas_hrms.employee_documents
  (id, employee_id, doc_type, doc_category, legacy_source, legacy_ref_id, doc_name, file_url, verified)
SELECT
  UUID(),
  e.id,
  COALESCE(du.DocumentType, 'other'),
  CASE
    WHEN du.DocumentType IN ('POI')                   THEN 'identity'
    WHEN du.DocumentType IN ('POA')                   THEN 'address_proof'
    WHEN du.DocumentType IN ('POE')                   THEN 'education'
    WHEN du.DocumentType IN ('POExp')                 THEN 'experience'
    WHEN du.DocumentType IN ('PAN')                   THEN 'pan'
    WHEN du.DocumentType IN ('Aadhar')                THEN 'aadhaar'
    WHEN du.DocumentType IN ('Passport')              THEN 'passport'
    WHEN du.DocumentType IN ('DL')                    THEN 'driving_license'
    WHEN du.DocumentType IN ('Medical')               THEN 'medical'
    WHEN du.DocumentType IN ('CoC','CF')              THEN 'contract'
    WHEN du.DocumentType IN ('Offer Letter')          THEN 'offer_letter'
    WHEN du.DocumentType IN ('Cancelled Cheque Image','Bank') THEN 'bank'
    WHEN du.DocumentType IN ('TDS')                   THEN 'tax'
    WHEN du.DocumentType IN ('PF','ESIC')             THEN 'statutory'
    ELSE 'other'
  END,
  'document_master',
  du.SrNo,
  COALESCE(du.DocumentName, du.DocumentType, 'Document'),
  CONCAT('legacy://document_master/', du.DocumentUploaded),
  IF(du.Status = 'Yes', 1, 0)
FROM db_bill.mas_docoments_upload du
JOIN db_bill.masjclrentry j ON j.id = du.EmpSrno
JOIN mas_hrms.employees e ON e.employee_code = j.EmpCode
WHERE du.DocumentUploaded IS NOT NULL
  AND du.DocumentUploaded != ''
  AND du.SrNo > (
    SELECT COALESCE(MAX(legacy_ref_id), 0)
    FROM mas_hrms.employee_documents
    WHERE legacy_source = 'document_master'
  )
  AND j.EmpCode NOT LIKE 'IDC%';

-- ────────────────────────────────────────────────────────────
-- FIX 4 : Import new employees from db_bill not in HRMS
-- (excludes IDC-prefixed codes)
-- ────────────────────────────────────────────────────────────
INSERT INTO mas_hrms.employees (
  id, employee_code, first_name, last_name,
  date_of_joining, date_of_birth,
  gender, marital_status, blood_group,
  mobile, personal_email, official_email,
  father_name,
  pan_number, aadhaar_number,
  bank_account_number, bank_name, bank_branch, ifsc_code, account_holder_name, account_type,
  epf_number, esic_number, uan_number,
  branch_id, department_id, process_id,
  biometric_code,
  address1, address2, city, state, pincode,
  active_status, employment_status, employment_type,
  source, created_at
)
SELECT
  UUID(),
  b.EmpCode,
  TRIM(SUBSTRING_INDEX(b.EmpName, ' ', 1)),
  TRIM(SUBSTRING(b.EmpName, LOCATE(' ', b.EmpName) + 1)),
  IF(b.DOJ IS NOT NULL AND b.DOJ != '0000-00-00', DATE(b.DOJ), NULL),
  IF(b.DOB IS NOT NULL AND b.DOB != '0000-00-00', DATE(b.DOB), NULL),
  CASE LOWER(b.Gendar) WHEN 'female' THEN 'female' WHEN 'male' THEN 'male' ELSE NULL END,
  NULLIF(b.MaritalStatus, ''),
  NULLIF(b.BloodGruop, ''),
  NULLIF(b.Mobile, ''),
  NULLIF(b.EmailId, ''),
  NULLIF(b.OfficeEmailId, ''),
  NULLIF(b.Father, ''),
  NULLIF(b.PanNo, ''),
  NULLIF(b.AdharId, ''),
  NULLIF(b.AcNo, ''),
  NULLIF(b.AcBank, ''),
  NULLIF(b.AcBranch, ''),
  NULLIF(b.IFSCCode, ''),
  NULLIF(b.AccHolder, ''),
  NULLIF(b.AccType, ''),
  NULLIF(b.EPFNo, ''),
  NULLIF(b.ESICNo, ''),
  NULLIF(b.UAN, ''),
  (SELECT br.id FROM mas_hrms.branch_master br WHERE UPPER(br.branch_name) = UPPER(b.BranchName) LIMIT 1),
  (SELECT dm.id FROM mas_hrms.department_master dm WHERE UPPER(dm.dept_name) = UPPER(b.Dept) LIMIT 1),
  (SELECT pm.id FROM mas_hrms.process_master pm WHERE UPPER(pm.process_name) = UPPER(b.Process) LIMIT 1),
  NULLIF(b.BioCode, ''),
  NULLIF(b.Adrress1, ''),
  NULLIF(b.Adrress2, ''),
  NULLIF(b.City, ''),
  NULLIF(b.State, ''),
  NULLIF(b.PinCode, ''),
  1,
  'active',
  COALESCE(NULLIF(b.EmpType, ''), 'ONROLL'),
  NULLIF(b.Source, ''),
  NOW()
FROM db_bill.masjclrentry b
WHERE b.Status = '1'
  AND b.EmpCode NOT LIKE 'IDC%'
  AND b.EmpCode IS NOT NULL AND b.EmpCode != ''
  AND NOT EXISTS (
    SELECT 1 FROM mas_hrms.employees e2 WHERE e2.employee_code = b.EmpCode
  );

-- ────────────────────────────────────────────────────────────
-- Salary assignments for newly imported employees
-- ────────────────────────────────────────────────────────────
INSERT INTO mas_hrms.employee_salary_assignment
  (id, employee_id, structure_id, ctc_annual, governance_mode, effective_from, active_status, created_at)
SELECT
  UUID(),
  e.id,
  '450abc3f-6592-11f1-adb1-00155d0ab410',
  CAST(b.CTC AS UNSIGNED) * 12,
  'LEGACY_IMPORT',
  COALESCE(e.date_of_joining, CURDATE()),
  1,
  NOW()
FROM mas_hrms.employees e
JOIN db_bill.masjclrentry b ON b.EmpCode = e.employee_code
WHERE e.active_status = 1
  AND b.Status = '1'
  AND b.CTC IS NOT NULL AND b.CTC != '' AND CAST(b.CTC AS UNSIGNED) > 0
  AND b.EmpCode NOT LIKE 'IDC%'
  AND NOT EXISTS (
    SELECT 1 FROM mas_hrms.employee_salary_assignment esa2
    WHERE esa2.employee_id = e.id AND esa2.active_status = 1
  );

-- ============================================================
-- DONE
-- ============================================================
