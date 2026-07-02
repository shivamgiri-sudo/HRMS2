-- ────────────────────────────────────────────────────────────────────────────
-- Migration 200: Onboarding gaps — emp_type ENUM, HR offer fields,
--                employee_code_sequence sync, BGV report table,
--                candidate extra fields, partner_id / ad_id IT triggers
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Fix emp_type ENUM in ats_employment_offer ──────────────────────────────
-- Add MGMT. TRAINEE and MGMT.TRAINEE to the ENUM so the offer form can save it
DROP PROCEDURE IF EXISTS _fix_emp_type_enum;
DELIMITER //
CREATE PROCEDURE _fix_emp_type_enum()
BEGIN
  -- Only run if the column exists and doesn't already have MGMT. TRAINEE
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ats_employment_offer'
      AND COLUMN_NAME  = 'emp_type'
  ) AND NOT FIND_IN_SET('MGMT. TRAINEE',
    (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'ats_employment_offer'
       AND COLUMN_NAME  = 'emp_type')) > 0
  THEN
    ALTER TABLE ats_employment_offer
      MODIFY COLUMN emp_type ENUM(
        'OnRoll','OffRoll','MGMT. TRAINEE','MGMT.TRAINEE','CONTRACT'
      ) NOT NULL DEFAULT 'OnRoll';
  END IF;
END //
DELIMITER ;
CALL _fix_emp_type_enum();
DROP PROCEDURE IF EXISTS _fix_emp_type_enum;

-- Also fix employees.employment_type if it exists with same narrow ENUM
DROP PROCEDURE IF EXISTS _fix_employment_type_enum;
DELIMITER //
CREATE PROCEDURE _fix_employment_type_enum()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'employees'
      AND COLUMN_NAME  = 'employment_type'
  ) THEN
    ALTER TABLE employees
      MODIFY COLUMN employment_type VARCHAR(50) NULL;
  END IF;
END //
DELIMITER ;
CALL _fix_employment_type_enum();
DROP PROCEDURE IF EXISTS _fix_employment_type_enum;

