-- Finnable's own "Finnable Audit" Google Sheet ("Audit_Data" tab) -- found
-- via Drive search after "Finnable_Dashboard_v4" (a downloaded Apps Script
-- project in Downloads) turned out to be a generic, undeployed template
-- (its own README shows literal "YOUR_HOST"/"YOUR_DATABASE" placeholders,
-- nothing real to verify against). The real sheet is an AI call-quality
-- audit pipeline output, 423 real rows in the sample, with no DB backing
-- anywhere. Verified live: all 3 real MAS codes sampled resolve to real
-- employees.employee_code rows.
--
-- Scoped down from the source's full 78 columns to the ones that are
-- clearly structured across the real sample -- the dozens of audit-
-- taxonomy fields (Opening/Offered/ObjectionHandling/PrepaidPitch/
-- UpsellingEfforts/OfferUrgency and the many *Category/*Context columns)
-- are 'None' for the overwhelming majority of real rows sampled and their
-- exact scoring semantics are not verifiable without the QA team, so they
-- are left out rather than guessed, same discipline as clovia_quality_
-- audit_raw (sql/1723). The sheet's own "entrydate" column does not hold
-- dates in the real sample (e.g. "29:37.8") -- a genuine data-quality
-- defect in the source, not something to coerce into a date.
--
-- "MobileNo" is NOT a phone number in the real data (values like
-- "FN1286254440" -- letters plus digits) -- stored as reference_number,
-- not assumed to be PII requiring masking.
--
-- Row identity: the sheet's own "id" column, verified live as unique
-- across all 423 real non-blank rows.
CREATE TABLE IF NOT EXISTS finnable_quality_audit_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  audit_id BIGINT NOT NULL,
  client_id VARCHAR(50) NULL,
  campaign_id VARCHAR(50) NULL,
  call_date DATETIME NULL,
  report_date DATE NOT NULL,
  length_seconds INT NULL,
  agent_code VARCHAR(50) NULL,
  reference_number VARCHAR(50) NULL,
  call_disposition VARCHAR(100) NULL,
  sale_done TINYINT NULL,
  category VARCHAR(100) NULL,
  sub_category VARCHAR(100) NULL,
  area_for_improvement VARCHAR(500) NULL,
  feedback VARCHAR(500) NULL,
  recording_url VARCHAR(500) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_finnable_quality_audit_raw (process_id, audit_id, source_reference),
  KEY idx_finnable_quality_audit_raw_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'FINNABLE_QUALITY_AUDIT';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'FINNABLE_QUALITY_AUDIT', 'Finnable — Quality Audit', 'finnable_quality_audit_raw',
   'Finnable''s own Audit_Data sheet: AI call-quality audit pipeline output (no DB backing exists).',
   JSON_ARRAY('id', 'CallDate'),
   JSON_ARRAY('client_id', 'campaign_id', 'length_in_sec', 'AgentName', 'MobileNo', 'CallDisposition', 'SaleDone', 'Category', 'SubCategory', 'AreaForImprovement', 'Feedback', 'FileName'),
   JSON_OBJECT('id', 461220, 'CallDate', '22-05-2026 17:00', 'client_id', '497', 'length_in_sec', 152, 'AgentName', 'MAS62261', 'MobileNo', 'FN1286254440', 'CallDisposition', 'No Meaningful Interaction', 'SaleDone', '', 'FileName', 'https://nimantran.teammas.in/RECORDINGS/MP3/AOL_THIN_20260522-170053_MAS62261_FN1286254440_53740-all.mp3'),
   1);
