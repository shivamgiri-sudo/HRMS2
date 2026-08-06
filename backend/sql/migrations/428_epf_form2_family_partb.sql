-- EPF Form 2 Part B (Pension Scheme, Para 18) — give the family boxes a source.
--
-- Part B declares the member's FAMILY for EPS. It has printed blank on every
-- Form 2 ever issued: all 16 family_* and 6 eps_nominee_* field maps carry
-- source_path = NULL. That was deliberate — the only family-shaped data we held
-- was the PF nominee, and deriving a family from it would put a false statutory
-- declaration in front of a member for signature.
--
-- The fix is not to derive a family but to ask the member for one. The candidate
-- onboarding journey now collects family members directly, so Part B becomes
-- member-completed, just captured earlier and digitally. A family is still never
-- inferred from the PF nominee; the guardrail test asserts exactly that.
--
-- Additive only: two nullable/defaulted columns and an UPDATE of seed rows.

-- 1. candidate_onboarding_family_member gains the two fields Part B needs.
--    address: Part B column 2 asks for each family member's address and the
--    table had no such column.
--    is_eps_nominee: the EPS block is a FALLBACK on the real form, used where no
--    eligible family exists. Modelling it as a flag on a family row keeps one
--    table instead of two, and the renderer routes a flagged row to
--    eps_nominee.* and unflagged rows to family_1..4.
ALTER TABLE candidate_onboarding_family_member
  ADD COLUMN address TEXT NULL AFTER dob,
  ADD COLUMN is_eps_nominee TINYINT(1) NOT NULL DEFAULT 0 AFTER is_dependent;

-- 2. Point the seeded Part B maps at the new context namespace. These mirror
--    epfNominationFieldMaps() in backend/src/modules/employees/epfNominationForm.ts;
--    the two must agree or the acroform field-name test (TC-NOM-01) fails.
UPDATE document_template_field_map
   SET source_path = CONCAT('family.f', SUBSTRING(field_key, 8, 1), '_name')
 WHERE document_code = 'EPF_NOMINATION_FORM2' AND field_key REGEXP '^family_[1-4]_name$';

UPDATE document_template_field_map
   SET source_path = CONCAT('family.f', SUBSTRING(field_key, 8, 1), '_address')
 WHERE document_code = 'EPF_NOMINATION_FORM2' AND field_key REGEXP '^family_[1-4]_address$';

UPDATE document_template_field_map
   SET source_path = CONCAT('family.f', SUBSTRING(field_key, 8, 1), '_date_of_birth')
 WHERE document_code = 'EPF_NOMINATION_FORM2' AND field_key REGEXP '^family_[1-4]_dob$';

UPDATE document_template_field_map
   SET source_path = CONCAT('family.f', SUBSTRING(field_key, 8, 1), '_relationship')
 WHERE document_code = 'EPF_NOMINATION_FORM2' AND field_key REGEXP '^family_[1-4]_relationship$';

UPDATE document_template_field_map
   SET source_path = 'eps_nominee.name'
 WHERE document_code = 'EPF_NOMINATION_FORM2' AND field_key = 'eps_nominee_name';

UPDATE document_template_field_map
   SET source_path = 'eps_nominee.address'
 WHERE document_code = 'EPF_NOMINATION_FORM2' AND field_key = 'eps_nominee_address';

UPDATE document_template_field_map
   SET source_path = 'eps_nominee.relationship'
 WHERE document_code = 'EPF_NOMINATION_FORM2' AND field_key = 'eps_nominee_relationship';

-- The three DOB boxes share one source and split it via their existing
-- date_day / date_month / date_year transform_rule.
UPDATE document_template_field_map
   SET source_path = 'eps_nominee.date_of_birth'
 WHERE document_code = 'EPF_NOMINATION_FORM2'
   AND field_key IN ('eps_nominee_dob_day', 'eps_nominee_dob_month', 'eps_nominee_dob_year');

-- Verification: expect partb_sourced = 22 and nominee_sourced = 24.
--   SELECT
--     SUM(field_key REGEXP '^(family_[1-4]_|eps_nominee_)' AND source_path IS NOT NULL) partb_sourced,
--     SUM(field_key REGEXP '^nominee_[1-4]_' AND source_path IS NOT NULL) nominee_sourced
--   FROM document_template_field_map WHERE document_code = 'EPF_NOMINATION_FORM2';
