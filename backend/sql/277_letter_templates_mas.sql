-- =====================================================================
-- Migration 275: MAS Callnet Official Letter Templates
-- Seeds all 6 letter types with exact MAS Callnet layout/content
-- Templates use {{var}} interpolation. All CREATE IF NOT EXISTS safe.
-- =====================================================================

USE mas_hrms;

-- Ensure letter_template table exists (may already exist from earlier migrations)
CREATE TABLE IF NOT EXISTS letter_template (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_code   VARCHAR(100)  NOT NULL UNIQUE,
  template_name   VARCHAR(255)  NOT NULL,
  letter_type     VARCHAR(100)  NOT NULL,
  description     TEXT          NULL,
  body_template   LONGTEXT      NOT NULL,
  active_status   TINYINT(1)    NOT NULL DEFAULT 1,
  created_by      VARCHAR(100)  NOT NULL DEFAULT 'system',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_lt_type   (letter_type),
  INDEX idx_lt_active (active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ensure generated_letter table exists
CREATE TABLE IF NOT EXISTS generated_letter (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)      NOT NULL,
  template_id     CHAR(36)      NOT NULL,
  letter_type     VARCHAR(100)  NOT NULL,
  generated_text  LONGTEXT      NOT NULL,
  generated_by    CHAR(36)      NOT NULL,
  issued_date     DATE          NULL,
  acknowledged_at DATETIME      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gl_employee (employee_id),
  FOREIGN KEY (template_id) REFERENCES letter_template(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 1. APPOINTMENT LETTER
-- =====================================================================
INSERT INTO letter_template (id, template_code, template_name, letter_type, description, body_template, created_by)
VALUES (
  'tpl-appointment-001',
  'APPOINTMENT_LETTER',
  'Appointment Letter',
  'appointment',
  'Standard MAS Callnet appointment letter with salary breakup and T&C',
  '{"type":"appointment","data":{"full_name":"{{full_name}}","employee_code":"{{employee_code}}","issued_date":"{{issued_date}}","date_of_joining":"{{date_of_joining}}","designation":"{{designation}}","department":"{{department}}","basic":"{{basic}}","hra":"{{hra}}","conveyance":"{{conveyance}}","other_allowance":"{{other_allowance}}","special_allowance":"{{special_allowance}}","bonus":"{{bonus}}","medical_allowance":"{{medical_allowance}}","portfolio":"{{portfolio}}","pli":"{{pli}}","gross_salary":"{{gross_salary}}","esic":"{{esic}}","epf":"{{epf}}","net_salary":"{{net_salary}}","employer_esic":"{{employer_esic}}","employer_epf":"{{employer_epf}}","admin_charges":"{{admin_charges}}","ctc":"{{ctc}}"}}',
  'system'
)
ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  body_template = VALUES(body_template),
  updated_at = CURRENT_TIMESTAMP;

-- =====================================================================
-- 2. SALARY SLIP
-- =====================================================================
INSERT INTO letter_template (id, template_code, template_name, letter_type, description, body_template, created_by)
VALUES (
  'tpl-salary-slip-001',
  'SALARY_SLIP',
  'Salary Slip',
  'salary_slip',
  'MAS Callnet monthly salary slip with Form 16 summary section',
  '{"type":"salary_slip","data":{"full_name":"{{full_name}}","employee_code":"{{employee_code}}","designation":"{{designation}}","department":"{{department}}","location":"{{location}}","epf_no":"{{epf_no}}","esi_no":"{{esi_no}}","working_days":"{{working_days}}","earned_days":"{{earned_days}}","month_year":"{{month_year}}","basic":"{{basic}}","hra":"{{hra}}","bonus":"{{bonus}}","conveyance":"{{conveyance}}","pa":"{{pa}}","ma":"{{ma}}","sa":"{{sa}}","oa":"{{oa}}","arrear":"{{arrear}}","incentive":"{{incentive}}","total_earnings":"{{total_earnings}}","pf":"{{pf}}","esic":"{{esic}}","loan":"{{loan}}","advance_deduction":"{{advance_deduction}}","other_deduction":"{{other_deduction}}","total_deductions":"{{total_deductions}}","net_salary":"{{net_salary}}","net_salary_words":"{{net_salary_words}}"}}',
  'system'
)
ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  body_template = VALUES(body_template),
  updated_at = CURRENT_TIMESTAMP;

-- =====================================================================
-- 3. INCREMENT LETTER
-- =====================================================================
INSERT INTO letter_template (id, template_code, template_name, letter_type, description, body_template, created_by)
VALUES (
  'tpl-increment-001',
  'INCREMENT_LETTER',
  'Increment Letter',
  'increment',
  'Annual performance increment letter with revised CTC table',
  '{"type":"increment","data":{"full_name":"{{full_name}}","designation":"{{designation}}","issued_date":"{{issued_date}}","effective_date":"{{effective_date}}","revised_ctc":"{{revised_ctc}}","revised_fixed_ctc":"{{revised_fixed_ctc}}","variable_pay":"{{variable_pay}}","total_tctc":"{{total_tctc}}","hr_name":"{{hr_name}}","hr_designation":"{{hr_designation}}"}}',
  'system'
)
ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  body_template = VALUES(body_template),
  updated_at = CURRENT_TIMESTAMP;

-- =====================================================================
-- 4. PROMOTION LETTER
-- =====================================================================
INSERT INTO letter_template (id, template_code, template_name, letter_type, description, body_template, created_by)
VALUES (
  'tpl-promotion-001',
  'PROMOTION_LETTER',
  'Promotion Letter',
  'promotion',
  'Promotion letter with new designation and department',
  '{"type":"promotion","data":{"full_name":"{{full_name}}","issued_date":"{{issued_date}}","new_designation":"{{new_designation}}","new_department":"{{new_department}}","effective_date":"{{effective_date}}","hr_name":"{{hr_name}}","hr_designation":"{{hr_designation}}"}}',
  'system'
)
ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  body_template = VALUES(body_template),
  updated_at = CURRENT_TIMESTAMP;

-- =====================================================================
-- 5. EXPERIENCE / RELIEVING LETTER
-- =====================================================================
INSERT INTO letter_template (id, template_code, template_name, letter_type, description, body_template, created_by)
VALUES (
  'tpl-experience-001',
  'EXPERIENCE_LETTER',
  'Experience Letter',
  'experience',
  'Experience / relieving letter on MAS Callnet letterhead with CIN',
  '{"type":"experience","data":{"full_name":"{{full_name}}","employee_code":"{{employee_code}}","issued_date":"{{issued_date}}","date_of_joining":"{{date_of_joining}}","date_of_exit":"{{date_of_exit}}","designation":"{{designation}}","department":"{{department}}","hr_name":"{{hr_name}}","hr_designation":"{{hr_designation}}"}}',
  'system'
)
ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  body_template = VALUES(body_template),
  updated_at = CURRENT_TIMESTAMP;

-- =====================================================================
-- 6. NDA & JOINING KIT
-- =====================================================================
INSERT INTO letter_template (id, template_code, template_name, letter_type, description, body_template, created_by)
VALUES (
  'tpl-nda-001',
  'NDA_JOINING_KIT',
  'NDA & Joining Kit',
  'nda',
  'NDA, IT compliance, BAMS declaration and consent forms for joining',
  '{"type":"nda","data":{"full_name":"{{full_name}}","employee_code":"{{employee_code}}","date_of_joining":"{{date_of_joining}}"}}',
  'system'
)
ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  body_template = VALUES(body_template),
  updated_at = CURRENT_TIMESTAMP;
