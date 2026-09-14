-- Floor compliance audit responses.
--
-- These audits have existed since Nov-2025 and live ONLY in a Google Form response
-- sheet ("Compliance Audit - Quality", 1,215 responses at the time of writing). No
-- database holds them, so nothing in HRMS can report on floor security compliance,
-- and the record disappears if that sheet is deleted or its sharing changes.
--
-- Sixteen binary parameters across three categories, exactly as the form asks them:
--   Physical & Floor   - pen/paper on the floor, unattended systems, personal
--                        devices, food and drink, ID cards, clean desk
--   System & Access    - foreign domain login, dual ID, personal mail/messaging,
--                        unapproved software or browser extensions
--   Data & Information - PI visible in sheets, PI/PHI stored outside approved
--                        tools, screenshots, local downloads, sensitive copy-paste,
--                        edit links shared outside
--
-- Answers are stored as 1 = Compliant, 0 = Non-Compliant, NULL = not answered.
-- NULL is kept distinct from 0 deliberately: an unanswered parameter is not a
-- failure, and averaging it as one would understate every score built on it.
--
-- The three category scores and the overall score are carried as the form computed
-- them rather than recomputed here, so an uploaded row always reconciles with the
-- sheet a reviewer is looking at. raw_data holds the untouched row for anything not
-- extracted.
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS, no backfill, no other table
-- touched.

CREATE TABLE IF NOT EXISTS compliance_audit_response (
  id                        VARCHAR(191) NOT NULL PRIMARY KEY,
  audit_key                 VARCHAR(512) NOT NULL,

  audit_date                DATE NULL,
  auditor_email             VARCHAR(255) NULL,
  analyst_name              VARCHAR(255) NULL,
  desk_no                   VARCHAR(64)  NULL,
  am_name                   VARCHAR(255) NULL,

  -- Physical & Floor Compliance
  pen_paper_access          TINYINT(1) NULL,
  unattended_system         TINYINT(1) NULL,
  personal_devices          TINYINT(1) NULL,
  food_drinks               TINYINT(1) NULL,
  id_card_displayed         TINYINT(1) NULL,
  clean_desk                TINYINT(1) NULL,

  -- System & Access Compliance
  foreign_domain_login      TINYINT(1) NULL,
  dual_id_login             TINYINT(1) NULL,
  personal_email_access     TINYINT(1) NULL,
  suspicious_software       TINYINT(1) NULL,

  -- Data & Information Security
  pi_visible_in_sheet       TINYINT(1) NULL,
  pi_phi_outside_tools      TINYINT(1) NULL,
  unapproved_screenshots    TINYINT(1) NULL,
  local_file_downloads      TINYINT(1) NULL,
  sensitive_copy_paste      TINYINT(1) NULL,
  edit_links_shared         TINYINT(1) NULL,

  week_label                VARCHAR(64)  NULL,
  month_label               VARCHAR(64)  NULL,
  overall_score             DECIMAL(6,2) NULL,
  physical_score            DECIMAL(6,2) NULL,
  system_access_score       DECIMAL(6,2) NULL,
  data_security_score       DECIMAL(6,2) NULL,
  remarks                   TEXT NULL,

  raw_data                  JSON NOT NULL,
  upload_batch_id           CHAR(36) NULL,
  source_row_no             INT NULL,
  uploaded_by               CHAR(36) NULL,
  uploaded_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_compliance_audit_key  (audit_key(191)),
  KEY idx_compliance_audit_date (audit_date),
  KEY idx_compliance_audit_analyst (analyst_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
