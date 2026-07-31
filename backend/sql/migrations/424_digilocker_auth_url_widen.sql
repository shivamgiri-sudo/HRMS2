-- 424: widen candidate_digilocker_session.auth_url
--
-- DigiLocker has produced no session since 2026-06-27. The provider call was
-- never the problem: Luckpay returns HTTP 200 "Verification completed
-- successfully" with a valid authorization URL. That URL carries a JWT in its
-- query string and is now 1042 characters:
--
--   https://digilocker-prod.digitap.work?token=eyJhbGciOiJSUzI1NiJ9...
--
-- auth_url is varchar(1000), so the INSERT in startDigilockerByToken fails with
-- ER_DATA_TOO_LONG (1406) and the whole request 500s. The candidate sees
-- "An unexpected server error occurred" on Step 3, which is exactly what was
-- reported. A JWT's length varies with its claims, which is why this began
-- silently the day the token crossed 1000 characters.
--
-- TEXT rather than a bigger varchar: the value is provider-controlled and can
-- grow again, and the column is not indexed, so there is nothing to gain from a
-- fixed bound. Widening is backward compatible and cannot truncate existing rows.

ALTER TABLE candidate_digilocker_session
  MODIFY COLUMN auth_url TEXT NULL;