-- ── 2. Sync employee_code_sequence to actual DB max ───────────────────────────
-- The sequence table was seeded at migration time and never updated by the
-- active code path. Sync it now so the correct generator starts from the right number.
--
-- Global max across all 4 formats from employees table:
--   MAS-onroll:  MAX of SUBSTRING(employee_code,4) WHERE code REGEXP '^MAS[0-9]+$'
--   IDC-onroll:  MAX of SUBSTRING(employee_code,4) WHERE code REGEXP '^IDC[0-9]+$'
--   MAS-offrole: MAX of SUBSTRING(employee_code,1) WHERE code REGEXP '^[0-9]+C$'
--   IDC-offrole: MAX of SUBSTRING(employee_code,4) WHERE code REGEXP '^IDC[0-9]+C$'
--
-- All formats share ONE counter (they're sequential across all formats).
-- We set ALL four rows to the global max so the next code assigned is max+1.

DROP PROCEDURE IF EXISTS _sync_emp_code_seq;
DELIMITER //
CREATE PROCEDURE _sync_emp_code_seq()
BEGIN
  DECLARE v_max_onroll_mas  INT DEFAULT 0;
  DECLARE v_max_onroll_idc  INT DEFAULT 0;
  DECLARE v_max_offrole_mas INT DEFAULT 0;
  DECLARE v_max_offrole_idc INT DEFAULT 0;
  DECLARE v_global_max      INT DEFAULT 0;

  -- MAS onroll: MAS##### (no suffix)
  SELECT IFNULL(MAX(CAST(SUBSTRING(employee_code, 4) AS UNSIGNED)), 0)
    INTO v_max_onroll_mas
    FROM employees
   WHERE employee_code REGEXP '^MAS[0-9]+$';

  -- IDC onroll: IDC##### (no suffix)
  SELECT IFNULL(MAX(CAST(SUBSTRING(employee_code, 4) AS UNSIGNED)), 0)
    INTO v_max_onroll_idc
    FROM employees
   WHERE employee_code REGEXP '^IDC[0-9]+$';

  -- MAS offrole: #####C (numeric then C, no prefix)
  SELECT IFNULL(MAX(CAST(SUBSTRING(employee_code, 1, CHAR_LENGTH(employee_code)-1) AS UNSIGNED)), 0)
    INTO v_max_offrole_mas
    FROM employees
   WHERE employee_code REGEXP '^[0-9]+C$';

  -- IDC offrole: IDC#####C
  SELECT IFNULL(MAX(CAST(SUBSTRING(employee_code, 4, CHAR_LENGTH(employee_code)-4) AS UNSIGNED)), 0)
    INTO v_max_offrole_idc
    FROM employees
   WHERE employee_code REGEXP '^IDC[0-9]+C$';

  SET v_global_max = GREATEST(v_max_onroll_mas, v_max_onroll_idc, v_max_offrole_mas, v_max_offrole_idc);

  -- Ensure the 4 rows exist, then sync all to global_max
  INSERT INTO employee_code_sequence (company_prefix, is_offrole, current_sequence)
  VALUES
    ('MAS', FALSE, v_global_max),
    ('MAS', TRUE,  v_global_max),
    ('IDC', FALSE, v_global_max),
    ('IDC', TRUE,  v_global_max)
  ON DUPLICATE KEY UPDATE
    current_sequence = GREATEST(current_sequence, v_global_max);

END //
DELIMITER ;
CALL _sync_emp_code_seq();
DROP PROCEDURE IF EXISTS _sync_emp_code_seq;

-- ── 3. Add missing HR offer fields to ats_employment_offer ───────────────────
DROP PROCEDURE IF EXISTS _add_offer_hr_fields;
DELIMITER //
CREATE PROCEDURE _add_offer_hr_fields()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='kpi') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN kpi VARCHAR(100) NULL COMMENT 'KPI framework applicable' AFTER role_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='work_status') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN work_status ENUM('WFO','WFH','Hybrid') NULL DEFAULT 'WFO' AFTER kpi;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='home_branch') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN home_branch VARCHAR(100) NULL COMMENT 'Home branch if different from working branch' AFTER work_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='emp_location_type') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN emp_location_type ENUM('Onsite','Remote','Field') NULL AFTER home_branch;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='pf_eligible') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN pf_eligible TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'PF eligibility flag' AFTER net_in_hand;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='esi_eligible') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN esi_eligible TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'ESI eligibility flag' AFTER pf_eligible;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='pli') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN pli DECIMAL(12,2) NULL COMMENT 'Performance Linked Incentive' AFTER esi_eligible;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='pay_mode') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN pay_mode ENUM('Bank','Cash','Cheque') NULL DEFAULT 'Bank' AFTER pli;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='salary_payment_mode') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN salary_payment_mode ENUM('Monthly','Weekly','Fortnightly') NULL DEFAULT 'Monthly' AFTER pay_mode;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_employment_offer' AND COLUMN_NAME='dispensary') THEN
    ALTER TABLE ats_employment_offer ADD COLUMN dispensary DECIMAL(12,2) NULL COMMENT 'Medical/dispensary allowance' AFTER salary_payment_mode;
  END IF;
END //
DELIMITER ;
CALL _add_offer_hr_fields();
DROP PROCEDURE IF EXISTS _add_offer_hr_fields;

-- ── 4. Add missing candidate onboarding profile fields ────────────────────────
DROP PROCEDURE IF EXISTS _add_candidate_profile_fields;
DELIMITER //
CREATE PROCEDURE _add_candidate_profile_fields()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='passport_no') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN passport_no VARCHAR(50) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='driving_license_no') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN driving_license_no VARCHAR(50) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='epf_number') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN epf_number VARCHAR(50) NULL COMMENT 'Previous EPF account number';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='esic_number') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN esic_number VARCHAR(50) NULL COMMENT 'Previous ESIC number';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='uan_number') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN uan_number VARCHAR(50) NULL COMMENT 'Universal Account Number (PF)';
  END IF;
  -- Second nominee
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='nominee2_name') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN nominee2_name VARCHAR(255) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='nominee2_relation') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN nominee2_relation VARCHAR(50) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='nominee2_dob') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN nominee2_dob DATE NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='nominee2_share_pct') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN nominee2_share_pct TINYINT UNSIGNED NULL COMMENT 'Share % for nominee 2';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_profile' AND COLUMN_NAME='nominee1_share_pct') THEN
    ALTER TABLE candidate_onboarding_profile ADD COLUMN nominee1_share_pct TINYINT UNSIGNED NULL COMMENT 'Share % for nominee 1';
  END IF;
  -- Bank validation
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_bank_detail' AND COLUMN_NAME='validated_by') THEN
    ALTER TABLE candidate_onboarding_bank_detail ADD COLUMN validated_by CHAR(36) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_bank_detail' AND COLUMN_NAME='validated_at') THEN
    ALTER TABLE candidate_onboarding_bank_detail ADD COLUMN validated_at DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_bank_detail' AND COLUMN_NAME='validation_status') THEN
    ALTER TABLE candidate_onboarding_bank_detail ADD COLUMN validation_status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_bank_detail' AND COLUMN_NAME='rejection_remarks') THEN
    ALTER TABLE candidate_onboarding_bank_detail ADD COLUMN rejection_remarks TEXT NULL;
  END IF;
