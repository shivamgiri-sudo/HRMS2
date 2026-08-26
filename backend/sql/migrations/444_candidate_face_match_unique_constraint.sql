-- Migration: 444_candidate_face_match_unique_constraint.sql
-- Purpose: Add UNIQUE constraint on candidate_face_match(candidate_id, photo_document_id, id_document_id)
-- Date: 2026-08-26
-- Issue: face-match.service.ts does a bare INSERT INTO candidate_face_match every
--        time compareFaces() runs, with no unique constraint to stop the same
--        (photo_document_id, id_document_id) pair being scored repeatedly (it is
--        triggered separately from both the selfie-upload and ID-doc-upload
--        paths in onboarding-full.service.ts). The Fraud Comparison Panel's "All
--        Face Match Records" table renders this table verbatim, so re-runs stack
--        up as duplicate rows for the same pair — including stale "no_face_detected"
--        rows left behind once a later run succeeds. Mirrors
--        442_candidate_fraud_alert_unique_constraint.sql for the sibling table.
--
--        Rows where either document id is NULL are left alone: MySQL treats NULL
--        as distinct in a UNIQUE index, so they cannot collide anyway and the
--        upsert this enables has no effect on them.

-- ============================================================================
-- 1. Deduplicate existing rows — for each (candidate_id, photo_document_id,
--    id_document_id) group with both ids present, keep only the most recently
--    created row and delete the rest.
-- ============================================================================

DELETE fm FROM candidate_face_match fm
  JOIN (
    SELECT candidate_id, photo_document_id, id_document_id,
           MAX(CONCAT(DATE_FORMAT(created_at, '%Y%m%d%H%i%s'), '-', id)) AS keep_marker
      FROM candidate_face_match
     WHERE photo_document_id IS NOT NULL AND id_document_id IS NOT NULL
     GROUP BY candidate_id, photo_document_id, id_document_id
    HAVING COUNT(*) > 1
  ) keepers
    ON keepers.candidate_id = fm.candidate_id
   AND keepers.photo_document_id = fm.photo_document_id
   AND keepers.id_document_id = fm.id_document_id
 WHERE fm.photo_document_id IS NOT NULL AND fm.id_document_id IS NOT NULL
   AND CONCAT(DATE_FORMAT(fm.created_at, '%Y%m%d%H%i%s'), '-', fm.id) <> keepers.keep_marker;

-- ============================================================================
-- 2. Audit — this must return zero rows, or the ALTER below will fail with
--    ER_DUP_ENTRY.
-- ============================================================================

SELECT candidate_id, photo_document_id, id_document_id, COUNT(*) AS dupe_count
  FROM candidate_face_match
 WHERE photo_document_id IS NOT NULL AND id_document_id IS NOT NULL
 GROUP BY candidate_id, photo_document_id, id_document_id
HAVING COUNT(*) > 1;

-- ============================================================================
-- 3. Add the UNIQUE constraint, idempotently (information_schema-guarded
--    PREPARE/EXECUTE — this MySQL 8.0.42 server rejects
--    ADD CONSTRAINT ... IF NOT EXISTS with ER_PARSE_ERROR while still
--    recording the migration as applied).
-- ============================================================================

SET @constraint_exists = (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'candidate_face_match'
     AND CONSTRAINT_NAME = 'uq_candidate_face_match_pair'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE candidate_face_match
   ADD UNIQUE KEY uq_candidate_face_match_pair (candidate_id, photo_document_id, id_document_id)',
  'SELECT ''uq_candidate_face_match_pair constraint already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 444_candidate_face_match_unique_constraint.sql complete' AS status;
