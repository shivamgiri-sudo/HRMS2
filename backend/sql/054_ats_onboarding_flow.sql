-- backend/sql/054_ats_onboarding_flow.sql
-- ATS Onboarding Flow — all tables/alters for Phase 3 candidate-to-employee activation
-- NOTE: This migration is idempotent - columns and tables created with IF NOT EXISTS will be skipped if they exist

-- 1. Check and create columns in ats_candidate if table exists
ALTER TABLE ats_candidate ADD COLUMN address TEXT;
ALTER TABLE ats_candidate ADD COLUMN education VARCHAR(100);
ALTER TABLE ats_candidate ADD COLUMN experience VARCHAR(50);
ALTER TABLE ats_candidate ADD COLUMN rotational_shift TINYINT(1);
ALTER TABLE ats_candidate ADD COLUMN preferred_shift VARCHAR(50);
ALTER TABLE ats_candidate ADD COLUMN night_shift_ok VARCHAR(50);
ALTER TABLE ats_candidate ADD COLUMN leaves_in_3months TINYINT(1);
ALTER TABLE ats_candidate ADD COLUMN owns_two_wheeler TINYINT(1);
ALTER TABLE ats_candidate ADD COLUMN id_proof_available TINYINT(1);
ALTER TABLE ats_candidate ADD COLUMN education_proof_available TINYINT(1);
ALTER TABLE ats_candidate ADD COLUMN resume_url VARCHAR(500);
ALTER TABLE ats_candidate ADD COLUMN selfie_url VARCHAR(500);
ALTER TABLE ats_candidate ADD COLUMN recruiter_name VARCHAR(255);
ALTER TABLE ats_candidate ADD COLUMN user_id CHAR(36);
ALTER TABLE ats_candidate ADD COLUMN profile_status ENUM('registered','selected','onboarding_sent','profile_submitted','onboarded') NOT NULL DEFAULT 'registered';
ALTER TABLE ats_candidate ADD COLUMN father_name VARCHAR(255);
ALTER TABLE ats_candidate ADD COLUMN current_address TEXT;
ALTER TABLE ats_candidate ADD COLUMN permanent_address TEXT;
ALTER TABLE ats_candidate ADD COLUMN aadhar_number VARCHAR(20);
ALTER TABLE ats_candidate ADD COLUMN pan_number VARCHAR(20);
ALTER TABLE ats_candidate ADD COLUMN uan_number VARCHAR(50);
ALTER TABLE ats_candidate ADD COLUMN aadhar_verified TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ats_candidate ADD COLUMN pan_verified TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ats_candidate ADD COLUMN bank_account_no VARCHAR(50);
ALTER TABLE ats_candidate ADD COLUMN bank_ifsc VARCHAR(20);
ALTER TABLE ats_candidate ADD COLUMN bank_name VARCHAR(100);
ALTER TABLE ats_candidate ADD COLUMN emergency_contact_name VARCHAR(255);
ALTER TABLE ats_candidate ADD COLUMN emergency_contact_mobile VARCHAR(20);
ALTER TABLE ats_candidate ADD COLUMN profile_submitted_at DATETIME;

-- 2. ALTER auth_user — force password change flag
ALTER TABLE auth_user ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;

-- 3. ALTER ats_onboarding_bridge — token + approval tracking
ALTER TABLE ats_onboarding_bridge ADD COLUMN onboarding_token VARCHAR(100);
ALTER TABLE ats_onboarding_bridge ADD COLUMN onboarding_token_expires_at DATETIME;
ALTER TABLE ats_onboarding_bridge ADD COLUMN hr_approved_by CHAR(36);
ALTER TABLE ats_onboarding_bridge ADD COLUMN hr_approved_at DATETIME;

CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_token ON ats_onboarding_bridge (onboarding_token);

-- 4. NEW: ats_onboarding_request
CREATE TABLE IF NOT EXISTS ats_onboarding_request (
  id           CHAR(36)   NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36)   NOT NULL UNIQUE,
  branch_id    CHAR(36),
  requested_by CHAR(36)   NOT NULL,
  assigned_to  CHAR(36),
  status       ENUM('pending','in_progress','offer_submitted','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id)    REFERENCES branch_master(id) ON DELETE SET NULL,
  INDEX idx_onb_req_branch (branch_id),
  INDEX idx_onb_req_status (status)
);

