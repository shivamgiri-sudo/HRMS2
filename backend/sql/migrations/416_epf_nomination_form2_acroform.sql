-- 416_epf_nomination_form2_acroform.sql
--
-- EPF Form 2 (nomination and declaration) was requires_hr_upload = 1 with no
-- field maps at all, so HR filled it by hand and uploaded a scan for every
-- joiner. It becomes a fillable AcroForm generated from employee data and
-- e-signed like every other joining document.
--
-- This also corrects EPF Form 11, which was fill_mode = 'pdf_box_grid' pointing
-- at a flat scan: all 69 of its maps had NULL x/y, so the coordinate-overlay
-- renderer skipped every field and the statutory form generated blank.
--
-- Additive and re-runnable. Touches no signed or generated documents.
--
-- Set the directory the templates were written to before running, e.g.
--   SET @template_dir = '/var/www/HRMS2/backend/private-storage/document-templates';
-- The files are produced by:
--   npx tsx scripts/build-joining-document-templates.ts

SET @template_dir = IFNULL(@template_dir,
  '/var/www/HRMS2/backend/private-storage/document-templates');

-- ---------------------------------------------------------------------------
-- 1. EPF Form 11 - point at the fillable AcroForm
-- ---------------------------------------------------------------------------
UPDATE employee_joining_document_template
   SET fill_mode = 'acroform',
       template_storage_path = CONCAT(@template_dir, '/EPF_DECLARATION-v1.pdf'),
       template_mime_type = 'application/pdf',
       requires_hr_upload = 0,
       requires_candidate_esign = 1,
       updated_at = NOW()
 WHERE document_code = 'EPF_DECLARATION';

UPDATE document_template_field_map m
  JOIN employee_joining_document_template t ON t.id = m.template_id
   SET m.mapping_mode = 'acroform'
 WHERE t.document_code = 'EPF_DECLARATION';

-- ---------------------------------------------------------------------------
-- 2. EPF Form 2 - create the template row if absent, then normalise it
-- ---------------------------------------------------------------------------
INSERT INTO employee_joining_document_template
  (id, document_code, document_name, document_category, fill_mode,
   template_version, template_storage_path, template_mime_type,
   requires_candidate_esign, requires_hr_upload, requires_hr_verification,
   is_mandatory, active_status, created_at, updated_at)
SELECT UUID(), 'EPF_NOMINATION_FORM2',
       'EPF & EPS Nomination and Declaration Form (Form 2)', 'statutory',
       'acroform', 'v1',
       CONCAT(@template_dir, '/EPF_NOMINATION_FORM2-v1.pdf'), 'application/pdf',
       1, 0, 1, 1, 1, NOW(), NOW()
  FROM DUAL
 WHERE NOT EXISTS (
   SELECT 1 FROM employee_joining_document_template
    WHERE document_code = 'EPF_NOMINATION_FORM2');

UPDATE employee_joining_document_template
   SET fill_mode = 'acroform',
       template_storage_path = CONCAT(@template_dir, '/EPF_NOMINATION_FORM2-v1.pdf'),
       template_mime_type = 'application/pdf',
       requires_hr_upload = 0,
       requires_candidate_esign = 1,
       is_mandatory = 1,
       active_status = 1,
       updated_at = NOW()
 WHERE document_code = 'EPF_NOMINATION_FORM2';

SET @nom_id = (SELECT id FROM employee_joining_document_template
                WHERE document_code = 'EPF_NOMINATION_FORM2' LIMIT 1);

-- ---------------------------------------------------------------------------
-- 3. Field maps (76).
--
--    22 of them - the Part B pension-family rows and the EPS nominee -
--    carry NULL source_path deliberately. No pension-family data exists
--    (employee_nominee.nominee_for only ever contains 'gratuity,pf'), and
--    deriving a family from the PF nominee would put a false statutory
--    declaration in front of a member for signature. Those boxes are completed
--    by the member at signing.
-- ---------------------------------------------------------------------------
DELETE m FROM document_template_field_map m WHERE m.template_id = @nom_id;

INSERT INTO document_template_field_map
  (id, template_id, document_code, field_key, field_label, source_path, field_type,
   mapping_mode, pdf_field_name, transform_rule, checked_when)
