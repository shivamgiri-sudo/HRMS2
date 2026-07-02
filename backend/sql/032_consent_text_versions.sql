USE mas_hrms;

-- Consent text version management — allows admin to create/publish new versions
-- Legal counsel can review and mark as approved before making live
CREATE TABLE IF NOT EXISTS consent_text_version (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  version_code    VARCHAR(16)  NOT NULL UNIQUE COMMENT 'e.g. v1.0, v1.1, v2.0',
  purpose_code    ENUM('employment','payroll','communication','lms','portal','recruitment','health') NOT NULL,
  title           VARCHAR(255) NOT NULL,
  consent_text    TEXT         NOT NULL,
  text_hash       VARCHAR(64)  NOT NULL COMMENT 'SHA-256 of consent_text for tamper-detection',
  language        VARCHAR(10)  NOT NULL DEFAULT 'en',
  status          ENUM('draft','legal_review','approved','active','superseded') NOT NULL DEFAULT 'draft',
  legal_reviewed_by VARCHAR(128) COMMENT 'Name of legal counsel who reviewed',
  legal_reviewed_at DATETIME,
  activated_at    DATETIME,
  superseded_at   DATETIME,
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ctv_purpose (purpose_code, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed initial approved consent texts (FY 2025-26)
INSERT IGNORE INTO consent_text_version
  (id, version_code, purpose_code, title, consent_text, text_hash, status, legal_reviewed_by, legal_reviewed_at, activated_at)
VALUES
(UUID(), 'v1.0', 'employment',
 'Employment Data Processing Consent',
 'I consent to the processing of my personal data for employment purposes including HR management, payroll administration, attendance tracking, performance evaluation, and statutory compliance (PF, ESIC, TDS, PT) as required under my employment relationship with MAS Callnet. I understand that my data will be retained as per applicable Indian labour laws and the Digital Personal Data Protection Act 2023. I may withdraw non-mandatory consent subject to legal and contractual obligations.',
 SHA2('employment_v1.0_seed', 256), 'active', 'Legal Team', NOW(), NOW()),

(UUID(), 'v1.0', 'recruitment',
 'Recruitment Data Processing Consent',
 'I consent to the collection and processing of my personal data (including resume, contact details, educational and professional history) for recruitment and selection purposes by MAS Callnet. My data will be retained for up to 12 months post-application as per the Digital Personal Data Protection Act 2023. I may withdraw this consent at any time by contacting the HR department.',
 SHA2('recruitment_v1.0_seed', 256), 'active', 'Legal Team', NOW(), NOW()),

(UUID(), 'v1.0', 'payroll',
 'Payroll Data Processing Consent',
 'I consent to the processing of my salary, bank account details, PAN, UAN, and other financial information for payroll processing, statutory deductions (PF, ESIC, TDS, Professional Tax), and compliance filings. This data is processed under legal obligation and employment contract. Withdrawal of this consent may affect salary disbursement.',
 SHA2('payroll_v1.0_seed', 256), 'active', 'Legal Team', NOW(), NOW()),

(UUID(), 'v1.0', 'communication',
 'Communication Consent',
 'I consent to receive employment-related communications including HR notices, policy updates, payroll notifications, and system alerts via email, SMS, or in-app notifications. I may manage notification preferences at any time through the HR portal.',
 SHA2('communication_v1.0_seed', 256), 'active', 'Legal Team', NOW(), NOW()),

(UUID(), 'v1.0', 'lms',
 'Learning Management System Consent',
 'I consent to the sharing of my employee profile data (name, department, designation, branch) with the Learning Management System for training assignment, progress tracking, and certification management. LMS data will be used for workforce development and compliance reporting.',
 SHA2('lms_v1.0_seed', 256), 'active', 'Legal Team', NOW(), NOW());

-- DPDP Authority registration tracking
INSERT IGNORE INTO dpdp_config (config_key, config_value, description) VALUES
('dpdp_authority_registration_status', 'pending', 'DPDP Authority registration status: pending/applied/registered'),
('dpdp_authority_registration_number', '', 'Registration number from DPDP Authority (when notified)'),
('dpdp_authority_registration_date', '', 'Date of DPDP Authority registration'),
('dpdp_rules_notified', 'no', 'Whether DPDP Rules 2025 have been officially notified: yes/no'),
('privacy_policy_url', 'https://hrms.mascallnet.com/privacy-policy', 'Full URL of published privacy policy'),
('privacy_policy_last_updated', '2026-05-31', 'Date privacy policy was last reviewed/updated'),
('consent_active_version_employment', 'v1.0', 'Active consent version for employment purpose'),
('consent_active_version_recruitment', 'v1.0', 'Active consent version for recruitment purpose'),
('consent_active_version_payroll', 'v1.0', 'Active consent version for payroll purpose'),
('consent_active_version_communication', 'v1.0', 'Active consent version for communication purpose'),
('consent_active_version_lms', 'v1.0', 'Active consent version for LMS purpose');
