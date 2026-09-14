-- ============================================================
-- Migration: 1073_employee_profile_parity.sql
-- Purpose  : Manually-onboarded employees (Add Employee form) capture only
--            ~8 fields; the 10-step candidate journey captures ~60. This adds
--            the employee-side tables/columns needed to close that gap:
--            education (repeater, candidate side has one too via
--            candidate_onboarding_qualification), experience (single latest
--            employer, matching the candidate journey's own ExperienceForm —
--            neither side has a multi-employer work-history list), and the
--            two aggregate family fields the candidate journey collects
--            (annual_income, count_of_dependents — there is no per-member
--            family repeater on either side today).
-- Safe to re-run: every ADD COLUMN is guarded via INFORMATION_SCHEMA +
--            PREPARE/EXECUTE (this server's MySQL rejects ADD COLUMN IF NOT
--            EXISTS, see 1064's history); CREATE TABLE uses IF NOT EXISTS.
-- ============================================================

USE mas_hrms;

-- employees.annual_income / count_of_dependents — mirrors candidate journey's FamilyForm
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'annual_income') = 0,
  'ALTER TABLE employees ADD COLUMN annual_income DECIMAL(12,2) NULL AFTER working_days',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'count_of_dependents') = 0,
  'ALTER TABLE employees ADD COLUMN count_of_dependents SMALLINT NULL AFTER annual_income',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employee_statutory_info — Step10 declaration checkboxes from the candidate journey
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_statutory_info' AND COLUMN_NAME = 'previous_pf_member') = 0,
  'ALTER TABLE employee_statutory_info ADD COLUMN previous_pf_member TINYINT(1) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_statutory_info' AND COLUMN_NAME = 'eps_member') = 0,
  'ALTER TABLE employee_statutory_info ADD COLUMN eps_member TINYINT(1) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_statutory_info' AND COLUMN_NAME = 'international_worker') = 0,
  'ALTER TABLE employee_statutory_info ADD COLUMN international_worker TINYINT(1) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_statutory_info' AND COLUMN_NAME = 'declaration_accepted') = 0,
  'ALTER TABLE employee_statutory_info ADD COLUMN declaration_accepted TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── employee_education — repeater, mirrors candidate_onboarding_qualification / QualForm ──
CREATE TABLE IF NOT EXISTS employee_education (
  id                          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id                 CHAR(36)     NOT NULL,
  qualification                VARCHAR(100) NULL,
  specialization_course_name  VARCHAR(255) NULL,
  institution_name            VARCHAR(255) NULL,
  board_type                  VARCHAR(100) NULL,
  passed_out_state            VARCHAR(100) NULL,
  passed_out_city             VARCHAR(100) NULL,
  passed_out_year             SMALLINT     NULL,
  passed_out_percentage       DECIMAL(5,2) NULL,
  created_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_emp_education_emp (employee_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── employee_experience — single latest-employer entry, mirrors candidate ExperienceForm ──
CREATE TABLE IF NOT EXISTS employee_experience (
  id                 CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id        CHAR(36)      NOT NULL UNIQUE,
  is_fresher         TINYINT(1)    NOT NULL DEFAULT 0,
  employer_name      VARCHAR(255)  NULL,
  last_designation   VARCHAR(255)  NULL,
  last_ctc           DECIMAL(12,2) NULL,
  experience_years   DECIMAL(4,1)  NULL,
  from_date          DATE          NULL,
  to_date             DATE          NULL,
  reason_for_leaving TEXT          NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
