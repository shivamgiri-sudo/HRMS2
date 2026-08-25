-- Migration: 442_candidate_fraud_alert_unique_constraint.sql
-- Purpose: Add UNIQUE constraint on candidate_fraud_alert(candidate_id, alert_type)
-- Date: 2026-08-25
-- Issue: ocr.service.ts and face-match.service.ts each do a bare
--        INSERT INTO candidate_fraud_alert whenever their check re-fires (e.g. a
--        document is re-uploaded, or a duplicate-check retry runs again), with no
--        unique constraint to stop the same (candidate_id, alert_type) pair from
--        being inserted repeatedly. Every re-run of an OCR/face-match/duplicate
--        check adds another open alert row for the same underlying finding,
--        inflating the Fraud Alert Review queue with duplicates of the same
--        candidate/alert_type. This migration dedupes existing rows and adds the
--        constraint the call sites are being converted to rely on
--        (INSERT ... ON DUPLICATE KEY UPDATE), mirroring
--        1232_bgv_check_unique_constraint.sql for the sibling candidate_bgv_check
--        table.

-- ============================================================================
-- 1. Deduplicate existing rows — for each (candidate_id, alert_type) group,
--    keep only the most recently created row (highest id — these are UUIDs,
--    so ordering is by created_at, with id as a tiebreaker for identical
--    timestamps) and delete the rest.
-- ============================================================================

DELETE fa FROM candidate_fraud_alert fa
  JOIN (
    SELECT candidate_id, alert_type,
           MAX(CONCAT(DATE_FORMAT(created_at, '%Y%m%d%H%i%s'), '-', id)) AS keep_marker
      FROM candidate_fraud_alert
     GROUP BY candidate_id, alert_type
    HAVING COUNT(*) > 1
  ) keepers
    ON keepers.candidate_id = fa.candidate_id
   AND keepers.alert_type = fa.alert_type
 WHERE CONCAT(DATE_FORMAT(fa.created_at, '%Y%m%d%H%i%s'), '-', fa.id) <> keepers.keep_marker;

-- ============================================================================
-- 2. Audit — this must return zero rows, or the ALTER below will fail with
--    ER_DUP_ENTRY.
-- ============================================================================

SELECT candidate_id, alert_type, COUNT(*) AS dupe_count
  FROM candidate_fraud_alert
 GROUP BY candidate_id, alert_type
HAVING COUNT(*) > 1;

-- ============================================================================
-- 3. Add the UNIQUE constraint, idempotently (information_schema-guarded
--    PREPARE/EXECUTE — mirrors 1232_bgv_check_unique_constraint.sql; this
--    MySQL 8.0.42 server rejects ADD CONSTRAINT ... IF NOT EXISTS with
--    ER_PARSE_ERROR while still recording the migration as applied).
-- ============================================================================

SET @constraint_exists = (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'candidate_fraud_alert'
     AND CONSTRAINT_NAME = 'uq_candidate_alert_type'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE candidate_fraud_alert
   ADD UNIQUE KEY uq_candidate_alert_type (candidate_id, alert_type)',
  'SELECT ''uq_candidate_alert_type constraint already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 442_candidate_fraud_alert_unique_constraint.sql complete' AS status;
