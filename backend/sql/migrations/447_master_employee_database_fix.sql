-- ============================================================================
-- 447_master_employee_database_fix.sql
--
-- Fixes master_employee_database, which was landing far less data than
-- mas_hrms actually holds.
--
-- ROOT CAUSE (measured on prod 2026-09-02, 58,975 employees):
--   446* sourced every personal field (father, address, nominee, PAN mask,
--   passport, DL) exclusively from candidate_onboarding_profile, reached via
--   ats_onboarding_bridge -- a table with only 541 rows. Every one of those
--   columns therefore populated for ~50 employees instead of ~33,000.
--   Salary came only from salary_component_assignments (1,351 employees).
--   No fallback existed to employees / employee_legacy_meta / employee_address
--   / employee_nominee / employee_salary_snapshot, all of which hold the data.
--
--   Measured symptoms before this migration:
--     present_address_line1        0 of 58,975  (employees.address1 has 30,236)
--     permanent_address_line1      0            (employee_legacy_meta has 33,433)
--     father_name                 54            (employee_legacy_meta has 33,434)
--     nominee_name                50            (employee_nominee has 33,445)
--     net_in_hand                453            (employees.net_inhand has 29,547)
--     basic                     1,351            (employee_salary_snapshot has 32,876)
--     aadhaar_number_masked       53            (employees.aadhaar_last4 has 21,190)
--
-- WHAT THIS DOES
--   A. Adds 27 columns that the legacy employee-master template needs and
--      master_employee_database had no home for at all.
--   B. Builds master_employee_candidate_link -- a trustworthy employee ->
--      candidate map (ats_onboarding_bridge + unambiguous mobile match that
--      also agrees on date of birth). 24,650 of 24,682 mobile matches agree
--      on DOB; the 32 that disagree are deliberately excluded.
--   C. Replaces the population logic with one view, v_master_employee_source,
--      that both procedures read, so the single-row and bulk paths can never
--      drift apart again. Fixing only the bulk path would not have worked:
--      the per-row trigger would keep writing NULLs back over good values.
--
-- ADDITIVE ONLY. No source table is modified. master_employee_database is a
-- derived mirror -- nothing in backend/src reads it yet (verified), and the
-- ev_refresh_master_employee event rebuilds it every 10 minutes.
--
-- Applied manually, like 446* (which was never recorded in schema_migrations).
-- ============================================================================


-- ── A. ADD MISSING COLUMNS (idempotent) ─────────────────────────────────────
DROP PROCEDURE IF EXISTS sp__med_add_col;

DELIMITER //
CREATE PROCEDURE sp__med_add_col(IN p_col VARCHAR(64), IN p_ddl VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'master_employee_database'
       AND COLUMN_NAME  = p_col
  ) THEN
    SET @s = CONCAT('ALTER TABLE master_employee_database ADD COLUMN `', p_col, '` ', p_ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL sp__med_add_col('biometric_code',           'VARCHAR(50)   DEFAULT NULL');
CALL sp__med_add_col('legacy_emp_id',            'VARCHAR(50)   DEFAULT NULL');
CALL sp__med_add_col('parent_relation',          'VARCHAR(50)   DEFAULT NULL');
CALL sp__med_add_col('band',                     'VARCHAR(20)   DEFAULT NULL');
CALL sp__med_add_col('stream',                   'VARCHAR(100)  DEFAULT NULL');
CALL sp__med_add_col('billable_status',          'VARCHAR(10)   DEFAULT NULL');
CALL sp__med_add_col('emp_for',                  'VARCHAR(50)   DEFAULT NULL');
CALL sp__med_add_col('client_name',              'VARCHAR(255)  DEFAULT NULL');
CALL sp__med_add_col('cost_center_code',         'VARCHAR(255)  DEFAULT NULL');
CALL sp__med_add_col('source',                   'VARCHAR(100)  DEFAULT NULL');
CALL sp__med_add_col('source_type',              'VARCHAR(100)  DEFAULT NULL');
CALL sp__med_add_col('qualification',            'VARCHAR(255)  DEFAULT NULL');
CALL sp__med_add_col('qualification_details',    'VARCHAR(200)  DEFAULT NULL');
CALL sp__med_add_col('passed_out_year',          'INT           DEFAULT NULL');
CALL sp__med_add_col('passed_out_state',         'VARCHAR(100)  DEFAULT NULL');
CALL sp__med_add_col('passed_out_city',          'VARCHAR(100)  DEFAULT NULL');
CALL sp__med_add_col('passed_out_percent',       'DECIMAL(5,2)  DEFAULT NULL');
CALL sp__med_add_col('working_experience',       'VARCHAR(50)   DEFAULT NULL');
CALL sp__med_add_col('experience_year',          'DECIMAL(4,1)  DEFAULT NULL');
CALL sp__med_add_col('reporting_manager_mobile', 'VARCHAR(30)   DEFAULT NULL');
CALL sp__med_add_col('present_landline',         'VARCHAR(50)   DEFAULT NULL');
CALL sp__med_add_col('permanent_landline',       'VARCHAR(50)   DEFAULT NULL');
CALL sp__med_add_col('document_done',            'VARCHAR(10)   DEFAULT NULL');
CALL sp__med_add_col('box_file_no',              'VARCHAR(100)  DEFAULT NULL');
CALL sp__med_add_col('offer_no',                 'VARCHAR(100)  DEFAULT NULL');
CALL sp__med_add_col('family_annual_income',     'DECIMAL(12,2) DEFAULT NULL');
CALL sp__med_add_col('count_of_dependents',      'SMALLINT      DEFAULT NULL');

DROP PROCEDURE IF EXISTS sp__med_add_col;


-- ── A2. SUPPORTING INDEX ────────────────────────────────────────────────────
-- The view picks one qualification row per candidate with
--   ORDER BY passed_out_year DESC, id DESC LIMIT 1
-- Without this index that is a filesort on every single-row refresh, which the
-- triggers run on each employees UPDATE. Measured: the per-row refresh costs
-- ~16ms under the old 446c logic and ~47ms under 447 without this index.
DROP PROCEDURE IF EXISTS sp__med_add_idx;

DELIMITER //
CREATE PROCEDURE sp__med_add_idx()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'candidate_onboarding_qualification'
       AND INDEX_NAME   = 'idx_coq_cand_year_id'
  ) THEN
    CREATE INDEX idx_coq_cand_year_id
        ON candidate_onboarding_qualification (candidate_id, passed_out_year, id);
  END IF;
