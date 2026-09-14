-- 1668_joining_control_room_queue_sort_indexes.sql
--
-- The Joining Control Room queue (/ats/joining-control-room) orders candidates by
-- "most recently touched", which listJoiningControlRoomQueue expresses as one arm per
-- source of that timestamp: candidate_onboarding_profile.updated_at, then
-- ats_payroll_hr_validation.updated_at, then jclr_detail.updated_at, then
-- ats_candidate.updated_at. Each arm is ORDER BY <its own updated_at> DESC LIMIT 50.
--
-- Two of those four columns have no index, so those arms cannot walk an index in order
-- and stop at 50 — MySQL must read every row, build a temporary table and filesort it:
--
--   candidate_onboarding_profile  32,871 rows, NO index on updated_at
--   ats_candidate                 38,374 rows, indexes exist on created_at
--                                 (idx_ats_candidate_created_status,
--                                 idx_ats_cand_active_created_at) but NOT on updated_at
--
-- Measured on live data 2026-09-03: the profile arm 1,081 ms and the candidate-stage arm
-- 3,289 ms, against 9 ms and 72 ms for the two arms whose tables are small. With these
-- indexes both become backward index scans that terminate after 50 matching rows.
--
-- The other two arms need nothing: ats_payroll_hr_validation holds 65 rows and
-- jclr_detail holds 0, so their sorts are already free.
--
-- Ordering on updated_at (rather than the previous COALESCE(updated_at, created_at)) is
-- what makes these indexes usable at all, and is safe because every one of these
-- updated_at columns is NOT NULL by schema — verified against information_schema on
-- 2026-09-03 — so the COALESCE could only ever have fallen through on a missing JOIN,
-- never on a NULL value.
--
-- Purely additive: two idempotent information_schema-guarded ADD INDEX statements.
-- No ALTER of any existing index, no DROP, no DELETE, no data modified.
--
-- Note on locking: ADD INDEX is an in-place, online operation for InnoDB (both tables
-- are InnoDB), so concurrent reads and writes continue. It still needs a brief exclusive
-- metadata lock to start and to finish, and a long-running transaction touching either
-- table will make it queue behind that transaction while itself blocking new statements —
-- the failure mode recorded for the employees table. Both tables here are far smaller and
-- far less contended than employees, but run it during a quiet window rather than mid
-- payroll, and check for open transactions first:
--   SELECT * FROM information_schema.INNODB_TRX WHERE trx_started < NOW() - INTERVAL 1 MINUTE;

SET @migration = '1668_joining_control_room_queue_sort_indexes.sql';

-- candidate_onboarding_profile.updated_at — the queue's first and highest-volume sort arm
SET @q = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE table_schema = DATABASE()
       AND table_name  = 'candidate_onboarding_profile'
       AND index_name  = 'idx_cand_onb_profile_updated_at') = 0,
  'ALTER TABLE candidate_onboarding_profile ADD INDEX idx_cand_onb_profile_updated_at (updated_at)',
  'SELECT ''idx_cand_onb_profile_updated_at already exists'' AS info'
);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ats_candidate.updated_at — the queue's stage-matched fallback arm
SET @q = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE table_schema = DATABASE()
       AND table_name  = 'ats_candidate'
       AND index_name  = 'idx_ats_candidate_updated_at') = 0,
  'ALTER TABLE ats_candidate ADD INDEX idx_ats_candidate_updated_at (updated_at)',
  'SELECT ''idx_ats_candidate_updated_at already exists'' AS info'
);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT CONCAT(@migration, ' applied') AS migration_status;
