-- 1633_exit_pass_qr_token.sql
--
-- Phase 4 of Asset & Material Exit Pass: the QR the previous three phases all
-- deferred. 1538/1539/1540 each closed with "live QR token validation" listed
-- as out of scope, which left the module half-wired: 1539 added
-- exit_verification_method ENUM('qr','manual') and exit-pass.routes.ts has
-- validated `method must be qr or manual` since Phase 2, but nothing could
-- ever PRODUCE a 'qr' method — the print layout rendered no QR and the verify
-- screen hardcoded method:"manual". The 'qr' enum value was unreachable in
-- production. This migration makes it reachable.
--
-- Stores a HASH, never the token itself (CHAR(64) = sha256 hex), matching the
-- convention 409_visitor_management_foundation.sql set with
-- tracking_token_hash — visitor.security.test.ts asserts the raw token is
-- never columned, and the same reasoning applies here: a DB read (or a leaked
-- backup) must not yield a working gate credential.
--
-- The raw token is NOT stored anywhere. It is re-derived on demand from
-- HMAC(secret, 'exitpass:v1:' || id) — see exit-pass.qr.ts. That is what makes
-- a REPRINT work: the visitor flow can get away with storing only a hash
-- because its raw token is emailed once, but a gate pass gets reprinted, so a
-- one-way-only token would leave every reprint with a dead QR.
--
-- Scope note, deliberately: this token proves the PHYSICAL PASS WAS PRESENTED,
-- it is not an authorization credential. Authorization remains what it was —
-- requireAuth + a security role + status='approved' (verifyExit). A scanned
-- token alone can never verify an exit. Single-use falls out of the existing
-- state machine for free: exit verification moves status off 'approved', so a
-- re-scan of the same QR returns verdict 'already_used'.
--
-- Purely additive: 1 nullable column + 1 unique index on a table this project
-- itself created in 1538. No existing table touched.

-- Guarded on information_schema, matching 1630/1631: `ADD COLUMN IF NOT EXISTS`
-- is not valid MySQL 8 syntax, and a bare ADD COLUMN that runs twice hard-fails
-- with ER_DUP_FIELDNAME — which the runner records as a failed migration and,
-- in production, refuses to boot on. Column and index are guarded separately so
-- a run that added the column but died before the index still self-heals.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exit_pass_requests'
      AND column_name = 'qr_token_hash') = 0,
  'ALTER TABLE exit_pass_requests
     ADD COLUMN qr_token_hash CHAR(64) NULL
       COMMENT ''sha256 of the gate QR token. The token itself is never stored - it is re-derived by HMAC from the pass id (exit-pass.qr.ts) so a reprint yields the same QR. NULL = pre-Phase-4 pass, falls back to manual pass-number entry.''
       AFTER pass_number',
  'SELECT ''exit_pass_requests.qr_token_hash already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- UNIQUE, not a plain index: two passes resolving to one token would make the
-- gate lookup ambiguous, and since the token is derived from the primary key a
-- collision means the derivation itself is broken. Better to fail the write.
-- Also the lookup path — every scan is an equality search on this column.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'exit_pass_requests'
      AND index_name = 'uq_epr_qr_token_hash') = 0,
  'ALTER TABLE exit_pass_requests
     ADD UNIQUE INDEX uq_epr_qr_token_hash (qr_token_hash)',
  'SELECT ''uq_epr_qr_token_hash already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: passes approved before this migration have a pass_number but no
-- token hash. They stay QR-less and fall back to manual pass-number entry,
-- which is exactly how they worked before this phase — no behaviour is lost.
-- The application backfills a hash the first time such a pass is printed
-- (ensureQrTokenHash in exit-pass.service.ts), so reprinting an old approved
-- pass upgrades it to QR without an operator touching anything.

SELECT '1633_exit_pass_qr_token.sql applied' AS migration_status;

-- Rollback:
--   ALTER TABLE exit_pass_requests DROP INDEX uq_epr_qr_token_hash;
--   ALTER TABLE exit_pass_requests DROP COLUMN qr_token_hash;
--   (exit_verification_method rows already written as 'qr' stay valid — the
--    enum predates this migration and is not altered here.)
