-- Migration 202: Onboarding V2 + Court Check + Address/Education BGV
-- Adds step-resume index, court/address/education check columns, recruiter feedback fields
-- Also adds legacy masjclrentry fields missing from V1 profile table

DELIMITER $$

-- 1. candidate_onboarding_profile: last visited section for refresh-resume
DROP PROCEDURE IF EXISTS _m202_profile $$
CREATE PROCEDURE _m202_profile()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'current_step_idx'
  ) THEN
    ALTER TABLE candidate_onboarding_profile
      ADD COLUMN current_step_idx TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'Last visited section index in V2 onboarding wizard (0-10)';
  END IF;
END$$
CALL _m202_profile() $$
DROP PROCEDURE IF EXISTS _m202_profile $$

-- 2. candidate_onboarding_profile: passport + DL numbers (from masjclrentry.PassportNo / dlNo)
DROP PROCEDURE IF EXISTS _m202_profile_docs $$
CREATE PROCEDURE _m202_profile_docs()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'passport_number'
  ) THEN
    ALTER TABLE candidate_onboarding_profile
      ADD COLUMN passport_number      VARCHAR(50)  NULL COMMENT 'Passport number (masjclrentry.PassportNo)',
      ADD COLUMN dl_number            VARCHAR(50)  NULL COMMENT 'Driving licence number (masjclrentry.dlNo)',
      ADD COLUMN landline_number      VARCHAR(30)  NULL COMMENT 'Landline / alternate contact (masjclrentry.LandLine)',
      ADD COLUMN alt_landline_number  VARCHAR(30)  NULL COMMENT 'Present-address landline (masjclrentry.LandLine1)';
  END IF;
END$$
CALL _m202_profile_docs() $$
DROP PROCEDURE IF EXISTS _m202_profile_docs $$

-- 3. candidate_onboarding_profile: statutory IDs (from masjclrentry EPFNo/NewEpfNo/ESICNo/UAN)
DROP PROCEDURE IF EXISTS _m202_profile_statutory $$
CREATE PROCEDURE _m202_profile_statutory()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'epf_number'
  ) THEN
    ALTER TABLE candidate_onboarding_profile
      ADD COLUMN epf_number       VARCHAR(50) NULL COMMENT 'Old EPF member ID (masjclrentry.EPFNo)',
      ADD COLUMN new_epf_number   VARCHAR(50) NULL COMMENT 'New EPF member ID (masjclrentry.NewEpfNo)',
      ADD COLUMN uan_number       VARCHAR(30) NULL COMMENT 'Universal Account Number (masjclrentry.UAN)',
      ADD COLUMN esic_number      VARCHAR(30) NULL COMMENT 'ESIC beneficiary number (masjclrentry.ESICNo)',
      ADD COLUMN pf_eligible      VARCHAR(10) NULL COMMENT 'PF eligibility flag (masjclrentry.pfelig)',
      ADD COLUMN esi_eligible     VARCHAR(10) NULL COMMENT 'ESI eligibility flag (masjclrentry.esielig)';
  END IF;
END$$
CALL _m202_profile_statutory() $$
DROP PROCEDURE IF EXISTS _m202_profile_statutory $$

-- 4. candidate_onboarding_profile: second nominee (from masjclrentry.nom1/nom2)
DROP PROCEDURE IF EXISTS _m202_profile_nominee2 $$
CREATE PROCEDURE _m202_profile_nominee2()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'nominee2_name'
  ) THEN
    ALTER TABLE candidate_onboarding_profile
      ADD COLUMN nominee2_name          VARCHAR(200) NULL COMMENT 'Second nominee name (masjclrentry.nom2)',
      ADD COLUMN nominee2_relation      VARCHAR(80)  NULL COMMENT 'Second nominee relation',
      ADD COLUMN nominee2_date_of_birth DATE         NULL COMMENT 'Second nominee DOB';
  END IF;
END$$
CALL _m202_profile_nominee2() $$
DROP PROCEDURE IF EXISTS _m202_profile_nominee2 $$

-- 5. candidate_onboarding_profile: work/location info (masjclrentry.Emp_Location_Type/work_status/SubLocation)
DROP PROCEDURE IF EXISTS _m202_profile_work $$
CREATE PROCEDURE _m202_profile_work()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'emp_location_type'
  ) THEN
    ALTER TABLE candidate_onboarding_profile
      ADD COLUMN emp_location_type  VARCHAR(50)  NULL COMMENT 'WFH/WFO/Hybrid (masjclrentry.Emp_Location_Type)',
      ADD COLUMN work_status        VARCHAR(50)  NULL COMMENT 'Billable/Non-Billable (masjclrentry.work_status)',
      ADD COLUMN sub_location       VARCHAR(255) NULL COMMENT 'Sub-location within branch (masjclrentry.SubLocation)';
  END IF;
