-- Setup Friendly Branch Names for Candidate Registration
-- This replaces technical names with user-friendly display names
-- Run with: mysql -h HOST -u USER -p mas_hrms < scripts/setup-friendly-branch-names.sql

USE mas_hrms;

-- ========================================
-- STEP 1: Clean up incorrect OKAYA aliases
-- ========================================
DELETE FROM ats_branch_alias_master
WHERE canonical_key = 'OKAYA'
  AND NOT EXISTS (
    SELECT 1 FROM branch_master
    WHERE branch_name = 'OKAYA' AND active_status = 1
  );

-- ========================================
-- STEP 2: Clean up old inactive aliases
-- ========================================
DELETE FROM ats_branch_alias_master
WHERE canonical_key NOT IN (
  SELECT branch_name FROM branch_master WHERE active_status = 1
);

-- ========================================
-- STEP 3: Update to friendly display names
-- ========================================

-- Ahmedabad Branches
UPDATE ats_branch_alias_master
SET display_name = 'Jaldarshan - Ahmedabad',
    alias_text = 'Ahmedabad Jaldarshan Gujarat'
WHERE canonical_key = 'AHMEDABAD-JALDARSHAN';

UPDATE ats_branch_alias_master
SET display_name = 'Neelakanth - Ahmedabad',
    alias_text = 'Ahmedabad Neelakanth Gujarat'
WHERE canonical_key = 'AHMEDABAD-NEELAKANTH';

-- Delhi Branch
UPDATE ats_branch_alias_master
SET display_name = 'Delhi Office',
    alias_text = 'Delhi NCR Capital'
WHERE canonical_key = 'DELHI';

-- Genleap
UPDATE ats_branch_alias_master
SET display_name = 'Genleap',
    alias_text = 'Genleap Center'
WHERE canonical_key = 'GENLEAP';

-- Head Office (keep as is, but fix duplicate)
UPDATE ats_branch_alias_master
SET display_name = 'Head Office',
    alias_text = 'HQ Headquarters Corporate'
WHERE canonical_key = 'HEAD OFFICE';

-- Fix the duplicate "Head Office" entry
DELETE FROM ats_branch_alias_master
WHERE canonical_key = 'Head Office'
  AND id NOT IN (
    SELECT * FROM (
      SELECT MIN(id) FROM ats_branch_alias_master
      WHERE canonical_key = 'Head Office'
    ) temp
  );

UPDATE ats_branch_alias_master
SET canonical_key = 'HEAD OFFICE',
    display_name = 'Head Office',
    alias_text = 'HQ Headquarters Corporate'
WHERE canonical_key = 'Head Office';

-- Noida Branches
UPDATE ats_branch_alias_master
SET display_name = 'Noida',
    alias_text = 'Noida UP'
WHERE canonical_key = 'NOIDA';

UPDATE ats_branch_alias_master
SET display_name = 'ISpark 2 - Noida',
    alias_text = 'Noida ISpark-2'
WHERE canonical_key = 'NOIDA ISPARK-2';

UPDATE ats_branch_alias_master
SET display_name = 'Noida 2',
    alias_text = 'Noida Second Office'
WHERE canonical_key = 'NOIDA-2';

UPDATE ats_branch_alias_master
SET display_name = 'Dialdesk - Noida',
    alias_text = 'Noida Dialdesk'
WHERE canonical_key = 'NOIDA-DIALDESK';

-- ========================================
-- STEP 4: Show final result
-- ========================================
SELECT
  canonical_key AS 'Database Stores',
  display_name AS 'Candidates See',
  alias_text AS 'Search Keywords',
  active_status AS 'Active'
FROM ats_branch_alias_master
WHERE active_status = 1
ORDER BY display_name;

SELECT CONCAT('✅ Setup complete! Candidates will now see friendly branch names.') AS '';
