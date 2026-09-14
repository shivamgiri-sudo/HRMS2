-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Backfill ats_candidate.status column for recruiter visibility
-- ═══════════════════════════════════════════════════════════════════════════════
-- Context:
-- The `status` column was added in migration 344 as a human-readable field.
-- Existing candidates have NULL in this column, causing them to be invisible
-- to recruiters in the /api/ats/recruiter/my-candidates endpoint.
--
-- This migration backfills NULL status values based on current_stage and
-- final_decision to restore candidate visibility to recruiters.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Backfill status column where it is NULL
-- Priority 1: Use final_decision if it exists (from interview submission)
UPDATE ats_candidate
SET status = final_decision
WHERE status IS NULL
  AND final_decision IS NOT NULL
  AND final_decision != '';

-- Priority 2: Map current_stage to a sensible status value for pending candidates
UPDATE ats_candidate
SET status = CASE
  WHEN current_stage IN ('New', 'Applied', 'Registered', 'Screening') THEN 'Waiting'
  WHEN current_stage IN ('Interview', 'Interview Scheduled', 'In Interview') THEN 'In Interview'
  WHEN current_stage = 'Selected' THEN 'Selected'
  WHEN current_stage = 'Rejected' THEN 'Rejected'
  WHEN current_stage LIKE '%BGV%' THEN 'BGV Pending'
  WHEN current_stage LIKE '%Offer%' THEN 'Offer Pending'
  WHEN current_stage = 'Joined' THEN 'Joined'
  ELSE 'Waiting'
END
WHERE status IS NULL;

-- Create index on status column for better query performance
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_candidate'
      AND INDEX_NAME = 'idx_ats_status') = 0,
  'ALTER TABLE ats_candidate ADD INDEX idx_ats_status (status)',
  'SELECT ''idx_ats_status already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════════
-- End of migration
-- ═══════════════════════════════════════════════════════════════════════════════
