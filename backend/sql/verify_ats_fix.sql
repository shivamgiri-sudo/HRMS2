-- ═══════════════════════════════════════════════════════════════════════════════
-- ATS Fix Verification Script
-- Run this AFTER deploying 999_ats_backfill_status_column.sql
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '═══════════════════════════════════════════════════════' AS '';
SELECT 'ATS FIX VERIFICATION REPORT' AS '';
SELECT '═══════════════════════════════════════════════════════' AS '';
SELECT '' AS '';

-- Check 1: NULL status count (should be 0)
SELECT '1. NULL Status Check (should be 0):' AS check_name;
SELECT COUNT(*) as null_status_count
FROM ats_candidate
WHERE status IS NULL AND active_status = 1;
SELECT '' AS '';

-- Check 2: Status distribution
SELECT '2. Status Distribution:' AS check_name;
SELECT
  COALESCE(status, 'NULL') as status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ats_candidate WHERE active_status = 1), 2) as percentage
FROM ats_candidate
WHERE active_status = 1
GROUP BY status
ORDER BY count DESC;
SELECT '' AS '';

-- Check 3: Waiting candidates by recruiter
SELECT '3. Waiting Candidates by Recruiter:' AS check_name;
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

-- Check 4: Sourcing channel distribution
SELECT '4. Sourcing Channel Distribution:' AS check_name;
SELECT
  COALESCE(sourcing_channel, 'NULL') as channel,
  COUNT(*) as count
FROM ats_candidate
WHERE active_status = 1
GROUP BY sourcing_channel
ORDER BY count DESC;
SELECT '' AS '';

-- Check 5: Index verification
SELECT '5. Index Verification:' AS check_name;
SELECT
  INDEX_NAME,
  COLUMN_NAME,
  SEQ_IN_INDEX,
  INDEX_TYPE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'ats_candidate'
  AND INDEX_NAME IN ('idx_ats_status', 'idx_ats_stage', 'idx_ats_mobile')
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
SELECT '' AS '';

-- Check 6: Recent candidate registrations (last 7 days)
SELECT '6. Recent Registrations (last 7 days):' AS check_name;
SELECT
  DATE(created_at) as registration_date,
  COUNT(*) as count,
  GROUP_CONCAT(DISTINCT status ORDER BY status) as statuses
FROM ats_candidate
WHERE active_status = 1
  AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
GROUP BY DATE(created_at)
ORDER BY registration_date DESC;
SELECT '' AS '';

-- Check 7: Candidates with mismatched status/current_stage (should review)
SELECT '7. Status/Stage Mismatch Check:' AS check_name;
SELECT
  id,
  candidate_code,
  full_name,
  current_stage,
  status,
  final_decision
FROM ats_candidate
WHERE active_status = 1
  AND (
    (current_stage = 'Selected' AND status != 'Selected')
    OR (current_stage = 'Rejected' AND status != 'Rejected')
    OR (current_stage IN ('New', 'Applied', 'Registered') AND status NOT IN ('Waiting', 'In Interview', 'Selected', 'Rejected'))
  )
LIMIT 10;
SELECT '' AS '';

SELECT '═══════════════════════════════════════════════════════' AS '';
SELECT 'END OF VERIFICATION REPORT' AS '';
SELECT '═══════════════════════════════════════════════════════' AS '';