END$$
CALL _m202_profile_work() $$
DROP PROCEDURE IF EXISTS _m202_profile_work $$

-- 6. candidate_onboarding_experience: reporting manager (masjclrentry.Reporting_Manager_Name/Mobile)
DROP PROCEDURE IF EXISTS _m202_experience_mgr $$
CREATE PROCEDURE _m202_experience_mgr()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_experience' AND COLUMN_NAME = 'reporting_manager_name'
  ) THEN
    ALTER TABLE candidate_onboarding_experience
      ADD COLUMN reporting_manager_name      VARCHAR(200) NULL COMMENT 'Reporting manager at last employer',
      ADD COLUMN reporting_manager_mobile    VARCHAR(30)  NULL COMMENT 'Reporting manager contact number';
  END IF;
END$$
CALL _m202_experience_mgr() $$
DROP PROCEDURE IF EXISTS _m202_experience_mgr $$

-- 7. candidate_onboarding_qualification: board/institution name (for masjclrentry.Qualification_Details)
DROP PROCEDURE IF EXISTS _m202_qual_board $$
CREATE PROCEDURE _m202_qual_board()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_qualification' AND COLUMN_NAME = 'institution_name'
  ) THEN
    ALTER TABLE candidate_onboarding_qualification
      ADD COLUMN institution_name  VARCHAR(200) NULL COMMENT 'School/college/university name',
      ADD COLUMN roll_number       VARCHAR(100) NULL COMMENT 'Roll/certificate number for education BGV',
      ADD COLUMN board_type        VARCHAR(30)  NULL COMMENT 'cbse_10 | cbse_12 | university | other';
  END IF;
END$$
CALL _m202_qual_board() $$
DROP PROCEDURE IF EXISTS _m202_qual_board $$

-- 8. candidate_bgv_report: court check + address doc type tracking
DROP PROCEDURE IF EXISTS _m202_bgv_report $$
CREATE PROCEDURE _m202_bgv_report()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_bgv_report' AND COLUMN_NAME = 'court_status'
  ) THEN
    ALTER TABLE candidate_bgv_report
      ADD COLUMN court_status
        ENUM('not_run','queued','passed','failed','partial','manual_review')
        NOT NULL DEFAULT 'not_run'
        COMMENT 'Court/criminal records API check status',
      ADD COLUMN court_remarks       TEXT NULL,
      ADD COLUMN address_doc_type    VARCHAR(30) NULL
        COMMENT 'driving_license | voter_id | manual',
      ADD COLUMN education_board_type VARCHAR(30) NULL
        COMMENT 'cbse_10 | cbse_12 | university | manual';
  END IF;
END$$
CALL _m202_bgv_report() $$
DROP PROCEDURE IF EXISTS _m202_bgv_report $$

-- 9. candidate_bgv_check.check_type ENUM: add court, address_doc, education_doc
DROP PROCEDURE IF EXISTS _m202_bgv_check $$
CREATE PROCEDURE _m202_bgv_check()
BEGIN
  DECLARE col_type TEXT;
  SELECT COLUMN_TYPE INTO col_type
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'candidate_bgv_check'
     AND COLUMN_NAME = 'check_type';
  IF col_type IS NOT NULL AND col_type NOT LIKE '%court%' THEN
    ALTER TABLE candidate_bgv_check
      MODIFY COLUMN check_type
        ENUM('pan','aadhaar','aadhaar_offline','bank','digilocker',
             'employment','education','address','criminal',
             'court','address_doc','education_doc','photo_match')
        NOT NULL;
  END IF;
END$$
CALL _m202_bgv_check() $$
DROP PROCEDURE IF EXISTS _m202_bgv_check $$

-- 10. ats_candidate_stage_log: recruiter interview feedback
DROP PROCEDURE IF EXISTS _m202_stage_log $$
CREATE PROCEDURE _m202_stage_log()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate_stage_log' AND COLUMN_NAME = 'interview_rating'
  ) THEN
    ALTER TABLE ats_candidate_stage_log
      ADD COLUMN interview_rating  TINYINT NULL
        COMMENT '1-5 rating by recruiter at time of stage transition',
      ADD COLUMN interview_notes   TEXT NULL
        COMMENT 'Structured recruiter feedback at time of stage transition';
  END IF;
END$$
CALL _m202_stage_log() $$
DROP PROCEDURE IF EXISTS _m202_stage_log $$

DELIMITER ;