END //
DELIMITER ;

CALL sp__med_add_idx();
DROP PROCEDURE IF EXISTS sp__med_add_idx;


-- ── B. EMPLOYEE -> CANDIDATE LINK ───────────────────────────────────────────
-- ats_onboarding_bridge covers only 541 employees. The onboarding tables
-- (profile, bank, qualification, experience) hold ~33k legacy records that are
-- reachable only by mobile number. A mobile match is accepted ONLY when the
-- number is unique on BOTH sides AND date of birth agrees -- otherwise one
-- person's education and bank details land on another person's record.
CREATE TABLE IF NOT EXISTS master_employee_candidate_link (
  employee_id  CHAR(36)    NOT NULL,
  candidate_id CHAR(36)    NOT NULL,
  link_source  VARCHAR(20) NOT NULL,
  linked_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id),
  KEY idx_mecl_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='employee -> onboarding candidate map used by master_employee_database';

DROP PROCEDURE IF EXISTS sp_rebuild_master_candidate_link;

DELIMITER //
CREATE PROCEDURE sp_rebuild_master_candidate_link()
BEGIN
  DELETE FROM master_employee_candidate_link;

  -- 1. Authoritative bridge rows first.
  INSERT IGNORE INTO master_employee_candidate_link (employee_id, candidate_id, link_source)
  SELECT ob.employee_id, ob.candidate_id, 'bridge'
    FROM ats_onboarding_bridge ob
    JOIN employees e ON e.id = ob.employee_id
   WHERE ob.employee_id IS NOT NULL AND ob.candidate_id IS NOT NULL;

  -- 2. Unambiguous mobile match that also agrees on DOB.
  INSERT IGNORE INTO master_employee_candidate_link (employee_id, candidate_id, link_source)
  SELECT eu.id, cu.candidate_id, 'mobile_dob'
    FROM (
      SELECT MIN(c.candidate_id)  AS candidate_id,
             c.mobile_number      AS mobile_number,
             MIN(c.date_of_birth) AS date_of_birth
        FROM candidate_onboarding_profile c
       WHERE c.mobile_number IS NOT NULL AND c.mobile_number <> ''
       GROUP BY c.mobile_number
      HAVING COUNT(*) = 1
    ) cu
    JOIN (
      SELECT MIN(e.id)            AS id,
             e.mobile             AS mobile,
             MIN(e.date_of_birth) AS date_of_birth
        FROM employees e
       WHERE e.mobile IS NOT NULL AND e.mobile <> ''
       GROUP BY e.mobile
      HAVING COUNT(*) = 1
    ) eu ON eu.mobile = cu.mobile_number
   WHERE eu.date_of_birth <=> cu.date_of_birth;
END //
DELIMITER ;

CALL sp_rebuild_master_candidate_link();


