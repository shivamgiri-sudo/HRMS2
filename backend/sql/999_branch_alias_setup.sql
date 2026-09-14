-- ============================================================================
-- Branch Alias Setup for ATS Candidate Registration
-- ============================================================================
-- Purpose: Configure branch display aliases and deactivate unused branches
--
-- Requirements:
--   1. Noida 2 → display "Okaya" to candidates, submit "Noida 2" to DB
--   2. Noida   → display "Trapezoid" to candidates, submit "Noida" to DB
--   3. AHM     → display "Jaldarshan" to candidates, submit "AHM" to DB
--   4. All other branches → inactive (hidden from candidate registration)
--   5. Recruiter dropdown → filtered by actual branch name (Noida 2, Noida, AHM)
-- ============================================================================

-- Step 1: Deactivate ALL branches first
UPDATE branch_master
SET active_status = 0
WHERE active_status = 1;

-- Step 2: Reactivate ONLY the 3 required branches
UPDATE branch_master
SET active_status = 1
WHERE branch_name IN ('NOIDA-2', 'NOIDA', 'AHMEDABAD-JALDARSHAN');

-- Step 3: Clear existing branch aliases
DELETE FROM ats_branch_alias_master;

-- Step 4: Insert the 3 branch aliases
INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
VALUES
  (UUID(), 'NOIDA-2',                 'Okaya',       'Okaya',       1),
  (UUID(), 'NOIDA',                   'Trapezoid',   'Trapezoid',   1),
  (UUID(), 'AHMEDABAD-JALDARSHAN',    'Jaldarshan',  'Jaldarshan',  1)
ON DUPLICATE KEY UPDATE
  display_name   = VALUES(display_name),
  alias_text     = VALUES(alias_text),
  active_status  = VALUES(active_status);

-- Step 5: Verify setup
SELECT
  'Active Branches' AS check_type,
  branch_name,
  branch_code,
  active_status
FROM branch_master
WHERE active_status = 1

UNION ALL

SELECT
  'Branch Aliases' AS check_type,
  CONCAT(canonical_key, ' → ', display_name) AS branch_name,
  alias_text AS branch_code,
  active_status
FROM ats_branch_alias_master
WHERE active_status = 1;

-- ============================================================================
-- Post-Migration Notes:
-- ============================================================================
-- 1. Frontend will show: "Okaya", "Trapezoid", "Jaldarshan" in dropdown
-- 2. Backend will receive display name, resolve to: "Noida 2", "Noida", "AHM"
-- 3. Recruiter dropdown filters by actual branch (Noida 2, Noida, AHM)
-- 4. All other branches are hidden from candidate registration
-- ============================================================================
