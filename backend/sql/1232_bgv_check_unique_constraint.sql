-- Migration: 1232_bgv_check_unique_constraint.sql
-- Purpose: Add UNIQUE constraint on candidate_bgv_check(candidate_id, check_type)
-- Date: 2026-08-18
-- Issue: createOrUpdateCheck() in bgv-verification.service.ts does
--        SELECT-existing-then-branch-UPDATE-or-INSERT, with no unique constraint to make
--        that atomic. Two near-simultaneous calls for the same (candidate_id, check_type)
--        can each see "no existing row" before either INSERT commits, producing duplicate
--        rows — observed live: one candidate accumulated 39 duplicate aadhaar rows and 18
--        duplicate bank rows, all fired milliseconds apart. All existing duplicates were
--        cleaned up separately (bgv-check-duplicate-cleanup.ts, applied 2026-08-17); this
--        migration closes the race at the data layer so it cannot recur, and is a
--        prerequisite for rewriting createOrUpdateCheck as a single atomic
--        INSERT ... ON DUPLICATE KEY UPDATE statement.

-- ============================================================================
-- 1. Audit — this must return zero rows, or the ALTER below will fail with
--    ER_DUP_ENTRY. Re-verified clean via backend/scripts/bgv-check-duplicate-scan.ts
--    immediately before this file was written (2026-08-18, public-IP connection,
--    off the office LAN) — 0 duplicate (candidate_id, check_type) groups.
-- ============================================================================

SELECT candidate_id, check_type, COUNT(*) AS dupe_count
  FROM candidate_bgv_check
 GROUP BY candidate_id, check_type
HAVING COUNT(*) > 1;

-- If the audit above returns any rows, STOP: run
-- backend/scripts/bgv-check-duplicate-cleanup.ts --apply first. This migration does
-- not dedup inline (unlike 503_pt_slab_dedup.sql) because the dedup here already ran
-- separately and needed the richer per-check-type "which row is authoritative" logic
-- that script encodes, not a blind MIN(id)/most-recent-updated_at pick embedded in SQL.
--
-- A SIGNAL-based guard was tried here to fail with a clear custom message instead of
-- MySQL's generic ER_DUP_ENTRY on the ALTER below, and does not work: SIGNAL is
-- rejected via PREPARE/EXECUTE outside a stored program ("This command is not
-- supported in the prepared statement protocol yet", confirmed live against this
-- server). The ALTER's own ER_DUP_ENTRY is the safety net instead, same as 503.

-- ============================================================================
-- 2. Add the UNIQUE constraint, idempotently (information_schema-guarded
--    PREPARE/EXECUTE — this MySQL 8.0.42 server rejects
--    ADD CONSTRAINT ... IF NOT EXISTS with ER_PARSE_ERROR while still recording
--    the migration as applied, per the pattern already established across this
--    manifest; see e.g. 1224/1225/1227/1228/503).
-- ============================================================================

SET @constraint_exists = (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'candidate_bgv_check'
     AND CONSTRAINT_NAME = 'uq_bgv_check_candidate_type'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE candidate_bgv_check
   ADD CONSTRAINT uq_bgv_check_candidate_type
   UNIQUE (candidate_id, check_type)',
  'SELECT ''uq_bgv_check_candidate_type constraint already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 1232_bgv_check_unique_constraint.sql complete' AS status;