-- ── C. SINGLE SOURCE OF TRUTH FOR POPULATION ────────────────────────────────
-- Both sp_refresh_master_employee (one row) and sp_populate_master_employee_all
-- (bulk) select from this view, so their logic cannot drift apart.
--
-- Fallback order is deliberate: the live HRMS record (employees) outranks the
-- legacy mirror, which outranks the onboarding form -- except for fields the
-- onboarding form is authoritative for (masked PAN/Aadhaar, nominee, mother).
CREATE OR REPLACE VIEW v_master_employee_source AS
SELECT
  e.id                                                                          AS employee_id,
  e.employee_code,
  e.first_name,
  e.last_name,
  e.full_name,
  e.gender,
  e.date_of_birth,
  COALESCE(NULLIF(TRIM(e.blood_group),''), NULLIF(TRIM(lm.blood_group),''))      AS blood_group,
  COALESCE(NULLIF(TRIM(e.marital_status),''), NULLIF(TRIM(lm.marital_status),''),
           NULLIF(TRIM(op.marital_status),''))                                   AS marital_status,
  e.mobile,
  e.alternate_mobile,
  COALESCE(NULLIF(TRIM(e.personal_email),''), NULLIF(TRIM(e.email),''),
           NULLIF(TRIM(op.personal_email_id),''))                                AS personal_email,
  COALESCE(NULLIF(TRIM(e.official_email),''), NULLIF(TRIM(e.office_email),''),
           NULLIF(TRIM(lm.official_email),''), NULLIF(TRIM(op.official_email_id),'')) AS official_email,
  COALESCE(NULLIF(TRIM(op.father_name),''), NULLIF(TRIM(op.father_husband_name),''),
           NULLIF(TRIM(lm.father_name),''), NULLIF(TRIM(e.father_name),''))      AS father_name,
  NULLIF(TRIM(op.mother_name),'')                                                AS mother_name,

  -- Documents. Aadhaar is stored masked only, by security policy.
  COALESCE(NULLIF(TRIM(si.pan_number),''), NULLIF(TRIM(e.pan_number),''))        AS pan_number,
  COALESCE(op.pan_number_encrypted, si.pan_number_encrypted, e.pan_number_encrypted) AS pan_number_encrypted,
  COALESCE(
    NULLIF(TRIM(op.pan_number_masked),''),
    NULLIF(TRIM(e.pan_number_masked),''),
    CASE WHEN COALESCE(si.pan_number, e.pan_number) REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$'
         THEN CONCAT('XXXXX', RIGHT(COALESCE(si.pan_number, e.pan_number), 5)) END
  )                                                                              AS pan_number_masked,
  COALESCE(
    NULLIF(TRIM(op.aadhaar_number_masked),''),
    CASE WHEN NULLIF(TRIM(e.aadhaar_last4),'') IS NOT NULL
         THEN CONCAT('XXXXXXXX', e.aadhaar_last4) END,
    CASE WHEN si.aadhaar_id REGEXP '^[0-9]{12}$'
         THEN CONCAT('XXXXXXXX', RIGHT(si.aadhaar_id, 4)) END
  )                                                                              AS aadhaar_number_masked,
  COALESCE(
    NULLIF(TRIM(e.aadhaar_last4),''),
    CASE WHEN si.aadhaar_id REGEXP '^[0-9]{12}$' THEN RIGHT(si.aadhaar_id, 4) END
  )                                                                              AS aadhaar_last4,
  NULLIF(TRIM(op.full_name_aadhaar),'')                                          AS full_name_aadhaar,
  COALESCE(NULLIF(TRIM(op.passport_number),''), NULLIF(TRIM(op.passport_no),''),
           NULLIF(TRIM(lm.passport_no),''))                                      AS passport_number,
  COALESCE(NULLIF(TRIM(op.dl_number),''), NULLIF(TRIM(op.driving_license),''),
           NULLIF(TRIM(op.driving_license_no),''), NULLIF(TRIM(lm.dl_no),''))    AS driving_license,
  NULLIF(TRIM(op.voter_id),'')                                                   AS voter_id,

  -- Statutory
  COALESCE(NULLIF(TRIM(op.uan_number),''), NULLIF(TRIM(op.uan),''),
           NULLIF(TRIM(si.uan_number),''), NULLIF(TRIM(e.uan_number),''))        AS uan_number,
  COALESCE(NULLIF(TRIM(op.epf_number),''), NULLIF(TRIM(si.epf_number),''),
           NULLIF(TRIM(e.epf_number),''))                                        AS epf_number,
  COALESCE(NULLIF(TRIM(op.esic_number),''), NULLIF(TRIM(si.esi_number),''),
           NULLIF(TRIM(e.esic_number),''))                                       AS esic_number,
  COALESCE(si.pf_eligible, 0)                                                    AS pf_eligible,
  COALESCE(si.esi_eligible, 0)                                                   AS esi_eligible,
  si.epf_date,

  -- Employment
  e.date_of_joining,
  e.salary_start_date,
  e.date_of_exit,
  e.employment_status,
  e.employment_type,
  e.employee_category,
  e.profile_type,
  e.active_status,

  -- Organisation
  e.branch_id,      bm.branch_name,
  e.department_id,  dm.dept_name,
  e.process_id,     pm.process_name,
  e.designation_id, des.designation_name,
  e.reporting_manager_id,
  COALESCE(
    NULLIF(TRIM(CONCAT(COALESCE(rm.first_name,''), ' ', COALESCE(rm.last_name,''))), ''),
    NULLIF(TRIM(cx.reporting_manager_name),'')
  )                                                                              AS reporting_manager_name,

  -- Present address
  COALESCE(NULLIF(TRIM(op.present_address_line1),''), NULLIF(TRIM(e.address1),''),
           NULLIF(TRIM(lm.temporary_address),''))                                AS present_address_line1,
  COALESCE(NULLIF(TRIM(op.present_address_line2),''), NULLIF(TRIM(e.address2),'')) AS present_address_line2,
  COALESCE(NULLIF(TRIM(op.present_city),''), NULLIF(TRIM(e.city),''))            AS present_city,
  COALESCE(NULLIF(TRIM(op.present_state),''), NULLIF(TRIM(e.state),''))          AS present_state,
  COALESCE(NULLIF(TRIM(op.present_pincode),''), NULLIF(TRIM(e.pincode),''))      AS present_pincode,

  -- Permanent address
  COALESCE(NULLIF(TRIM(op.permanent_address_line1),''), NULLIF(TRIM(ea.address_line1),''),
           NULLIF(TRIM(e.permanent_address1),''), NULLIF(TRIM(lm.permanent_address),'')) AS permanent_address_line1,
  COALESCE(NULLIF(TRIM(op.permanent_address_line2),''), NULLIF(TRIM(ea.address_line2),''),
           NULLIF(TRIM(e.permanent_address2),''))                                AS permanent_address_line2,
  COALESCE(NULLIF(TRIM(op.permanent_city),''), NULLIF(TRIM(ea.city),''),
           NULLIF(TRIM(e.permanent_city),''))                                    AS permanent_city,
  COALESCE(NULLIF(TRIM(op.permanent_state),''), NULLIF(TRIM(ea.state),''),
           NULLIF(TRIM(e.permanent_state),''))                                   AS permanent_state,
  COALESCE(NULLIF(TRIM(op.permanent_pincode),''), NULLIF(TRIM(ea.pincode),''),
           NULLIF(TRIM(e.permanent_pincode),''))                                 AS permanent_pincode,

  -- Nominees
  COALESCE(NULLIF(TRIM(op.nominee_name),''), NULLIF(TRIM(en.nominee_name),''),
           NULLIF(TRIM(e.nominee_name),''))                                      AS nominee_name,
  COALESCE(NULLIF(TRIM(op.nominee_relation),''), NULLIF(TRIM(en.relationship),''),
           NULLIF(TRIM(e.nominee_relation),''))                                  AS nominee_relation,
  COALESCE(op.nominee_date_of_birth, op.nominee_dob, en.date_of_birth)           AS nominee_dob,
  NULLIF(TRIM(op.nominee2_name),'')                                              AS nominee2_name,
  NULLIF(TRIM(op.nominee2_relation),'')                                          AS nominee2_relation,
  op.nominee2_dob,

  -- Bank. Account numbers are admitted only as plain digits: employee_bank_detail
  -- holds Excel-mangled values (4,249 of 13,151 fail this guard) and a mangled
  -- account number in a payments master is worse than a NULL.
  COALESCE(NULLIF(TRIM(bd.bank_name),''), NULLIF(TRIM(e.bank_name),''))          AS bank_name,
  COALESCE(
    CASE WHEN CONVERT(bd.account_number USING utf8mb4) REGEXP '^[0-9]{6,25}$'
         THEN CONVERT(bd.account_number USING utf8mb4) END,
    CASE WHEN CONVERT(e.bank_account_number USING utf8mb4) REGEXP '^[0-9]{6,25}$'
         THEN CONVERT(e.bank_account_number USING utf8mb4) END
  )                                                                              AS account_number,
  COALESCE(NULLIF(TRIM(bd.ifsc_code),''), NULLIF(TRIM(e.ifsc_code),''))          AS ifsc_code,
  COALESCE(NULLIF(TRIM(bd.bank_branch),''), NULLIF(TRIM(e.bank_branch),''))      AS bank_branch,
  COALESCE(NULLIF(TRIM(bd.account_type),''), NULLIF(TRIM(e.account_type),''))    AS account_type,
  COALESCE(NULLIF(TRIM(bd.account_holder_name),''), NULLIF(TRIM(e.account_holder_name),''),
           NULLIF(TRIM(lm.acc_holder_name),''))                                  AS account_holder_name,

  -- Onboarding bank (account stored encrypted)
  obd.bank_name                                                                  AS ob_bank_name,
  obd.branch_name                                                                AS ob_bank_branch,
  obd.ifsc_code                                                                  AS ob_ifsc_code,
  obd.account_no_encrypted                                                       AS ob_account_no_encrypted,
  obd.account_type                                                               AS ob_account_type,
  COALESCE(obd.account_holder_name, obd.name_on_cheque)                          AS ob_account_holder_name,

  -- Salary. Live assignment wins; then the employees record; then the legacy
  -- snapshot, whose gross/net are 0 on roughly half its rows -- hence NULLIF.
  -- A snapshot row is "real" when basic > 0. Within such a row, a 0 component
  -- (25,296 rows carry hra = 0) is a genuine value and must survive as 0 --
  -- NULLIF here would silently turn "no HRA" into "HRA unknown".
  COALESCE(sca.basic,             NULLIF(ess.basic,0))                           AS basic,
  COALESCE(sca.hra,               CASE WHEN ess.basic > 0 THEN ess.hra END)               AS hra,
  COALESCE(sca.conveyance,        CASE WHEN ess.basic > 0 THEN ess.conveyance END)        AS conveyance,
  COALESCE(sca.special_allowance, CASE WHEN ess.basic > 0 THEN ess.special_allowance END) AS special_allowance,
  COALESCE(sca.medical_allowance, CASE WHEN ess.basic > 0 THEN ess.medical_allowance END) AS medical_allowance,
  COALESCE(sca.lta,               CASE WHEN ess.basic > 0 THEN ess.lta END)               AS lta,
  COALESCE(sca.other_allowance,   CASE WHEN ess.basic > 0 THEN ess.other_allowance END)   AS other_allowance,
  COALESCE(sca.pli,               CASE WHEN ess.basic > 0 THEN ess.pli END)               AS pli,
  COALESCE(sca.bonus,             CASE WHEN ess.basic > 0 THEN ess.bonus END)             AS bonus,
  COALESCE(sca.portfolio,         CASE WHEN ess.basic > 0 THEN ess.portfolio_allowance END) AS portfolio,
  COALESCE(sca.gross,        NULLIF(e.gross_salary,0), NULLIF(ess.gross,0))      AS gross_salary,
  COALESCE(sca.net_estimate, NULLIF(e.net_inhand,0),   NULLIF(ess.net_in_hand,0)) AS net_in_hand,
  COALESCE(sca.ctc,          NULLIF(e.ctc,0),          NULLIF(ess.ctc_offered,0)) AS ctc,
  COALESCE(sca.employer_pf,  CASE WHEN ess.basic > 0 THEN ess.epf_employer END)  AS employer_pf,
  COALESCE(sca.employer_esi, CASE WHEN ess.basic > 0 THEN ess.esic_employer END) AS employer_esi,

  -- Columns added by 447 for legacy employee-master parity
  NULLIF(TRIM(e.biometric_code),'')                                              AS biometric_code,
  CAST(e.legacy_emp_id AS CHAR)                                                  AS legacy_emp_id,
  COALESCE(NULLIF(TRIM(lm.relationship_type),''), NULLIF(TRIM(op.relation),''))   AS parent_relation,
  NULLIF(TRIM(e.band),'')                                                        AS band,
  NULLIF(TRIM(e.stream),'')                                                      AS stream,
  COALESCE(NULLIF(TRIM(e.billable_status),''),
           CASE e.is_billable WHEN 1 THEN 'Yes' WHEN 0 THEN 'No' END)            AS billable_status,
  NULLIF(TRIM(ecm.emp_for),'')                                                   AS emp_for,
  NULLIF(TRIM(ecm.client_name),'')                                               AS client_name,
  COALESCE(NULLIF(TRIM(e.cost_center_code),''), NULLIF(TRIM(ecm.cost_center),'')) AS cost_center_code,
  COALESCE(NULLIF(TRIM(e.source),''), NULLIF(TRIM(op.source),''))                AS source,
  COALESCE(NULLIF(TRIM(e.source_type),''), NULLIF(TRIM(op.source_type),''))      AS source_type,
  COALESCE(NULLIF(TRIM(lm.qualification),''), NULLIF(TRIM(cq.qualification),'')) AS qualification,
  NULLIF(TRIM(cq.specialization_course_name),'')                                 AS qualification_details,
  cq.passed_out_year,
  NULLIF(TRIM(cq.passed_out_state),'')                                           AS passed_out_state,
  NULLIF(TRIM(cq.passed_out_city),'')                                            AS passed_out_city,
  cq.passed_out_percentage                                                       AS passed_out_percent,
  NULLIF(TRIM(cx.working_experience),'')                                         AS working_experience,
  cx.experience_year,
  COALESCE(NULLIF(TRIM(rm.mobile),''), NULLIF(TRIM(cx.reporting_manager_mobile),'')) AS reporting_manager_mobile,
  NULLIF(TRIM(lm.land_line_t),'')                                                AS present_landline,
  NULLIF(TRIM(lm.land_line_p),'')                                                AS permanent_landline,
  NULLIF(TRIM(lm.document_done),'')                                              AS document_done,
  NULLIF(TRIM(lm.box_file_no),'')                                                AS box_file_no,
  NULLIF(TRIM(lm.offer_no),'')                                                   AS offer_no,
  e.annual_income                                                                AS family_annual_income,
  e.count_of_dependents
