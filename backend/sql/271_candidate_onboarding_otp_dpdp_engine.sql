-- Migration 271: Candidate onboarding OTP/session, autosave, document master,
-- DPDP consent log, manual fallback, and readiness snapshot foundations.

CREATE TABLE IF NOT EXISTS candidate_onboarding_sessions (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id           CHAR(36)      NOT NULL,
  onboarding_id          CHAR(36)      NULL,
  session_token_hash     CHAR(64)      NOT NULL,
  device_id              VARCHAR(128)  NULL,
  mobile_last4           VARCHAR(4)    NULL,
  ip_address             VARCHAR(64)   NULL,
  user_agent             VARCHAR(512)  NULL,
  verified_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at             DATETIME      NOT NULL,
  revoked_at             DATETIME      NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_candidate_onboarding_session_token (session_token_hash),
  INDEX idx_candidate_onboarding_session_candidate (candidate_id, expires_at),
  INDEX idx_candidate_onboarding_session_active (candidate_id, revoked_at, expires_at)
);

CREATE TABLE IF NOT EXISTS candidate_otp_logs (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id           CHAR(36)      NOT NULL,
  onboarding_id          CHAR(36)      NULL,
  mobile_hash            CHAR(64)      NOT NULL,
  mobile_last4           VARCHAR(4)    NULL,
  otp_hash               VARCHAR(255)  NOT NULL,
  purpose                ENUM('onboarding_login','consent_withdrawal','data_rights') NOT NULL DEFAULT 'onboarding_login',
  delivery_channel       ENUM('sms','whatsapp','email','manual') NOT NULL DEFAULT 'sms',
  delivery_status        ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts               TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts           TINYINT UNSIGNED NOT NULL DEFAULT 5,
  expires_at             DATETIME      NOT NULL,
  verified_at            DATETIME      NULL,
  ip_address             VARCHAR(64)   NULL,
  user_agent             VARCHAR(512)  NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate_otp_candidate (candidate_id, purpose, created_at),
  INDEX idx_candidate_otp_mobile (mobile_hash, created_at)
);

CREATE TABLE IF NOT EXISTS candidate_onboarding_progress (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id           CHAR(36)      NOT NULL,
  onboarding_id          CHAR(36)      NULL,
  current_step_key       VARCHAR(80)   NOT NULL DEFAULT 'welcome',
  current_step_idx       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  completion_percent     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  pending_action_count   INT UNSIGNED  NOT NULL DEFAULT 0,
  section_status_json    JSON          NULL,
  last_saved_at          DATETIME      NULL,
  final_submitted_at     DATETIME      NULL,
  autosave_version       INT UNSIGNED  NOT NULL DEFAULT 0,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_candidate_onboarding_progress (candidate_id),
  INDEX idx_candidate_onboarding_progress_step (current_step_key)
);

CREATE TABLE IF NOT EXISTS candidate_autosave_events (
  event_id               CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id           CHAR(36)      NOT NULL,
  onboarding_id          CHAR(36)      NULL,
  section_key            VARCHAR(80)   NOT NULL,
  field_key              VARCHAR(120)  NOT NULL,
  old_value_hash         CHAR(64)      NULL,
  new_value_hash         CHAR(64)      NULL,
  save_status            ENUM('saved','failed','conflict','queued') NOT NULL DEFAULT 'saved',
  saved_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_device          VARCHAR(128)  NULL,
  ip_address             VARCHAR(64)   NULL,
  browser                VARCHAR(512)  NULL,
  autosave_version       INT UNSIGNED  NOT NULL DEFAULT 0,
  conflict_status        ENUM('none','detected','resolved','overridden') NOT NULL DEFAULT 'none',
  INDEX idx_candidate_autosave_candidate (candidate_id, saved_at),
  INDEX idx_candidate_autosave_field (candidate_id, section_key, field_key)
);

