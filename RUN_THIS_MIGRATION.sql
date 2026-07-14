-- ═══════════════════════════════════════════════════════════════════════════════
-- ATS FIX MIGRATION - RUN THIS ON PRODUCTION DATABASE
-- ═══════════════════════════════════════════════════════════════════════════════
-- Server: 122.184.128.90
-- Database: mas_hrms
-- User: root
--
-- HOW TO RUN:
-- Option 1 (SSH to server):
--   ssh masadmin@122.184.128.90
--   mysql -u root -p mas_hrms < /path/to/this/file.sql
--
-- Option 2 (MySQL Workbench / phpMyAdmin):
--   Copy and paste this entire file and execute
-- ═══════════════════════════════════════════════════════════════════════════════

USE mas_hrms;

SELECT '═══════════════════════════════════════════════════════' AS '';
SELECT 'STARTING ATS FIX MIGRATION' AS '';
SELECT CONCAT('Database: ', DATABASE()) AS '';
SELECT CONCAT('User: ', USER()) AS '';
SELECT CONCAT('Time: ', NOW()) AS '';
SELECT '═══════════════════════════════════════════════════════' AS '';
SELECT '' AS '';

-- ─── STEP 1: Check current state ──────────────────────────────────────────────

SELECT 'STEP 1: Pre-Migration Status Check' AS '';
SELECT '' AS '';

SELECT 'Candidates with NULL status (before fix):' AS check_name;
SELECT COUNT(*) as null_status_count
FROM ats_candidate
WHERE status IS NULL AND active_status = 1;
SELECT '' AS '';

SELECT 'Current status distribution (before fix):' AS check_name;
SELECT
  COALESCE(status, 'NULL') as status,
  COUNT(*) as count
FROM ats_candidate
WHERE active_status = 1
GROUP BY status
ORDER BY count DESC
LIMIT 10;
SELECT '' AS '';

-- ─── STEP 2: Backfill status column ───────────────────────────────────────────

SELECT 'STEP 2: Backfilling NULL status values' AS '';
SELECT '' AS '';

-- Priority 1: Use final_decision if it exists (from interview submission)
SELECT 'Backfilling from final_decision...' AS '';
UPDATE ats_candidate
SET status = final_decision
WHERE status IS NULL
  AND final_decision IS NOT NULL
  AND final_decision != '';

SELECT CONCAT('  ✓ Updated ', ROW_COUNT(), ' rows from final_decision') AS '';
SELECT '' AS '';

-- Priority 2: Map current_stage to a sensible status value for pending candidates
SELECT 'Backfilling from current_stage...' AS '';
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

SELECT CONCAT('  ✓ Updated ', ROW_COUNT(), ' rows from current_stage mapping') AS '';
SELECT '' AS '';

-- ─── STEP 3: Create index ─────────────────────────────────────────────────────

SELECT 'STEP 3: Creating performance index' AS '';
SELECT '' AS '';

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_candidate'
      AND INDEX_NAME = 'idx_ats_status') = 0,
  'ALTER TABLE ats_candidate ADD INDEX idx_ats_status (status)',
  'SELECT ''  ℹ Index idx_ats_status already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '  ✓ Index created/verified' AS '';
SELECT '' AS '';

-- ─── STEP 4: Verification ─────────────────────────────────────────────────────

SELECT 'STEP 4: Post-Migration Verification' AS '';
SELECT '' AS '';

SELECT 'Candidates with NULL status (after fix - should be 0):' AS check_name;
SELECT COUNT(*) as null_status_count
FROM ats_candidate
WHERE status IS NULL AND active_status = 1;
SELECT '' AS '';

SELECT 'Status distribution after fix:' AS check_name;
SELECT
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ats_candidate WHERE active_status = 1), 2) as percentage
FROM ats_candidate
WHERE active_status = 1
GROUP BY status
ORDER BY count DESC;
SELECT '' AS '';

SELECT 'Waiting candidates by recruiter:' AS check_name;
SELECT
  COALESCE(recruiter_assigned_name, 'Unassigned') as recruiter,
  COUNT(*) as waiting_count
FROM ats_candidate
WHERE active_status = 1
  AND (status = 'Waiting' OR (status IS NULL AND current_stage IN ('New', 'Applied', 'Screening', 'Registered')))
GROUP BY recruiter_assigned_name
ORDER BY waiting_count DESC
LIMIT 10;
SELECT '' AS '';

SELECT 'Index verification:' AS check_name;
SELECT
  INDEX_NAME,
  COLUMN_NAME,
  INDEX_TYPE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'ats_candidate'
  AND INDEX_NAME IN ('idx_ats_status', 'idx_ats_stage')
ORDER BY INDEX_NAME;
SELECT '' AS '';

-- ─── FINAL SUMMARY ────────────────────────────────────────────────────────────

SELECT '═══════════════════════════════════════════════════════' AS '';
SELECT 'MIGRATION COMPLETED SUCCESSFULLY ✓' AS '';
SELECT '═══════════════════════════════════════════════════════' AS '';
SELECT '' AS '';
SELECT 'Next steps:' AS '';
SELECT '1. Restart backend: pm2 restart mcn-hrms-backend' AS '';
SELECT '2. Test recruiter login: MAS62536 (Khushi@123)' AS '';
SELECT '3. Test recruiter login: MAS61042 (Mehar@2005)' AS '';
SELECT '4. Verify candidates appear at /ats/candidate-master' AS '';
SELECT '' AS '';
SELECT CONCAT('Migration completed at: ', NOW()) AS '';
SELECT '═══════════════════════════════════════════════════════' AS '';
