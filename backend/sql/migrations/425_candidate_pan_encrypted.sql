-- 425: store the candidate's PAN encrypted at rest, so PAN verification can run
--
-- candidate_onboarding_profile keeps only pan_number_masked ("ABCXXXX4F") and
-- pan_number_hash. Neither can be sent to a verification provider: the masked
-- form is not a PAN, and a hash is one-way. triggerRealBgvChecksAsync guards the
-- PAN call with /^[A-Z]{5}[0-9]{4}[A-Z]$/, which the masked value fails, so
-- automatic PAN verification has never been able to run for a candidate who came
-- through this flow. It is currently recorded as manual_review — honest, but not
-- verification.
--
-- This mirrors what bank details already do. candidate_onboarding_bank_detail has
-- carried account_no_encrypted (AES via utils/encryption) alongside the masked and
-- hashed forms since penny-drop was built, and loadAsyncBgvTriggerContext decrypts
-- it at the point of the provider call. PAN gets the same treatment: masked value
-- still the only thing ever returned to a browser, hash still used for duplicate
-- detection, ciphertext read solely by the server when calling the provider.
--
-- Additive and backward compatible: existing rows keep a NULL ciphertext and
-- simply continue to fall through to manual review until the candidate next saves
-- their PAN.

ALTER TABLE candidate_onboarding_profile
  ADD COLUMN pan_number_encrypted TEXT NULL AFTER pan_number_hash;