CREATE TABLE IF NOT EXISTS candidate_validation_errors (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id           CHAR(36)      NOT NULL,
  onboarding_id          CHAR(36)      NULL,
  section_key            VARCHAR(80)   NOT NULL,
  field_key              VARCHAR(120)  NOT NULL,
  error_code             VARCHAR(80)   NOT NULL,
  error_message          VARCHAR(500)  NOT NULL,
  severity               ENUM('info','warning','blocking') NOT NULL DEFAULT 'blocking',
  resolved_at            DATETIME      NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate_validation_candidate (candidate_id, resolved_at),
  INDEX idx_candidate_validation_field (candidate_id, section_key, field_key)
);

CREATE TABLE IF NOT EXISTS onboarding_document_master (
  id                         CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  document_type              VARCHAR(80)   NOT NULL,
  document_name              VARCHAR(120)  NOT NULL,
  display_name               VARCHAR(160)  NOT NULL,
  mandatory_flag             TINYINT(1)    NOT NULL DEFAULT 0,
  conditional_flag           TINYINT(1)    NOT NULL DEFAULT 0,
  condition_rule             JSON          NULL,
  required_count             INT UNSIGNED  NOT NULL DEFAULT 1,
  allowed_file_types         JSON          NOT NULL,
  max_file_size_mb           INT UNSIGNED  NOT NULL DEFAULT 10,
  page_or_side_required      VARCHAR(80)   NULL,
  accepted_document_examples JSON          NULL,
  verification_method        VARCHAR(80)   NOT NULL DEFAULT 'hr_review',
  requires_expiry_date       TINYINT(1)    NOT NULL DEFAULT 0,
  requires_ocr               TINYINT(1)    NOT NULL DEFAULT 0,
  requires_api_verification  TINYINT(1)    NOT NULL DEFAULT 0,
  requires_bgv               TINYINT(1)    NOT NULL DEFAULT 0,
  requires_manual_fallback   TINYINT(1)    NOT NULL DEFAULT 0,
  retention_rule             VARCHAR(120)  NULL,
  dpdp_purpose_code          VARCHAR(80)   NULL,
  candidate_visible          TINYINT(1)    NOT NULL DEFAULT 1,
  role_access_policy         JSON          NULL,
  sort_order                 INT UNSIGNED  NOT NULL DEFAULT 100,
  active_flag                TINYINT(1)    NOT NULL DEFAULT 1,
  created_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_onboarding_document_master (document_type, document_name),
  INDEX idx_onboarding_document_master_visible (candidate_visible, active_flag, sort_order)
);

CREATE TABLE IF NOT EXISTS candidate_dpdp_consent_log (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id           CHAR(36)      NOT NULL,
  onboarding_id          CHAR(36)      NULL,
  consent_purpose_code   VARCHAR(80)   NOT NULL,
  consent_text_version   VARCHAR(32)   NOT NULL,
  notice_version         VARCHAR(32)   NOT NULL,
  language               VARCHAR(10)   NOT NULL DEFAULT 'en',
  consent_status         ENUM('accepted','declined','withdrawn') NOT NULL,
  ip_address             VARCHAR(64)   NULL,
  browser_device         VARCHAR(512)  NULL,
  source_page            VARCHAR(120)  NULL,
  accepted_at            DATETIME      NULL,
  withdrawal_timestamp   DATETIME      NULL,
  withdrawal_reason      TEXT          NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate_dpdp_consent_candidate (candidate_id, consent_purpose_code, created_at),
  INDEX idx_candidate_dpdp_consent_active (candidate_id, consent_purpose_code, consent_status)
);

