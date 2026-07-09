-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 373: CREATE TABLE candidate_onboarding_profile (IF NOT EXISTS)
--
-- This table was historically created outside version control.
-- ALTER TABLE migrations 138, 200, 202, 203, 289, 298, 309, 323, 335, 341, 345
-- all assume this table already exists.  On a fresh install those migrations
-- fail with "Table doesn't exist".
--
-- This migration MUST run before migrations 138+.  The startup runner already
-- applies files in filename-ascending order; as long as this file is applied
-- before 138_ats_complete_journey.sql the install will succeed.
--
-- All downstream ALTER TABLE migrations use IF NOT EXISTS guards or stored-
-- procedure guards so re-running them against a table that already has those
-- columns is safe (no-op).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS candidate_onboarding_profile (
  -- ── Identity ───────────────────────────────────────────────────────────────
  id                          CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id                CHAR(36)      NOT NULL,

  -- ── Wizard state ───────────────────────────────────────────────────────────
  onboarding_token_hash       VARCHAR(255)  NULL,
  current_step_idx            TINYINT UNSIGNED NOT NULL DEFAULT 0
                                COMMENT 'Last visited section index in the V2 onboarding wizard (0–10)',
  section_completion_json     JSON          NULL
                                COMMENT 'JSON map of section → completion status',
  profile_status              VARCHAR(100)  NULL,
  submit_blocked_reason       TEXT          NULL,
  draft_saved_at              DATETIME      NULL,
  submitted_at                DATETIME      NULL,

  -- ── Personal details ───────────────────────────────────────────────────────
  title                       VARCHAR(50)   NULL,
  employee_name               VARCHAR(255)  NULL,
  father_husband_name         VARCHAR(255)  NULL,
  father_name                 VARCHAR(255)  NULL,
  mother_name                 VARCHAR(255)  NULL,
  guardian_name               VARCHAR(255)  NULL,
  gender                      ENUM('male','female','other') NULL,
  marital_status              ENUM('single','married','divorced','widowed') NULL,
  date_of_birth               DATE          NULL,
  blood_group                 VARCHAR(10)   NULL,
  nationality                 VARCHAR(100)  NULL DEFAULT 'Indian',
  religion                    VARCHAR(100)  NULL,
  category                    VARCHAR(100)  NULL COMMENT 'SC/ST/OBC/General/Other',

  -- ── Contact ────────────────────────────────────────────────────────────────
  mobile_number               VARCHAR(20)   NULL,
  alt_mobile_number           VARCHAR(15)   NULL COMMENT 'Alternate / secondary mobile number',
  personal_email_id           VARCHAR(255)  NULL,
  official_email_id           VARCHAR(255)  NULL,
  landline_number             VARCHAR(30)   NULL COMMENT 'Landline / alternate contact',
  alt_landline_number         VARCHAR(30)   NULL COMMENT 'Present-address landline',

  -- ── Emergency contact ──────────────────────────────────────────────────────
  emergency_contact_name      VARCHAR(255)  NULL,
  emergency_contact_relation  VARCHAR(100)  NULL,
  emergency_contact_mobile    VARCHAR(20)   NULL,
  emergency_contact_number    VARCHAR(20)   NULL,
  emergency_contact_address   TEXT          NULL,

  -- ── Present address ────────────────────────────────────────────────────────
  present_address             TEXT          NULL,
  present_address_line1       VARCHAR(500)  NULL,
  present_address_line2       VARCHAR(500)  NULL,
  present_city                VARCHAR(100)  NULL,
  present_state               VARCHAR(100)  NULL COMMENT 'Present / current state of residence',
  present_state_id            CHAR(36)      NULL,
  present_pincode             VARCHAR(10)   NULL,

  -- ── Permanent address ──────────────────────────────────────────────────────
  permanent_address           TEXT          NULL,
  permanent_address_line1     VARCHAR(500)  NULL,
  permanent_address_line2     VARCHAR(500)  NULL,
  permanent_city              VARCHAR(100)  NULL,
  permanent_state             VARCHAR(100)  NULL COMMENT 'Permanent / home state',
  permanent_state_id          CHAR(36)      NULL,
  permanent_pincode           VARCHAR(10)   NULL,
  address_proof_type          VARCHAR(50)   NULL
                                COMMENT 'aadhaar/driving_license/voter_id/passport/rent_agreement/utility_bill',

  -- ── Identity documents ─────────────────────────────────────────────────────
  -- Masked/hashed PAN — never store plain PAN here (use employee_statutory_info for plain)
  pan_number                  VARCHAR(20)   NULL,
  pan_number_masked           VARCHAR(20)   NULL,
  pan_number_hash             CHAR(64)      NULL,
  -- Masked/hashed Aadhaar
  aadhar_number               VARCHAR(20)   NULL,
  aadhaar_number_masked       VARCHAR(20)   NULL,
  aadhaar_number_hash         CHAR(64)      NULL,
  full_name_aadhaar           VARCHAR(255)  NULL COMMENT 'Name as per Aadhaar',
  -- Other ID documents
  passport_no                 VARCHAR(50)   NULL,
  passport_number             VARCHAR(50)   NULL COMMENT 'V2 form alias for passport_no',
  driving_license_no          VARCHAR(50)   NULL,
  driving_license             VARCHAR(50)   NULL,
  dl_number                   VARCHAR(50)   NULL COMMENT 'V2 form alias for driving_license_no',
  voter_id                    VARCHAR(50)   NULL,

  -- ── Statutory ──────────────────────────────────────────────────────────────
  uan_number                  VARCHAR(50)   NULL COMMENT 'Universal Account Number (PF)',
  uan                         VARCHAR(20)   NULL,
  epf_number                  VARCHAR(50)   NULL COMMENT 'Previous EPF account number',
  new_epf_number              VARCHAR(50)   NULL COMMENT 'New EPF member ID',
  esic_number                 VARCHAR(50)   NULL,
  pf_eligible                 VARCHAR(10)   NULL COMMENT 'PF eligibility flag',
  esi_eligible                VARCHAR(10)   NULL COMMENT 'ESI eligibility flag',
  eps_member                  TINYINT(1)    NULL,
  international_worker        TINYINT(1)    NULL DEFAULT 0,
  previous_pf_member          TINYINT(1)    NULL COMMENT '1=yes 0=no',
  pf_opt_out_elected          TINYINT(1)    NOT NULL DEFAULT 0
                                COMMENT 'Candidate elected to opt out of PF on Form 11 online step (1 = yes)',
  pf_opt_out_consent_text     TEXT          NULL
                                COMMENT 'Full Form 11 declaration text shown to candidate at time of consent',
  pf_opt_out_consented_at     DATETIME      NULL
                                COMMENT 'UTC timestamp when candidate clicked consent on Form 11 step',

  -- ── Bank details ───────────────────────────────────────────────────────────
  bank_branch_name            VARCHAR(255)  NULL,

  -- ── Nominee 1 ──────────────────────────────────────────────────────────────
  nominee_name                VARCHAR(255)  NULL,
  nominee_relation            VARCHAR(50)   NULL,
  nominee_dob                 DATE          NULL,
  nominee_date_of_birth       DATE          NULL DEFAULT NULL,
  nominee1_share_pct          TINYINT UNSIGNED NULL COMMENT 'Share % for nominee 1',
  nominee_contact             VARCHAR(20)   NULL,

  -- ── Nominee 2 ──────────────────────────────────────────────────────────────
  nominee2_name               VARCHAR(255)  NULL,
  nominee2_relation           VARCHAR(50)   NULL,
  nominee2_dob                DATE          NULL DEFAULT NULL,
  nominee2_date_of_birth      DATE          NULL DEFAULT NULL,
  nominee2_share_pct          TINYINT UNSIGNED NULL COMMENT 'Share % for nominee 2',

  -- ── Work assignment ────────────────────────────────────────────────────────
  emp_location_type           VARCHAR(50)   NULL COMMENT 'WFH/WFO/Hybrid',
  work_status                 VARCHAR(50)   NULL COMMENT 'Billable/Non-Billable',
  sub_location                VARCHAR(255)  NULL COMMENT 'Sub-location within branch',

  -- ── Consent and declarations ───────────────────────────────────────────────
  declaration_accepted        TINYINT(1)    NOT NULL DEFAULT 0,
  bgv_consent                 TINYINT(1)    NOT NULL DEFAULT 0,
  bgv_consent_at              DATETIME      NULL,
  doc_verification_consent    TINYINT(1)    NOT NULL DEFAULT 0,
  policy_acknowledgement      TINYINT(1)    NOT NULL DEFAULT 0,
  dpdp_consent                TINYINT(1)    NOT NULL DEFAULT 0,
  dpdp_consent_at             DATETIME      NULL,
  statutory_declaration_accepted TINYINT(1) NOT NULL DEFAULT 0,
  statutory_declaration_at    DATETIME      NULL,

  -- ── OTP verification ───────────────────────────────────────────────────────
  otp_verified                TINYINT(1)    NOT NULL DEFAULT 0,
  otp_verified_at             DATETIME      NULL,
  otp_mobile                  VARCHAR(20)   NULL COMMENT 'Mobile used for OTP',

  -- ── Geo capture at submission ─────────────────────────────────────────────
  submit_lat                  DECIMAL(10,8) NULL COMMENT 'Latitude captured at final form submission',
  submit_lng                  DECIMAL(11,8) NULL COMMENT 'Longitude captured at final form submission',

  -- ── Review / approval ──────────────────────────────────────────────────────
  review_remarks              TEXT          NULL,
  reviewed_by                 CHAR(36)      NULL,
  reviewed_at                 DATETIME      NULL,

  -- ── Source tracking ────────────────────────────────────────────────────────
  source_type                 VARCHAR(100)  NULL,
  source                      VARCHAR(255)  NULL,

  -- ── Timestamps ─────────────────────────────────────────────────────────────
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- ── Constraints and indexes ────────────────────────────────────────────────
  UNIQUE KEY uq_profile_candidate (candidate_id),
  INDEX idx_profile_status    (profile_status),
  INDEX idx_profile_reviewed  (reviewed_by, reviewed_at),
  FOREIGN KEY (candidate_id)  REFERENCES ats_candidate(id) ON DELETE CASCADE
);
