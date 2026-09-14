-- 421_recruitment_consent_text_version.sql
--
-- Seeds the missing consent_text_version row for purpose_code = 'recruitment'.
--
-- consent_text_version had exactly one active row in the whole table, for
-- purpose_code = 'employment'. recordConsent() throws a 422
-- CONSENT_VERSION_UNAVAILABLE for any other purpose, including 'recruitment' —
-- the one the candidate walk-in registration form uses. That is on top of a
-- separate bug fixed in code (privacy.service.ts selected a column,
-- version_tag, that does not exist at all), so consent recording has never
-- worked for a candidate under any circumstance.
--
-- The text below is not new legal language. It is the exact wording already
-- shown to every candidate on the live registration screen, next to the
-- checkbox that blocks submission until it is ticked
-- (src/pages/NativeATSCandidateRegistration.tsx:1863-1865). This migration
-- makes the system record what candidates are already being asked to agree
-- to; it does not introduce a new consent notice.
--
-- legal_reviewed_by / legal_reviewed_at are left NULL deliberately: this
-- migration has not obtained a fresh legal sign-off, it has only made the
-- existing, already-displayed text persistable. If Legal wants different
-- wording, add a new version row and supersede this one — do not edit this
-- row in place once it is active.
--
-- Additive and re-runnable.

INSERT INTO consent_text_version
  (id, version_code, purpose_code, title, consent_text, text_hash, language,
   status, activated_at, created_at, updated_at)
SELECT
  UUID(), 'recruitment-v1', 'recruitment',
  'Recruitment Data Processing Consent',
  'I consent to the processing of my personal data for recruitment purposes as per the Privacy Policy and the Digital Personal Data Protection Act 2023. I understand I may withdraw this consent at any time.',
  SHA2('I consent to the processing of my personal data for recruitment purposes as per the Privacy Policy and the Digital Personal Data Protection Act 2023. I understand I may withdraw this consent at any time.', 256),
  'en', 'active', NOW(), NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM consent_text_version
   WHERE purpose_code = 'recruitment' AND status = 'active'
);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT version_code, purpose_code, status, LEFT(consent_text, 60) AS preview
--   FROM consent_text_version WHERE purpose_code = 'recruitment';
--  -- expect exactly 1 active row