CREATE TABLE IF NOT EXISTS candidate_manual_vendor_submission (
  manual_submission_id      CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id              CHAR(36)      NOT NULL,
  onboarding_id             CHAR(36)      NULL,
  verification_type         VARCHAR(80)   NOT NULL,
  vendor_name               VARCHAR(160)  NOT NULL,
  documents_sent            JSON          NULL,
  sent_by                   CHAR(36)      NULL,
  sent_at                   DATETIME      NULL,
  vendor_reference_no       VARCHAR(160)  NULL,
  status                    ENUM('draft','sent','result_received','closed','cancelled') NOT NULL DEFAULT 'draft',
  result                    ENUM('verified','failed','insufficient','exception_approved','inconclusive') NULL,
  remarks                   TEXT          NULL,
  attachment_report_path    VARCHAR(500)  NULL,
  closed_at                 DATETIME      NULL,
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate_manual_vendor_candidate (candidate_id, status),
  INDEX idx_candidate_manual_vendor_type (verification_type, status)
);

CREATE TABLE IF NOT EXISTS candidate_onboarding_readiness (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id           CHAR(36)      NOT NULL,
  onboarding_id          CHAR(36)      NULL,
  readiness_status       ENUM('not_ready','candidate_action_pending','hr_review_pending','payroll_review_pending','bgv_pending','api_verification_pending','exception_approval_required','ready_for_employee_code','employee_code_generated') NOT NULL DEFAULT 'not_ready',
  blocking_reasons_json  JSON          NULL,
  otp_verified           TINYINT(1)    NOT NULL DEFAULT 0,
  mandatory_fields_done  TINYINT(1)    NOT NULL DEFAULT 0,
  mandatory_docs_done    TINYINT(1)    NOT NULL DEFAULT 0,
  pan_ready              TINYINT(1)    NOT NULL DEFAULT 0,
  aadhaar_ready          TINYINT(1)    NOT NULL DEFAULT 0,
  bank_ready             TINYINT(1)    NOT NULL DEFAULT 0,
  bgv_ready              TINYINT(1)    NOT NULL DEFAULT 0,
  dpdp_ready             TINYINT(1)    NOT NULL DEFAULT 0,
  payroll_ready          TINYINT(1)    NOT NULL DEFAULT 0,
  final_submit_done      TINYINT(1)    NOT NULL DEFAULT 0,
  computed_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_candidate_onboarding_readiness (candidate_id),
  INDEX idx_candidate_onboarding_readiness_status (readiness_status)
);

INSERT IGNORE INTO onboarding_document_master
  (document_type, document_name, display_name, mandatory_flag, conditional_flag, condition_rule,
   required_count, allowed_file_types, max_file_size_mb, page_or_side_required,
   accepted_document_examples, verification_method, requires_ocr, requires_api_verification,
   requires_bgv, requires_manual_fallback, retention_rule, dpdp_purpose_code,
   role_access_policy, sort_order)