FROM employees e
LEFT JOIN branch_master               bm  ON bm.id  = e.branch_id
LEFT JOIN department_master           dm  ON dm.id  = e.department_id
LEFT JOIN process_master              pm  ON pm.id  = e.process_id
LEFT JOIN designation_master          des ON des.id = e.designation_id
LEFT JOIN employees                   rm  ON rm.id  = e.reporting_manager_id
LEFT JOIN employee_statutory_info     si  ON si.employee_id  = e.id
LEFT JOIN employee_legacy_meta        lm  ON lm.employee_id  = e.id
LEFT JOIN employee_address            ea  ON ea.employee_id  = e.id AND ea.address_type = 'permanent'
LEFT JOIN employee_nominee            en  ON en.employee_id  = e.id
LEFT JOIN employee_client_mapping     ecm ON ecm.employee_id = e.id
LEFT JOIN employee_salary_snapshot    ess ON ess.employee_id = e.id
LEFT JOIN employee_bank_detail        bd  ON bd.employee_id  = e.id
                                         AND bd.is_primary = 1 AND bd.active_status = 1
LEFT JOIN master_employee_candidate_link   lnk ON lnk.employee_id  = e.id
LEFT JOIN candidate_onboarding_profile     op  ON op.candidate_id  = lnk.candidate_id
LEFT JOIN candidate_onboarding_bank_detail obd ON obd.candidate_id = lnk.candidate_id
LEFT JOIN candidate_onboarding_experience  cx  ON cx.candidate_id  = lnk.candidate_id
-- 91 candidates carry more than one qualification row; take the most recent.
LEFT JOIN candidate_onboarding_qualification cq ON cq.id = (
  SELECT q2.id FROM candidate_onboarding_qualification q2
   WHERE q2.candidate_id = lnk.candidate_id
   ORDER BY q2.passed_out_year DESC, q2.id DESC LIMIT 1)
