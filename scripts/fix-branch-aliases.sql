-- Script to fix incorrect branch aliases
-- This will:
-- 1. Delete example aliases that don't match your real branches
-- 2. Create simple aliases that just show the branch name as-is

USE mas_hrms;

-- ================================================================
-- STEP 1: Remove example aliases (they were just templates)
-- ================================================================
DELETE FROM ats_branch_alias_master
WHERE canonical_key IN (
  'Mumbai - Trapezoid',
  'Delhi - Okaya',
  'Bangalore - Corporate Office'
);

-- ================================================================
-- STEP 2: Create 1:1 aliases for all active branches
-- This makes all branches show their exact name (no fancy aliases yet)
-- ================================================================
INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
SELECT
  UUID(),
  b.branch_name,
  b.branch_name,  -- Display same as canonical for now
  b.branch_name,
  b.active_status
FROM branch_master b
WHERE b.active_status = 1
  AND NOT EXISTS (
    SELECT 1
    FROM ats_branch_alias_master a
    WHERE a.canonical_key = b.branch_name
  )
ON DUPLICATE KEY UPDATE
  canonical_key = VALUES(canonical_key),
  active_status = VALUES(active_status);

-- ================================================================
-- STEP 3: Show results
-- ================================================================
SELECT
  canonical_key AS 'Official Name',
  display_name AS 'Candidates Will See',
  active_status AS 'Active'
FROM ats_branch_alias_master
WHERE active_status = 1
ORDER BY display_name;

-- ================================================================
-- STEP 4: To customize display names, run SQL like this:
-- ================================================================
-- UPDATE ats_branch_alias_master
-- SET display_name = 'Your Friendly Name Here',
--     alias_text = 'search keywords'
-- WHERE canonical_key = 'Your Official Branch Name';

-- Example:
-- UPDATE ats_branch_alias_master
-- SET display_name = 'Mumbai Office',
--     alias_text = 'Mumbai Maharashtra'
-- WHERE canonical_key = 'Mumbai - Main Branch - Tower A';