VALUES
('identity', 'aadhaar', 'Aadhaar', 1, 0, NULL, 1, JSON_ARRAY('pdf','jpg','jpeg','png'), 10, 'front_or_pdf', JSON_ARRAY('Masked Aadhaar PDF','Clear Aadhaar image'), 'aadhaar_offline_or_digilocker', 1, 1, 1, 1, 'candidate_sensitive_kyc', 'aadhaar_ekyc_verification', JSON_OBJECT('candidate','own','hr','masked','bgv','required_only','payroll_hr','masked'), 10),
('identity', 'pan', 'PAN Card', 1, 0, NULL, 1, JSON_ARRAY('pdf','jpg','jpeg','png'), 10, 'front_or_pdf', JSON_ARRAY('PAN card image','ePAN PDF'), 'pan_api', 1, 1, 1, 1, 'candidate_sensitive_kyc', 'pan_verification', JSON_OBJECT('candidate','own','hr','masked','bgv','required_only','payroll_hr','full_if_authorized'), 20),
('address', 'address_proof', 'Address Proof', 1, 0, NULL, 1, JSON_ARRAY('pdf','jpg','jpeg','png'), 10, 'full_document', JSON_ARRAY('Voter ID','Driving Licence','Utility bill','Bank statement'), 'address_doc_api_or_vendor', 1, 1, 1, 1, 'candidate_sensitive_bgv', 'address_verification', JSON_OBJECT('candidate','own','hr','masked','bgv','required_only'), 30),
('identity', 'id_proof', 'ID Proof', 0, 1, JSON_OBJECT('policy','required_by_client_or_bgv'), 1, JSON_ARRAY('pdf','jpg','jpeg','png'), 10, 'front_or_pdf', JSON_ARRAY('Passport','Driving Licence','Voter ID'), 'hr_review_or_vendor', 1, 0, 1, 1, 'candidate_sensitive_bgv', 'kyc_verification', JSON_OBJECT('candidate','own','hr','masked','bgv','required_only'), 40),
('education', 'education_proof', 'Education Proof', 1, 0, NULL, 1, JSON_ARRAY('pdf','jpg','jpeg','png'), 10, 'certificate_or_marksheet', JSON_ARRAY('Highest qualification certificate','Final marksheet'), 'education_vendor', 1, 1, 1, 1, 'candidate_bgv', 'education_verification', JSON_OBJECT('candidate','own','hr','view','bgv','view'), 50),
('photo', 'photo', 'Photo', 1, 0, NULL, 1, JSON_ARRAY('jpg','jpeg','png'), 5, 'passport_photo', JSON_ARRAY('Recent passport-size photo'), 'photo_match_or_hr_review', 0, 0, 1, 0, 'employee_master_photo', 'onboarding_data_processing', JSON_OBJECT('candidate','own','hr','view','bgv','view'), 60),
('profile', 'resume', 'Resume', 1, 0, NULL, 1, JSON_ARRAY('pdf','doc','docx'), 10, 'resume', JSON_ARRAY('ATS resume','Updated resume'), 'ats_or_hr_review', 0, 0, 0, 0, 'recruitment_to_employee_file', 'onboarding_data_processing', JSON_OBJECT('candidate','own','hr','view','recruiter','view'), 70),
('bank', 'bank_proof', 'Bank Proof / Cancelled Cheque', 0, 1, JSON_OBJECT('required_when','penny_drop_failed_or_policy_required'), 1, JSON_ARRAY('pdf','jpg','jpeg','png'), 10, 'bank_document', JSON_ARRAY('Cancelled cheque','Bank passbook front page'), 'penny_drop_fallback', 1, 0, 0, 1, 'payroll_sensitive', 'bank_penny_drop_verification', JSON_OBJECT('candidate','own','payroll_hr','view','hr','masked'), 80),
('esign', 'code_of_conduct_nda', 'Code of Conduct / NDA', 0, 1, JSON_OBJECT('preferred','esign','fallback','signed_upload'), 1, JSON_ARRAY('pdf','jpg','jpeg','png'), 10, 'signed_document', JSON_ARRAY('eSigned policy acknowledgement','Signed NDA PDF'), 'esign_or_hr_review', 0, 0, 0, 0, 'employee_policy_file', 'esign_processing', JSON_OBJECT('candidate','own','hr','view'), 90),
('statutory', 'epf_declaration', 'EPF Declaration', 0, 1, JSON_OBJECT('required_when','statutory_policy_requires'), 1, JSON_ARRAY('pdf','jpg','jpeg','png'), 10, 'declaration', JSON_ARRAY('Digital EPF declaration','Signed Form 11'), 'digital_declaration', 0, 0, 0, 0, 'statutory_payroll', 'statutory_payroll_processing', JSON_OBJECT('candidate','own','payroll_hr','view'), 100),
('experience', 'experience_proof', 'Experience Proof', 0, 1, JSON_OBJECT('required_when','candidate_experienced'), 1, JSON_ARRAY('pdf','jpg','jpeg','png'), 10, 'letter_or_slip', JSON_ARRAY('Experience letter','Relieving letter','Last payslip'), 'employment_vendor', 1, 1, 1, 1, 'candidate_bgv', 'employment_verification', JSON_OBJECT('candidate','own','hr','view','bgv','view'), 110);