-- 5. NEW: ats_employment_offer
CREATE TABLE IF NOT EXISTS ats_employment_offer (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  onboarding_request_id CHAR(36)      NOT NULL UNIQUE,
  candidate_id          CHAR(36)      NOT NULL,
  emp_type              ENUM('OnRoll','OffRoll') NOT NULL DEFAULT 'OnRoll',
  date_of_joining       DATE          NOT NULL,
  date_of_salary        DATE,
  profile               VARCHAR(100),
  department_id         CHAR(36),
  designation_id        CHAR(36),
  cost_centre           VARCHAR(100),
  reporting_manager_id  CHAR(36),
  role_type             ENUM('Analyst','SupportStaff'),
  salary_band           VARCHAR(50),
  offered_ctc           DECIMAL(12,2) NOT NULL,
  basic                 DECIMAL(12,2),
  hra                   DECIMAL(12,2),
  conveyance            DECIMAL(12,2),
  da                    DECIMAL(12,2),
  special_allowance     DECIMAL(12,2),
  other_allowance       DECIMAL(12,2),
  bonus                 DECIMAL(12,2),
  gross                 DECIMAL(12,2),
  pf_employee           DECIMAL(12,2),
  pf_employer           DECIMAL(12,2),
  esic_employee         DECIMAL(12,2),
  esic_employer         DECIMAL(12,2),
  professional_tax      DECIMAL(12,2),
  gratuity              DECIMAL(12,2),
  admin_charges         DECIMAL(12,2),
  net_in_hand           DECIMAL(12,2),
  status                ENUM('draft','submitted') NOT NULL DEFAULT 'draft',
  created_by            CHAR(36)      NOT NULL,
  submitted_at          DATETIME,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (onboarding_request_id) REFERENCES ats_onboarding_request(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id)          REFERENCES ats_candidate(id)           ON DELETE CASCADE,
  FOREIGN KEY (department_id)         REFERENCES department_master(id)       ON DELETE SET NULL,
  FOREIGN KEY (designation_id)        REFERENCES designation_master(id)      ON DELETE SET NULL,
  FOREIGN KEY (reporting_manager_id)  REFERENCES employees(id)               ON DELETE SET NULL
);

-- 6. NEW: ats_offer_approval
CREATE TABLE IF NOT EXISTS ats_offer_approval (
  id          CHAR(36)   NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  offer_id    CHAR(36)   NOT NULL,
  approver_id CHAR(36)   NOT NULL,
  action      ENUM('approved','rejected') NOT NULL,
  remarks     TEXT,
  action_at   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (offer_id) REFERENCES ats_employment_offer(id) ON DELETE CASCADE,
  INDEX idx_offer_approval_offer (offer_id)
);

-- 7. NEW: ats_email_log
CREATE TABLE IF NOT EXISTS ats_email_log (
  id           CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36)    NOT NULL,
  email_type   ENUM('registration','selected','rejected','token_sent','offer_review','approved','welcome') NOT NULL,
  sent_to      VARCHAR(255) NOT NULL,
  status       ENUM('sent','failed','skipped') NOT NULL DEFAULT 'sent',
  error_message TEXT,
  sent_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  INDEX idx_email_log_cand (candidate_id),
  INDEX idx_email_log_type (email_type)
);

-- 8. NEW: salary_band_master
CREATE TABLE IF NOT EXISTS salary_band_master (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  band_code     VARCHAR(50)   NOT NULL UNIQUE,
  band_name     VARCHAR(100)  NOT NULL,
  min_ctc       DECIMAL(12,2) NOT NULL,
  max_ctc       DECIMAL(12,2) NOT NULL,
  basic_pct     DECIMAL(5,2)  NOT NULL DEFAULT 40.00,
  hra_pct       DECIMAL(5,2)  NOT NULL DEFAULT 40.00,
  active_status TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO salary_band_master (band_code, band_name, min_ctc, max_ctc, basic_pct, hra_pct) VALUES
  ('D', 'Band D — Entry',        80000,   150000,  40.00, 40.00),
  ('C', 'Band C — Junior',      150001,   300000,  40.00, 40.00),
  ('B', 'Band B — Mid',         300001,   600000,  45.00, 40.00),
  ('A', 'Band A — Senior',      600001,  1200000,  50.00, 50.00),
  ('M', 'Band M — Management', 1200001, 99999999,  50.00, 50.00)
ON DUPLICATE KEY UPDATE band_name = VALUES(band_name);

-- 9. Ensure employee_salary_snapshot has columns used by approval flow
ALTER TABLE employee_salary_snapshot ADD COLUMN effective_date DATE NULL;
ALTER TABLE employee_salary_snapshot ADD COLUMN offered_ctc DECIMAL(12,2) NULL;