-- Latest active salary assignment.
LEFT JOIN salary_component_assignments sca ON sca.id = (
  SELECT s2.id FROM salary_component_assignments s2
   WHERE s2.employee_id = e.id AND s2.status = 'active'
   ORDER BY s2.effective_date DESC, s2.id DESC LIMIT 1);


-- ── D. REFRESH ONE EMPLOYEE (called by every trigger) ───────────────────────
DROP PROCEDURE IF EXISTS sp_refresh_master_employee;

DELIMITER //
CREATE PROCEDURE sp_refresh_master_employee(IN p_emp_id CHAR(36))
BEGIN
  -- Explicit column lists: ALTER TABLE appended the 447 columns AFTER
  -- master_created_at/master_updated_at, so SELECT * would misalign.
  INSERT INTO master_employee_database (
    employee_id, employee_code, first_name, last_name, full_name, gender, date_of_birth,
    blood_group, marital_status, mobile, alternate_mobile, personal_email, official_email,
    father_name, mother_name,
    pan_number, pan_number_encrypted, pan_number_masked, aadhaar_number_masked, aadhaar_last4,
    full_name_aadhaar, passport_number, driving_license, voter_id,
    uan_number, epf_number, esic_number, pf_eligible, esi_eligible, epf_date,
    date_of_joining, salary_start_date, date_of_exit, employment_status, employment_type,
    employee_category, profile_type, active_status,
    branch_id, branch_name, department_id, dept_name, process_id, process_name,
    designation_id, designation_name, reporting_manager_id, reporting_manager_name,
    present_address_line1, present_address_line2, present_city, present_state, present_pincode,
    permanent_address_line1, permanent_address_line2, permanent_city, permanent_state, permanent_pincode,
    nominee_name, nominee_relation, nominee_dob, nominee2_name, nominee2_relation, nominee2_dob,
    bank_name, account_number, ifsc_code, bank_branch, account_type, account_holder_name,
    ob_bank_name, ob_bank_branch, ob_ifsc_code, ob_account_no_encrypted, ob_account_type,
    ob_account_holder_name,
    basic, hra, conveyance, special_allowance, medical_allowance, lta, other_allowance,
    pli, bonus, portfolio, gross_salary, net_in_hand, ctc, employer_pf, employer_esi,
    biometric_code, legacy_emp_id, parent_relation, band, stream, billable_status,
    emp_for, client_name, cost_center_code, source, source_type,
    qualification, qualification_details, passed_out_year, passed_out_state, passed_out_city,
    passed_out_percent, working_experience, experience_year, reporting_manager_mobile,
    present_landline, permanent_landline, document_done, box_file_no, offer_no,
    family_annual_income, count_of_dependents
  )
  SELECT
    employee_id, employee_code, first_name, last_name, full_name, gender, date_of_birth,
    blood_group, marital_status, mobile, alternate_mobile, personal_email, official_email,
    father_name, mother_name,
    pan_number, pan_number_encrypted, pan_number_masked, aadhaar_number_masked, aadhaar_last4,
    full_name_aadhaar, passport_number, driving_license, voter_id,
    uan_number, epf_number, esic_number, pf_eligible, esi_eligible, epf_date,
    date_of_joining, salary_start_date, date_of_exit, employment_status, employment_type,
    employee_category, profile_type, active_status,
    branch_id, branch_name, department_id, dept_name, process_id, process_name,
    designation_id, designation_name, reporting_manager_id, reporting_manager_name,
    present_address_line1, present_address_line2, present_city, present_state, present_pincode,
    permanent_address_line1, permanent_address_line2, permanent_city, permanent_state, permanent_pincode,
    nominee_name, nominee_relation, nominee_dob, nominee2_name, nominee2_relation, nominee2_dob,
    bank_name, account_number, ifsc_code, bank_branch, account_type, account_holder_name,
    ob_bank_name, ob_bank_branch, ob_ifsc_code, ob_account_no_encrypted, ob_account_type,
    ob_account_holder_name,
    basic, hra, conveyance, special_allowance, medical_allowance, lta, other_allowance,
    pli, bonus, portfolio, gross_salary, net_in_hand, ctc, employer_pf, employer_esi,
    biometric_code, legacy_emp_id, parent_relation, band, stream, billable_status,
    emp_for, client_name, cost_center_code, source, source_type,
    qualification, qualification_details, passed_out_year, passed_out_state, passed_out_city,
    passed_out_percent, working_experience, experience_year, reporting_manager_mobile,
    present_landline, permanent_landline, document_done, box_file_no, offer_no,
    family_annual_income, count_of_dependents
    FROM v_master_employee_source v
   WHERE v.employee_id = p_emp_id
  ON DUPLICATE KEY UPDATE
    employee_code=VALUES(employee_code), first_name=VALUES(first_name),
    last_name=VALUES(last_name), full_name=VALUES(full_name), gender=VALUES(gender),
    date_of_birth=VALUES(date_of_birth), blood_group=VALUES(blood_group),
    marital_status=VALUES(marital_status), mobile=VALUES(mobile),
    alternate_mobile=VALUES(alternate_mobile), personal_email=VALUES(personal_email),
    official_email=VALUES(official_email), father_name=VALUES(father_name),
    mother_name=VALUES(mother_name), pan_number=VALUES(pan_number),
    pan_number_encrypted=VALUES(pan_number_encrypted), pan_number_masked=VALUES(pan_number_masked),
    aadhaar_number_masked=VALUES(aadhaar_number_masked), aadhaar_last4=VALUES(aadhaar_last4),
    full_name_aadhaar=VALUES(full_name_aadhaar), passport_number=VALUES(passport_number),
    driving_license=VALUES(driving_license), voter_id=VALUES(voter_id),
    uan_number=VALUES(uan_number), epf_number=VALUES(epf_number), esic_number=VALUES(esic_number),
    pf_eligible=VALUES(pf_eligible), esi_eligible=VALUES(esi_eligible), epf_date=VALUES(epf_date),
    date_of_joining=VALUES(date_of_joining), salary_start_date=VALUES(salary_start_date),
    date_of_exit=VALUES(date_of_exit), employment_status=VALUES(employment_status),
    employment_type=VALUES(employment_type), employee_category=VALUES(employee_category),
    profile_type=VALUES(profile_type), active_status=VALUES(active_status),
    branch_id=VALUES(branch_id), branch_name=VALUES(branch_name),
    department_id=VALUES(department_id), dept_name=VALUES(dept_name),
    process_id=VALUES(process_id), process_name=VALUES(process_name),
    designation_id=VALUES(designation_id), designation_name=VALUES(designation_name),
    reporting_manager_id=VALUES(reporting_manager_id),
    reporting_manager_name=VALUES(reporting_manager_name),
    present_address_line1=VALUES(present_address_line1),
    present_address_line2=VALUES(present_address_line2), present_city=VALUES(present_city),
    present_state=VALUES(present_state), present_pincode=VALUES(present_pincode),
    permanent_address_line1=VALUES(permanent_address_line1),
    permanent_address_line2=VALUES(permanent_address_line2),
    permanent_city=VALUES(permanent_city), permanent_state=VALUES(permanent_state),
    permanent_pincode=VALUES(permanent_pincode), nominee_name=VALUES(nominee_name),
    nominee_relation=VALUES(nominee_relation), nominee_dob=VALUES(nominee_dob),
    nominee2_name=VALUES(nominee2_name), nominee2_relation=VALUES(nominee2_relation),
    nominee2_dob=VALUES(nominee2_dob), bank_name=VALUES(bank_name),
    account_number=VALUES(account_number), ifsc_code=VALUES(ifsc_code),
    bank_branch=VALUES(bank_branch), account_type=VALUES(account_type),
    account_holder_name=VALUES(account_holder_name), ob_bank_name=VALUES(ob_bank_name),
    ob_bank_branch=VALUES(ob_bank_branch), ob_ifsc_code=VALUES(ob_ifsc_code),
    ob_account_no_encrypted=VALUES(ob_account_no_encrypted),
    ob_account_type=VALUES(ob_account_type), ob_account_holder_name=VALUES(ob_account_holder_name),
    basic=VALUES(basic), hra=VALUES(hra), conveyance=VALUES(conveyance),
    special_allowance=VALUES(special_allowance), medical_allowance=VALUES(medical_allowance),
    lta=VALUES(lta), other_allowance=VALUES(other_allowance), pli=VALUES(pli),
    bonus=VALUES(bonus), portfolio=VALUES(portfolio), gross_salary=VALUES(gross_salary),
    net_in_hand=VALUES(net_in_hand), ctc=VALUES(ctc), employer_pf=VALUES(employer_pf),
    employer_esi=VALUES(employer_esi),
    biometric_code=VALUES(biometric_code), legacy_emp_id=VALUES(legacy_emp_id),
    parent_relation=VALUES(parent_relation), band=VALUES(band), stream=VALUES(stream),
    billable_status=VALUES(billable_status), emp_for=VALUES(emp_for),
    client_name=VALUES(client_name), cost_center_code=VALUES(cost_center_code),
    source=VALUES(source), source_type=VALUES(source_type),
    qualification=VALUES(qualification), qualification_details=VALUES(qualification_details),
    passed_out_year=VALUES(passed_out_year), passed_out_state=VALUES(passed_out_state),
    passed_out_city=VALUES(passed_out_city), passed_out_percent=VALUES(passed_out_percent),
    working_experience=VALUES(working_experience), experience_year=VALUES(experience_year),
    reporting_manager_mobile=VALUES(reporting_manager_mobile),
    present_landline=VALUES(present_landline), permanent_landline=VALUES(permanent_landline),
    document_done=VALUES(document_done), box_file_no=VALUES(box_file_no),
    offer_no=VALUES(offer_no), family_annual_income=VALUES(family_annual_income),
    count_of_dependents=VALUES(count_of_dependents),
    master_updated_at=CURRENT_TIMESTAMP;
