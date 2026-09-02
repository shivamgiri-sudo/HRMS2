-- Adds recoverable (encrypted-at-rest) Aadhaar storage to candidate_onboarding_profile,
-- mirroring the pan_number_encrypted column that table already has.
--
-- CONTEXT
-- Before this, Aadhaar only ever got a masked value + a one-way hash -- deliberately,
-- per the code comment this migration's paired app change removes. That was a real
-- safeguard: the Aadhaar Act, 2016 (s.29) restricts private storage of Aadhaar numbers
-- without UIDAI AUA/KUA authorization, and an existing test
-- (candidateListPiiMask.contract.test.ts) asserts the raw column is never exposed by
-- any API.
--
-- Requested explicitly (2026-09-02) because EPFO KYC/UAN seeding needs the complete
-- Aadhaar number, not a masked one. NOTE: a purpose-built mechanism for exactly this
-- already exists and does not require this column --
-- backend/src/modules/employees/epfKycCapture.service.ts captures the real number at
-- EPF-declaration e-sign time, writes it into the generated PDF, and discards it,
-- storing only the masked form. This migration was requested anyway, after that
-- alternative was raised and the request was reaffirmed.
--
-- SAFETY: additive only (new nullable column). No existing data touched. Reversible
-- by dropping the column; nothing else reads or writes it until the paired app change
-- (onboarding-full.service.ts) ships.

ALTER TABLE candidate_onboarding_profile
  ADD COLUMN IF NOT EXISTS aadhaar_number_encrypted TEXT DEFAULT NULL
    AFTER aadhaar_number_hash;
