-- 1919_ats_dashboard_indexes.sql
-- Indexes for the ATS dashboards (aggregates and drill-downs over ats_candidate).
-- idx_ats_candidate_dash is a covering index for the day x branch x status x stage aggregate INCLUDING the
-- reporting-scope columns (record_type, candidate_code), so the query is index-only. Without it the aggregate
-- reads every wide ats_candidate row (15-30s on ~39k rows). Key length 3046 of 3072 bytes (utf8mb4).
-- MySQL 8 has no CREATE INDEX IF NOT EXISTS, so each index is created only when missing. Additive, online DDL.

SET @ix := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'ats_candidate' AND index_name = 'idx_ats_candidate_dash');
SET @sql := IF(@ix = 0, 'CREATE INDEX idx_ats_candidate_dash ON ats_candidate(active_status, record_type, created_at, status, current_stage, branch_display_name, applied_for_branch, candidate_code)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ix := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'ats_candidate' AND index_name = 'idx_ats_candidate_recruiter_created');
SET @sql := IF(@ix = 0, 'CREATE INDEX idx_ats_candidate_recruiter_created ON ats_candidate(recruiter_name(64), created_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ix := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'ats_candidate' AND index_name = 'idx_ats_candidate_channel_created');
SET @sql := IF(@ix = 0, 'CREATE INDEX idx_ats_candidate_channel_created ON ats_candidate(sourcing_channel, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ix := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'ats_queue_token' AND index_name = 'idx_ats_queue_token_arrival');
SET @sql := IF(@ix = 0, 'CREATE INDEX idx_ats_queue_token_arrival ON ats_queue_token(arrival_time, status)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
