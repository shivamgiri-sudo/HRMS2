-- Performance indexes for ats_recruiter_hiring_activity hot query paths
-- Uses PREPARE/EXECUTE pattern for safe re-runs (avoids ER_DUP_KEYNAME on re-apply)

SET @db = DATABASE();

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = @db AND table_name = 'ats_recruiter_hiring_activity' AND index_name = 'idx_mobile') = 0,
  'ALTER TABLE `ats_recruiter_hiring_activity` ADD INDEX `idx_mobile` (`mobile`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = @db AND table_name = 'ats_recruiter_hiring_activity' AND index_name = 'idx_date_created') = 0,
  'ALTER TABLE `ats_recruiter_hiring_activity` ADD INDEX `idx_date_created` (`activity_date`, `created_at`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = @db AND table_name = 'employees' AND index_name = 'idx_emp_mobile') = 0,
  'ALTER TABLE `employees` ADD INDEX `idx_emp_mobile` (`mobile`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = @db AND table_name = 'ats_candidate' AND index_name = 'idx_cand_mobile') = 0,
  'ALTER TABLE `ats_candidate` ADD INDEX `idx_cand_mobile` (`mobile`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
