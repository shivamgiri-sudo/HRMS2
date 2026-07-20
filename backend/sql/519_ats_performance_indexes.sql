-- 519: ATS Command Center performance indexes
-- MySQL-safe idempotent pattern using INFORMATION_SCHEMA guards

SET @db = DATABASE();

-- ats_candidate: (active_status, created_date) — hot filter for webData()
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_candidate' AND INDEX_NAME='idx_ats_cand_active_created');
SET @s = IF(@n=0, 'ALTER TABLE ats_candidate ADD INDEX idx_ats_cand_active_created (active_status, created_date)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_candidate: (active_status, current_stage) — for getDashboardMetrics COUNTs
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_candidate' AND INDEX_NAME='idx_ats_cand_active_stage');
SET @s = IF(@n=0, 'ALTER TABLE ats_candidate ADD INDEX idx_ats_cand_active_stage (active_status, current_stage)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_candidate: (active_status, created_at) — fallback sort index
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_candidate' AND INDEX_NAME='idx_ats_cand_active_created_at');
SET @s = IF(@n=0, 'ALTER TABLE ats_candidate ADD INDEX idx_ats_cand_active_created_at (active_status, created_at)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_candidate_assessment: (candidate_id) — speeds up scores subquery in queue endpoints
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_candidate_assessment' AND INDEX_NAME='idx_ats_asmt_candidate_id');
SET @s = IF(@n=0, 'ALTER TABLE ats_candidate_assessment ADD INDEX idx_ats_asmt_candidate_id (candidate_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_typing_test_attempt: (assessment_id) — speeds up JOIN in scores subquery
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_typing_test_attempt' AND INDEX_NAME='idx_ats_typing_asmt_id');
SET @s = IF(@n=0, 'ALTER TABLE ats_typing_test_attempt ADD INDEX idx_ats_typing_asmt_id (assessment_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_queue_token: (queue_status, arrival_time) — for position_in_queue subquery
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_queue_token' AND INDEX_NAME='idx_ats_qt_status_arrival');
SET @s = IF(@n=0, 'ALTER TABLE ats_queue_token ADD INDEX idx_ats_qt_status_arrival (queue_status, arrival_time)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_queue_token: (candidate_id, queue_status) — for candidate-scoped queue lookups
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_queue_token' AND INDEX_NAME='idx_ats_qt_candidate_status');
SET @s = IF(@n=0, 'ALTER TABLE ats_queue_token ADD INDEX idx_ats_qt_candidate_status (candidate_id, queue_status)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
