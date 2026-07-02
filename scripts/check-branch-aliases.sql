-- Script to check all branches and their aliases
-- Run this with: mysql -h YOUR_HOST -u YOUR_USER -p mas_hrms < scripts/check-branch-aliases.sql

USE mas_hrms;

-- ================================================================
-- SECTION 1: All Active Branches from branch_master
-- ================================================================
SELECT '=== ACTIVE BRANCHES FROM BRANCH_MASTER ===' AS '';

SELECT
  branch_name AS 'Official Branch Name',
  branch_code AS 'Code',
  active_status AS 'Active'
FROM branch_master
WHERE active_status = 1
ORDER BY branch_name;

-- ================================================================
-- SECTION 2: All Branch Aliases (Active and Inactive)
-- ================================================================
SELECT '' AS '';
SELECT '=== BRANCH ALIASES IN ats_branch_alias_master ===' AS '';

SELECT
  canonical_key AS 'Official Name (stored in DB)',
  display_name AS 'Candidate Sees (in form)',
  alias_text AS 'Search Keywords',
  CASE WHEN active_status = 1 THEN '✓ Active' ELSE '✗ Inactive' END AS 'Status',
  created_at AS 'Created'
FROM ats_branch_alias_master
ORDER BY active_status DESC, display_name;

-- ================================================================
-- SECTION 3: Mismatches (aliases pointing to non-existent branches)
-- ================================================================
SELECT '' AS '';
SELECT '=== ALIASES WITH NO MATCHING BRANCH (ERRORS) ===' AS '';

SELECT
  a.canonical_key AS 'Alias Points To',
  a.display_name AS 'Display Name',
  'NOT FOUND IN branch_master!' AS 'Issue'
FROM ats_branch_alias_master a
WHERE a.active_status = 1
  AND NOT EXISTS (
    SELECT 1
    FROM branch_master b
    WHERE b.branch_name = a.canonical_key
      AND b.active_status = 1
  );

-- ================================================================
-- SECTION 4: Branches WITHOUT Aliases
-- ================================================================
SELECT '' AS '';
SELECT '=== BRANCHES WITHOUT DISPLAY ALIASES ===' AS '';

SELECT
  b.branch_name AS 'Official Branch Name',
  'No alias configured - will show as-is to candidates' AS 'Note'
FROM branch_master b
WHERE b.active_status = 1
  AND NOT EXISTS (
    SELECT 1
    FROM ats_branch_alias_master a
    WHERE a.canonical_key = b.branch_name
      AND a.active_status = 1
  )
ORDER BY b.branch_name;
