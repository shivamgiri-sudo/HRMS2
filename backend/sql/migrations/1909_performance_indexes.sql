-- Migration 1909: Add missing performance indexes.
--
-- work_inbox_item (120k rows) had no index on entity_type+entity_id+is_actioned,
-- causing full table scans on every resolveItems() call (exit approval, ATS actions,
-- roster publish, etc.). Each call scanned all 120k rows before finding the 1-3 it needed.
--
-- Also adds covering indexes for the other common work_inbox_item query patterns
-- and a composite index on employee_biometric_enrollment for the cosec-sync bulk select.
--
-- All additive, information_schema-guarded, no data changes.

SET @db = DATABASE();

-- ─── work_inbox_item: entity resolution (resolveItems) ───────────────────────
-- Used by: inbox.service.ts resolveItems, exit approval, ATS transitions,
--          roster publish, bulk regularization approval, etc.
-- Query: WHERE entity_type = ? AND entity_id = ? AND is_actioned = 0
SET @ix1 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'work_inbox_item'
    AND INDEX_NAME = 'idx_inbox_entity_action');
SET @sql1 = IF(@ix1 = 0,
  'ALTER TABLE work_inbox_item ADD INDEX idx_inbox_entity_action (entity_type, entity_id, is_actioned)',
  'SELECT 1');
PREPARE s1 FROM @sql1; EXECUTE s1; DEALLOCATE PREPARE s1;

-- ─── work_inbox_item: user unactioned list (inbox list page) ─────────────────
-- Query: WHERE user_id = ? AND is_actioned = 0 [ORDER BY created_at DESC]
SET @ix2 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'work_inbox_item'
    AND INDEX_NAME = 'idx_inbox_user_action');
SET @sql2 = IF(@ix2 = 0,
  'ALTER TABLE work_inbox_item ADD INDEX idx_inbox_user_action (user_id, is_actioned, created_at)',
  'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

-- ─── work_inbox_item: dedup check before insert ──────────────────────────────
-- Query: WHERE user_id = ? AND type = ? AND entity_type = ? AND entity_id = ? AND is_actioned = 0
SET @ix3 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'work_inbox_item'
    AND INDEX_NAME = 'idx_inbox_dedup');
SET @sql3 = IF(@ix3 = 0,
  'ALTER TABLE work_inbox_item ADD INDEX idx_inbox_dedup (user_id, type, entity_type, entity_id, is_actioned)',
  'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ─── employee_biometric_enrollment: cosec-sync bulk select ───────────────────
-- Cosec sync fetches all active enrollments; currently scans the full table.
-- Query: WHERE is_active = 1 (used by cosec-sync service)
SET @ix4 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_biometric_enrollment'
    AND INDEX_NAME = 'idx_bio_active');
SET @sql4 = IF(@ix4 = 0,
  'ALTER TABLE employee_biometric_enrollment ADD INDEX idx_bio_active (is_active)',
  'SELECT 1');
PREPARE s4 FROM @sql4; EXECUTE s4; DEALLOCATE PREPARE s4;

-- ─── exit_request: status + employee composite ───────────────────────────────
-- The absconding worker queries: WHERE employment_status IN (...) AND active_status = 1
-- and the LWD-approaching cron: WHERE last_working_day_confirmed BETWEEN ... AND status = 'approved'
SET @ix5 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'exit_request'
    AND INDEX_NAME = 'idx_exit_status_lwd');
SET @sql5 = IF(@ix5 = 0,
  'ALTER TABLE exit_request ADD INDEX idx_exit_status_lwd (status, last_working_day_confirmed)',
  'SELECT 1');
PREPARE s5 FROM @sql5; EXECUTE s5; DEALLOCATE PREPARE s5;

-- ─── work_inbox_item: attendance missing-punch batch cleanup ─────────────────
-- The auto-resolve batch runs: UPDATE work_inbox_item SET is_actioned=1
-- WHERE type='attendance_missing_punch' AND is_actioned=0 AND action_url LIKE '%date=%' ...
-- Without (type, is_actioned), MySQL scans all 120k rows for every batch run.
SET @ix6 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'work_inbox_item'
    AND INDEX_NAME = 'idx_inbox_type_action');
SET @sql6 = IF(@ix6 = 0,
  'ALTER TABLE work_inbox_item ADD INDEX idx_inbox_type_action (type, is_actioned)',
  'SELECT 1');
PREPARE s6 FROM @sql6; EXECUTE s6; DEALLOCATE PREPARE s6;
