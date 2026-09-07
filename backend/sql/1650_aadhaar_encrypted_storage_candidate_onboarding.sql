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

-- SYNTAX: ADD COLUMN IF NOT EXISTS is MariaDB. MySQL 8.0.42 -- which this system
-- runs -- rejects it outright, and the runner stops on the first failure, so a
-- fresh database would have failed to boot the moment this was registered.
-- Rewritten as an information_schema-guarded PREPARE/EXECUTE, matching 1048 and
-- the rest of this directory. Declared type, nullability, default and position
-- are unchanged from the original.
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'candidate_onboarding_profile'
              AND column_name = 'aadhaar_number_encrypted');
SET @ddl := IF(@c = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN aadhaar_number_encrypted TEXT DEFAULT NULL AFTER aadhaar_number_hash',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