END //
DELIMITER ;


-- ── E. BULK REBUILD (called by ev_refresh_master_employee every 10 min) ─────
DROP PROCEDURE IF EXISTS sp_populate_master_employee_all;

DELIMITER //
CREATE PROCEDURE sp_populate_master_employee_all()
BEGIN
  INSERT INTO master_employee_database (
    employee_id, employee_code, first_name, last_name, full_name, gender, date_of_birth,
    blood_group, marital_status, mobile, alternate_mobile, personal_email, official_email,
    father_name, mother_name,
    pan_number, pan_number_encrypted, pan_number_masked, aadhaar_number_masked, aadhaar_last4,
    full_name_aadhaar, passport_number, driving_license, voter_id,
    uan_number, epf_number, esic_number, pf_eligible, esi_eligible, epf_date,
    date_of_joining, salary_start_date, date_of_exit, employment_status, employment_type,
    employee_category, profile_type, active_status,
    branch_id, branch_name, department_id, dept_name, process_id, process_name,
    designation_id, designation_name, reporting_manager_id, reporting_manager_name,
    present_address_line1, present_address_line2, present_city, present_state, present_pincode,
    permanent_address_line1, permanent_address_line2, permanent_city, permanent_state, permanent_pincode,
    nominee_name, nominee_relation, nominee_dob, nominee2_name, nominee2_relation, nominee2_dob,
    bank_name, account_number, ifsc_code, bank_branch, account_type, account_holder_name,
    ob_bank_name, ob_bank_branch, ob_ifsc_code, ob_account_no_encrypted, ob_account_type,
    ob_account_holder_name,
    basic, hra, conveyance, special_allowance, medical_allowance, lta, other_allowance,
    pli, bonus, portfolio, gross_salary, net_in_hand, ctc, employer_pf, employer_esi,
    biometric_code, legacy_emp_id, parent_relation, band, stream, billable_status,
    emp_for, client_name, cost_center_code, source, source_type,
    qualification, qualification_details, passed_out_year, passed_out_state, passed_out_city,
    passed_out_percent, working_experience, experience_year, reporting_manager_mobile,
    present_landline, permanent_landline, document_done, box_file_no, offer_no,
    family_annual_income, count_of_dependents
  )
  SELECT
    employee_id, employee_code, first_name, last_name, full_name, gender, date_of_birth,
    blood_group, marital_status, mobile, alternate_mobile, personal_email, official_email,
    father_name, mother_name,
    pan_number, pan_number_encrypted, pan_number_masked, aadhaar_number_masked, aadhaar_last4,
    full_name_aadhaar, passport_number, driving_license, voter_id,
    uan_number, epf_number, esic_number, pf_eligible, esi_eligible, epf_date,
    date_of_joining, salary_start_date, date_of_exit, employment_status, employment_type,
    employee_category, profile_type, active_status,
    branch_id, branch_name, department_id, dept_name, process_id, process_name,
    designation_id, designation_name, reporting_manager_id, reporting_manager_name,
    present_address_line1, present_address_line2, present_city, present_state, present_pincode,
    permanent_address_line1, permanent_address_line2, permanent_city, permanent_state, permanent_pincode,
    nominee_name, nominee_relation, nominee_dob, nominee2_name, nominee2_relation, nominee2_dob,
    bank_name, account_number, ifsc_code, bank_branch, account_type, account_holder_name,
    ob_bank_name, ob_bank_branch, ob_ifsc_code, ob_account_no_encrypted, ob_account_type,
    ob_account_holder_name,
    basic, hra, conveyance, special_allowance, medical_allowance, lta, other_allowance,
    pli, bonus, portfolio, gross_salary, net_in_hand, ctc, employer_pf, employer_esi,
    biometric_code, legacy_emp_id, parent_relation, band, stream, billable_status,
    emp_for, client_name, cost_center_code, source, source_type,
    qualification, qualification_details, passed_out_year, passed_out_state, passed_out_city,
    passed_out_percent, working_experience, experience_year, reporting_manager_mobile,
    present_landline, permanent_landline, document_done, box_file_no, offer_no,
    family_annual_income, count_of_dependents
    FROM v_master_employee_source v
  ON DUPLICATE KEY UPDATE
    employee_code=VALUES(employee_code), first_name=VALUES(first_name),
    last_name=VALUES(last_name), full_name=VALUES(full_name), gender=VALUES(gender),
    date_of_birth=VALUES(date_of_birth), blood_group=VALUES(blood_group),
    marital_status=VALUES(marital_status), mobile=VALUES(mobile),
    alternate_mobile=VALUES(alternate_mobile), personal_email=VALUES(personal_email),
    official_email=VALUES(official_email), father_name=VALUES(father_name),
    mother_name=VALUES(mother_name), pan_number=VALUES(pan_number),
    pan_number_encrypted=VALUES(pan_number_encrypted), pan_number_masked=VALUES(pan_number_masked),
    aadhaar_number_masked=VALUES(aadhaar_number_masked), aadhaar_last4=VALUES(aadhaar_last4),
    full_name_aadhaar=VALUES(full_name_aadhaar), passport_number=VALUES(passport_number),
    driving_license=VALUES(driving_license), voter_id=VALUES(voter_id),
    uan_number=VALUES(uan_number), epf_number=VALUES(epf_number), esic_number=VALUES(esic_number),
    pf_eligible=VALUES(pf_eligible), esi_eligible=VALUES(esi_eligible), epf_date=VALUES(epf_date),
    date_of_joining=VALUES(date_of_joining), salary_start_date=VALUES(salary_start_date),
    date_of_exit=VALUES(date_of_exit), employment_status=VALUES(employment_status),
    employment_type=VALUES(employment_type), employee_category=VALUES(employee_category),
    profile_type=VALUES(profile_type), active_status=VALUES(active_status),
    branch_id=VALUES(branch_id), branch_name=VALUES(branch_name),
    department_id=VALUES(department_id), dept_name=VALUES(dept_name),
    process_id=VALUES(process_id), process_name=VALUES(process_name),
    designation_id=VALUES(designation_id), designation_name=VALUES(designation_name),
    reporting_manager_id=VALUES(reporting_manager_id),
    reporting_manager_name=VALUES(reporting_manager_name),
    present_address_line1=VALUES(present_address_line1),
    present_address_line2=VALUES(present_address_line2), present_city=VALUES(present_city),
    present_state=VALUES(present_state), present_pincode=VALUES(present_pincode),
    permanent_address_line1=VALUES(permanent_address_line1),
    permanent_address_line2=VALUES(permanent_address_line2),
    permanent_city=VALUES(permanent_city), permanent_state=VALUES(permanent_state),
    permanent_pincode=VALUES(permanent_pincode), nominee_name=VALUES(nominee_name),
    nominee_relation=VALUES(nominee_relation), nominee_dob=VALUES(nominee_dob),
    nominee2_name=VALUES(nominee2_name), nominee2_relation=VALUES(nominee2_relation),
    nominee2_dob=VALUES(nominee2_dob), bank_name=VALUES(bank_name),
    account_number=VALUES(account_number), ifsc_code=VALUES(ifsc_code),
    bank_branch=VALUES(bank_branch), account_type=VALUES(account_type),
    account_holder_name=VALUES(account_holder_name), ob_bank_name=VALUES(ob_bank_name),
    ob_bank_branch=VALUES(ob_bank_branch), ob_ifsc_code=VALUES(ob_ifsc_code),
    ob_account_no_encrypted=VALUES(ob_account_no_encrypted),
    ob_account_type=VALUES(ob_account_type), ob_account_holder_name=VALUES(ob_account_holder_name),
    basic=VALUES(basic), hra=VALUES(hra), conveyance=VALUES(conveyance),
    special_allowance=VALUES(special_allowance), medical_allowance=VALUES(medical_allowance),
    lta=VALUES(lta), other_allowance=VALUES(other_allowance), pli=VALUES(pli),
    bonus=VALUES(bonus), portfolio=VALUES(portfolio), gross_salary=VALUES(gross_salary),
    net_in_hand=VALUES(net_in_hand), ctc=VALUES(ctc), employer_pf=VALUES(employer_pf),
    employer_esi=VALUES(employer_esi),
    biometric_code=VALUES(biometric_code), legacy_emp_id=VALUES(legacy_emp_id),
    parent_relation=VALUES(parent_relation), band=VALUES(band), stream=VALUES(stream),
    billable_status=VALUES(billable_status), emp_for=VALUES(emp_for),
    client_name=VALUES(client_name), cost_center_code=VALUES(cost_center_code),
    source=VALUES(source), source_type=VALUES(source_type),
    qualification=VALUES(qualification), qualification_details=VALUES(qualification_details),
    passed_out_year=VALUES(passed_out_year), passed_out_state=VALUES(passed_out_state),
    passed_out_city=VALUES(passed_out_city), passed_out_percent=VALUES(passed_out_percent),
    working_experience=VALUES(working_experience), experience_year=VALUES(experience_year),
    reporting_manager_mobile=VALUES(reporting_manager_mobile),
    present_landline=VALUES(present_landline), permanent_landline=VALUES(permanent_landline),
    document_done=VALUES(document_done), box_file_no=VALUES(box_file_no),
    offer_no=VALUES(offer_no), family_annual_income=VALUES(family_annual_income),
    count_of_dependents=VALUES(count_of_dependents),
    master_updated_at=CURRENT_TIMESTAMP;
END //
DELIMITER ;


-- ── F. REBUILD NOW ──────────────────────────────────────────────────────────
CALL sp_populate_master_employee_all();
