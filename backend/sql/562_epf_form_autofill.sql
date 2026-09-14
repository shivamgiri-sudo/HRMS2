-- Migration 562: EPF joining document auto-fill
--
-- Changes:
-- 1. EPF_DECLARATION (Form 11): switch from requires_hr_upload to auto-generate
--    so the joining document engine prefills it from employee data (UAN, PAN, DOB, etc.)
--    instead of waiting for HR to manually upload the signed form.
--    The universalDigitalFormFill.service.ts already maps the required EPF AcroForm fields.
--    HR can still override the generated draft by re-uploading if needed.
--
-- 2. Add EPF_NOMINATION_FORM2: EPF Form 2 (nomination) as a new auto-generated joining doc.
--    Nominee data comes from employee_epf_compliance_nominees table.
--
-- Both changes are ADDITIVE and idempotent.
-- Existing checklist rows for employees already created are NOT retroactively updated here;
-- run the retroactive UPDATE below only after verifying on staging.

-- 1. Switch EPF_DECLARATION from hr-upload to auto-generate
UPDATE employee_joining_document_template
   SET requires_hr_upload     = 0,
       requires_hr_verification = 1,
       updated_at             = NOW()
 WHERE document_code = 'EPF_DECLARATION'
   AND template_version = 'v1';

-- 2. Add EPF_NOMINATION_FORM2 template (idempotent)
-- NOTE: requires_hr_upload = 1 (HR uploads manually) because universalDigitalFormFill
-- does not yet have AcroForm field mappings for EPF Form 2 nominee data.
-- The correct source table is employee_epf_nominee (not employee_epf_compliance_nominees).
-- TODO: add Form 2 field mappings in universalDigitalFormFill.service.ts and switch
-- requires_hr_upload to 0 in a follow-up migration.
INSERT IGNORE INTO employee_joining_document_template (
  document_code,
  document_name,
  document_category,
  template_version,
  requires_candidate_esign,
  requires_hr_upload,
  requires_hr_verification,
  is_mandatory,
  active_status
) VALUES (
  'EPF_NOMINATION_FORM2',
  'EPF Form 2 — Nomination & Declaration',
  'statutory',
  'v1',
  0,         -- not candidate e-sign
  1,         -- HR uploads manually until auto-fill mappings are built
  1,         -- HR must verify after upload
  1,         -- mandatory
  1
);

-- OPTIONAL retroactive fix: update existing pending checklist rows for EPF_DECLARATION
-- so they switch from pending_hr_upload → pending_generation.
-- Review and run manually after verifying on staging:
-- UPDATE employee_joining_document_checklist
--    SET action_type = 'generate',
--        status      = 'pending_generation',
--        updated_at  = NOW()
--  WHERE document_code = 'EPF_DECLARATION'
--    AND status        = 'pending_hr_upload';
