-- 417_company_seal_settings.sql
--
-- Company authorised signature and rubber stamp.
--
-- Both statutory EPF forms carry an employer block the form itself requires to
-- bear a seal - Form 11 prints "SIGNATURE OF EMPLOYER WITH SEAL OF
-- ESTABLISHMENT", Form 2 prints "Signature of the employer with designation and
-- rubber stamp". Those were blank, so HR printed every joiner's statutory form,
-- signed and stamped it by hand, scanned it and uploaded it back.
--
-- The images themselves live on disk under uploads/company-assets (written by
-- the existing POST /api/files/upload). Only the filename is stored here.
--
-- org_settings PUT is update-only and 404s on an unknown key, so the rows must
-- exist before the settings screen can write to them. Additive and re-runnable.

INSERT INTO org_settings (id, setting_key, setting_value, label)
SELECT UUID(), 'company_authorised_signature_file', NULL,
       'Authorised signatory signature image (PNG with transparent background)'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM org_settings
                    WHERE setting_key = 'company_authorised_signature_file');

INSERT INTO org_settings (id, setting_key, setting_value, label)
SELECT UUID(), 'company_rubber_stamp_file', NULL,
       'Company rubber stamp / seal of establishment image (PNG with transparent background)'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM org_settings
                    WHERE setting_key = 'company_rubber_stamp_file');

INSERT INTO org_settings (id, setting_key, setting_value, label)
SELECT UUID(), 'company_authorised_signatory_name', NULL,
       'Name of the authorised signatory'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM org_settings
                    WHERE setting_key = 'company_authorised_signatory_name');

INSERT INTO org_settings (id, setting_key, setting_value, label)
SELECT UUID(), 'company_authorised_signatory_designation', NULL,
       'Designation of the authorised signatory'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM org_settings
                    WHERE setting_key = 'company_authorised_signatory_designation');

-- Verification
-- SELECT setting_key, setting_value IS NOT NULL AS configured, label
--   FROM org_settings WHERE setting_key LIKE 'company_authorised%'
--      OR setting_key = 'company_rubber_stamp_file';