VALUES
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'member_name', 'Member Name', 'epf.employee_name', 'text', 'acroform', 'member_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'father_or_husband_name', 'Father / Husband Name', 'epf.father_or_spouse_name', 'text', 'acroform', 'father_or_husband_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'relationship_father', 'Relationship - Father', 'epf.relationship_type', 'checkbox', 'acroform', 'relationship_father', NULL, 'father'),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'relationship_husband', 'Relationship - Husband', 'epf.relationship_type', 'checkbox', 'acroform', 'relationship_husband', NULL, 'husband'),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'dob_day', 'DOB Day', 'epf.date_of_birth', 'text', 'acroform', 'dob_day', 'date_day', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'dob_month', 'DOB Month', 'epf.date_of_birth', 'text', 'acroform', 'dob_month', 'date_month', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'dob_year', 'DOB Year', 'epf.date_of_birth', 'text', 'acroform', 'dob_year', 'date_year', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'gender_male', 'Sex - Male', 'epf.gender', 'checkbox', 'acroform', 'gender_male', NULL, 'Male'),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'gender_female', 'Sex - Female', 'epf.gender', 'checkbox', 'acroform', 'gender_female', NULL, 'Female'),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'gender_other', 'Sex - Transgender', 'epf.gender', 'checkbox', 'acroform', 'gender_other', NULL, 'Other'),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'marital_status_married', 'Marital Status - Married', 'epf.marital_status', 'checkbox', 'acroform', 'marital_status_married', NULL, 'Married'),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'marital_status_unmarried', 'Marital Status - Unmarried', 'epf.marital_status', 'checkbox', 'acroform', 'marital_status_unmarried', NULL, 'Unmarried'),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'account_number', 'Account No. / UAN', 'epf.uan_masked', 'text', 'acroform', 'account_number', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'permanent_address', 'Permanent Address', 'employee.permanent_address', 'text', 'acroform', 'permanent_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'temporary_address', 'Temporary Address', 'employee.current_address', 'text', 'acroform', 'temporary_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_1_name', 'Nominee 1 Name', 'nominee.n1_name', 'text', 'acroform', 'nominee_1_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_1_address', 'Nominee 1 Address', 'nominee.n1_address', 'text', 'acroform', 'nominee_1_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_1_relationship', 'Nominee 1 Relationship', 'nominee.n1_relationship', 'text', 'acroform', 'nominee_1_relationship', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_1_dob', 'Nominee 1 Date of Birth', 'nominee.n1_date_of_birth', 'text', 'acroform', 'nominee_1_dob', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_1_share', 'Nominee 1 Share %', 'nominee.n1_share_percentage', 'text', 'acroform', 'nominee_1_share', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_1_guardian', 'Nominee 1 Guardian', 'nominee.n1_guardian_name', 'text', 'acroform', 'nominee_1_guardian', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_2_name', 'Nominee 2 Name', 'nominee.n2_name', 'text', 'acroform', 'nominee_2_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_2_address', 'Nominee 2 Address', 'nominee.n2_address', 'text', 'acroform', 'nominee_2_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_2_relationship', 'Nominee 2 Relationship', 'nominee.n2_relationship', 'text', 'acroform', 'nominee_2_relationship', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_2_dob', 'Nominee 2 Date of Birth', 'nominee.n2_date_of_birth', 'text', 'acroform', 'nominee_2_dob', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_2_share', 'Nominee 2 Share %', 'nominee.n2_share_percentage', 'text', 'acroform', 'nominee_2_share', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_2_guardian', 'Nominee 2 Guardian', 'nominee.n2_guardian_name', 'text', 'acroform', 'nominee_2_guardian', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_3_name', 'Nominee 3 Name', 'nominee.n3_name', 'text', 'acroform', 'nominee_3_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_3_address', 'Nominee 3 Address', 'nominee.n3_address', 'text', 'acroform', 'nominee_3_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_3_relationship', 'Nominee 3 Relationship', 'nominee.n3_relationship', 'text', 'acroform', 'nominee_3_relationship', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_3_dob', 'Nominee 3 Date of Birth', 'nominee.n3_date_of_birth', 'text', 'acroform', 'nominee_3_dob', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_3_share', 'Nominee 3 Share %', 'nominee.n3_share_percentage', 'text', 'acroform', 'nominee_3_share', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_3_guardian', 'Nominee 3 Guardian', 'nominee.n3_guardian_name', 'text', 'acroform', 'nominee_3_guardian', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_4_name', 'Nominee 4 Name', 'nominee.n4_name', 'text', 'acroform', 'nominee_4_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_4_address', 'Nominee 4 Address', 'nominee.n4_address', 'text', 'acroform', 'nominee_4_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_4_relationship', 'Nominee 4 Relationship', 'nominee.n4_relationship', 'text', 'acroform', 'nominee_4_relationship', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_4_dob', 'Nominee 4 Date of Birth', 'nominee.n4_date_of_birth', 'text', 'acroform', 'nominee_4_dob', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_4_share', 'Nominee 4 Share %', 'nominee.n4_share_percentage', 'text', 'acroform', 'nominee_4_share', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'nominee_4_guardian', 'Nominee 4 Guardian', 'nominee.n4_guardian_name', 'text', 'acroform', 'nominee_4_guardian', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'parta_date_day', 'Part A Date Day', 'system.current_date', 'text', 'acroform', 'parta_date_day', 'date_day', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'parta_date_month', 'Part A Date Month', 'system.current_date', 'text', 'acroform', 'parta_date_month', 'date_month', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'parta_date_year', 'Part A Date Year', 'system.current_date', 'text', 'acroform', 'parta_date_year', 'date_year', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'parta_place', 'Part A Place', 'epf.branch_name_snapshot', 'text', 'acroform', 'parta_place', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'parta_signature', 'Part A Signature', NULL, 'text', 'acroform', 'parta_signature', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_1_name', 'Family Member 1 Name', NULL, 'text', 'acroform', 'family_1_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_1_address', 'Family Member 1 Address', NULL, 'text', 'acroform', 'family_1_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_1_dob', 'Family Member 1 Date of Birth', NULL, 'text', 'acroform', 'family_1_dob', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_1_relationship', 'Family Member 1 Relationship', NULL, 'text', 'acroform', 'family_1_relationship', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_2_name', 'Family Member 2 Name', NULL, 'text', 'acroform', 'family_2_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_2_address', 'Family Member 2 Address', NULL, 'text', 'acroform', 'family_2_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_2_dob', 'Family Member 2 Date of Birth', NULL, 'text', 'acroform', 'family_2_dob', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_2_relationship', 'Family Member 2 Relationship', NULL, 'text', 'acroform', 'family_2_relationship', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_3_name', 'Family Member 3 Name', NULL, 'text', 'acroform', 'family_3_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_3_address', 'Family Member 3 Address', NULL, 'text', 'acroform', 'family_3_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_3_dob', 'Family Member 3 Date of Birth', NULL, 'text', 'acroform', 'family_3_dob', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_3_relationship', 'Family Member 3 Relationship', NULL, 'text', 'acroform', 'family_3_relationship', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_4_name', 'Family Member 4 Name', NULL, 'text', 'acroform', 'family_4_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_4_address', 'Family Member 4 Address', NULL, 'text', 'acroform', 'family_4_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_4_dob', 'Family Member 4 Date of Birth', NULL, 'text', 'acroform', 'family_4_dob', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'family_4_relationship', 'Family Member 4 Relationship', NULL, 'text', 'acroform', 'family_4_relationship', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'eps_nominee_name', 'EPS Nominee Name', NULL, 'text', 'acroform', 'eps_nominee_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'eps_nominee_address', 'EPS Nominee Address', NULL, 'text', 'acroform', 'eps_nominee_address', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'eps_nominee_relationship', 'EPS Nominee Relationship', NULL, 'text', 'acroform', 'eps_nominee_relationship', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'eps_nominee_dob_day', 'EPS Nominee DOB Day', NULL, 'text', 'acroform', 'eps_nominee_dob_day', 'date_day', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'eps_nominee_dob_month', 'EPS Nominee DOB Month', NULL, 'text', 'acroform', 'eps_nominee_dob_month', 'date_month', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'eps_nominee_dob_year', 'EPS Nominee DOB Year', NULL, 'text', 'acroform', 'eps_nominee_dob_year', 'date_year', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'partb_date_day', 'Part B Date Day', 'system.current_date', 'text', 'acroform', 'partb_date_day', 'date_day', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'partb_date_month', 'Part B Date Month', 'system.current_date', 'text', 'acroform', 'partb_date_month', 'date_month', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'partb_date_year', 'Part B Date Year', 'system.current_date', 'text', 'acroform', 'partb_date_year', 'date_year', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'partb_place', 'Part B Place', 'epf.branch_name_snapshot', 'text', 'acroform', 'partb_place', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'partb_signature', 'Part B Signature', NULL, 'text', 'acroform', 'partb_signature', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'establishment_name', 'Establishment Name and Address', 'system.company_name', 'text', 'acroform', 'establishment_name', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'employer_signature', 'Employer Signature', NULL, 'text', 'acroform', 'employer_signature', NULL, NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'employer_date_day', 'Employer Date Day', 'system.current_date', 'text', 'acroform', 'employer_date_day', 'date_day', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'employer_date_month', 'Employer Date Month', 'system.current_date', 'text', 'acroform', 'employer_date_month', 'date_month', NULL),
  (UUID(), @nom_id, 'EPF_NOMINATION_FORM2', 'employer_date_year', 'Employer Date Year', 'system.current_date', 'text', 'acroform', 'employer_date_year', 'date_year', NULL);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT document_code, fill_mode, requires_hr_upload, requires_candidate_esign
--   FROM employee_joining_document_template
--  WHERE document_code IN ('EPF_DECLARATION','EPF_NOMINATION_FORM2');
--
-- SELECT COUNT(*) AS total, SUM(source_path IS NULL) AS member_completed
--   FROM document_template_field_map WHERE template_id = @nom_id;
--   -- expect total = 76, member_completed = 25
