-- 218: Remove duplicate badges (same badge_name, keep canonical UUID rows over demo hard-coded IDs)
-- Root cause: 043_demo_data.sql inserted badges with hard-coded IDs (badge-star-001 etc.)
-- while 038_engagement_gamification.sql inserted the same badge_name with UUID() IDs.
-- The UNIQUE KEY on badge_name should prevent this, but ON DUPLICATE KEY UPDATE in 043
-- checks primary key (id), not badge_name, so duplicates slip in when column schema differs.

-- Step 1: Delete demo rows where a canonical (UUID-format) row exists with same name
DELETE d FROM gamification_badge_master d
INNER JOIN gamification_badge_master k
  ON k.badge_name = d.badge_name
  AND k.badge_id <> d.badge_id
WHERE d.badge_id LIKE 'badge-%';

-- Step 2: If somehow duplicates still exist with different UUIDs, keep the oldest
DELETE d FROM gamification_badge_master d
INNER JOIN (
  SELECT badge_name, MIN(created_at) AS earliest, MIN(badge_id) AS keep_id
  FROM gamification_badge_master
  GROUP BY badge_name
  HAVING COUNT(*) > 1
) dup ON dup.badge_name = d.badge_name
WHERE d.badge_id <> dup.keep_id AND d.created_at > dup.earliest;

-- Step 3: Ensure UNIQUE constraint on badge_name exists (idempotent)
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gamification_badge_master'
  AND INDEX_NAME = 'uq_badge_name');
SET @sql = IF(@idx = 0,
  'ALTER TABLE gamification_badge_master ADD UNIQUE KEY uq_badge_name (badge_name)',
  'SELECT ''uq_badge_name already exists'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