END //
DELIMITER ;
CALL _add_candidate_profile_fields();
DROP PROCEDURE IF EXISTS _add_candidate_profile_fields;

-- ── 5. BGV report table ───────────────────────────────────────────────────────
-- Stores the finalised BGV report per candidate, locked after completion
CREATE TABLE IF NOT EXISTS candidate_bgv_report (
  id                      CHAR(36)   NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id            CHAR(36)   NOT NULL,
  -- Document checklist (HR fills after physical documents received)
  photo_received          TINYINT(1) NOT NULL DEFAULT 0,
  aadhaar_received        TINYINT(1) NOT NULL DEFAULT 0,
  pan_received            TINYINT(1) NOT NULL DEFAULT 0,
  passport_received       TINYINT(1) NOT NULL DEFAULT 0,
  driving_license_received TINYINT(1) NOT NULL DEFAULT 0,
  edu_cert_received       TINYINT(1) NOT NULL DEFAULT 0,
  prev_exp_received       TINYINT(1) NOT NULL DEFAULT 0,
  bank_proof_received     TINYINT(1) NOT NULL DEFAULT 0,
  offer_letter_received   TINYINT(1) NOT NULL DEFAULT 0,
  -- Physical box file
  box_file_no             VARCHAR(100) NULL COMMENT 'Physical box file number where documents are stored',
  -- API verification results (written by verification service)
  aadhaar_status          ENUM('not_run','passed','failed','partial') NOT NULL DEFAULT 'not_run',
  aadhaar_name_match      VARCHAR(10) NULL COMMENT 'Match %, e.g. 97%',
  aadhaar_remarks         TEXT NULL,
  pan_status              ENUM('not_run','passed','failed','partial') NOT NULL DEFAULT 'not_run',
  pan_name_match          VARCHAR(10) NULL,
  pan_remarks             TEXT NULL,
  bank_status             ENUM('not_run','passed','failed','partial') NOT NULL DEFAULT 'not_run',
  bank_account_match      VARCHAR(10) NULL,
  bank_remarks            TEXT NULL,
  education_status        ENUM('not_run','passed','failed','partial') NOT NULL DEFAULT 'not_run',
  education_remarks       TEXT NULL,
  employment_status       ENUM('not_run','passed','failed','partial') NOT NULL DEFAULT 'not_run',
  employment_remarks      TEXT NULL,
  address_status          ENUM('not_run','passed','failed','partial') NOT NULL DEFAULT 'not_run',
  address_remarks         TEXT NULL,
  criminal_status         ENUM('not_run','passed','failed','partial') NOT NULL DEFAULT 'not_run',
  criminal_remarks        TEXT NULL,
  -- E-signature
  esignature_status       ENUM('not_done','validated','invalid') NOT NULL DEFAULT 'not_done',
  esignature_remarks      TEXT NULL,
  -- Overall verdict
  overall_status          ENUM('pending','in_progress','clear','refer','negative') NOT NULL DEFAULT 'pending',
  bgv_score               TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0-100 score',
  hr_remarks              TEXT NULL COMMENT 'HR final remarks',
  completed_by            CHAR(36) NULL,
  completed_at            DATETIME NULL,
  locked                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = audit-locked, immutable',
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bgv_candidate (candidate_id),
  INDEX idx_bgv_status (overall_status)
);

-- ── 6. Add partner_id and ad_id task_code to IT provisioning ─────────────────
-- These are tracked in db_bill.emp_onboard_trigger_services but missing from HRMS.
-- They are just new valid task_code values — no schema change needed as task_code is VARCHAR.
-- We add them to the role_page_access for wfm role to handle partner_id tasks.
INSERT IGNORE INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES ('wfm', 'IT_PROVISIONING_TRACKER', 1, 0, 1, 0, 1);

-- ── 7. Register migration ─────────────────────────────────────────────────────
-- (handled by runPendingMigrations.ts schema_migrations table automatically)
