-- Migration: 503_pt_slab_dedup.sql
-- Purpose: Remove duplicate PT slab rows and add unique constraint
-- Date: 2026-07-16
-- Issue: pt_slab_master has 76-190 duplicate rows per state (correct slabs but repeated)
--        Duplicates do NOT affect calculation correctness (LIMIT 1 used), but waste space
--        and will block adding a UNIQUE constraint

-- ============================================================================
-- 1. Audit before cleanup
-- ============================================================================

SELECT state_code,
       COUNT(*) AS total_rows,
       COUNT(DISTINCT CONCAT(income_from, '-', COALESCE(income_to, 'NULL'), '-', pt_amount)) AS distinct_slabs
FROM pt_slab_master
GROUP BY state_code
ORDER BY state_code;

-- ============================================================================
-- 2. Keep only one row per (state_code, income_from, income_to, pt_amount, frequency)
--    Use MIN(id) to keep the oldest/first row per unique slab combination
-- ============================================================================

-- Create temp set of IDs to KEEP (first occurrence of each unique slab)
CREATE TEMPORARY TABLE pt_slab_keep AS
SELECT MIN(id) AS keep_id
FROM pt_slab_master
GROUP BY state_code, income_from, COALESCE(income_to, -1), pt_amount, frequency, effective_from;

-- Delete everything NOT in the keep set
DELETE FROM pt_slab_master
WHERE id NOT IN (SELECT keep_id FROM pt_slab_keep);

DROP TEMPORARY TABLE IF EXISTS pt_slab_keep;

-- ============================================================================
-- 3. Verify counts after cleanup
-- ============================================================================

SELECT state_code, COUNT(*) AS remaining_slabs
FROM pt_slab_master
GROUP BY state_code
ORDER BY state_code;

-- ============================================================================
-- 4. Add UNIQUE constraint to prevent future duplicates
-- ============================================================================

-- Check if constraint already exists
SET @constraint_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pt_slab_master'
    AND CONSTRAINT_NAME = 'uq_pt_slab'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE pt_slab_master
   ADD CONSTRAINT uq_pt_slab
   UNIQUE (state_code, income_from, income_to, pt_amount, frequency)',
  'SELECT ''uq_pt_slab constraint already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 503_pt_slab_dedup.sql complete' AS status;
