# Task 1: Add ATS Performance Indexes (Migration 519)

## Context
You are implementing Task 1 of 5 in the ATS Command Center performance fix for MAS PeopleOS HRMS at `c:\Users\ADMIN\Desktop\HRMS2-latest`.

The `/ats/command-center` page times out after 30 seconds. The root cause includes missing covering indexes on `ats_candidate`, `ats_candidate_assessment`, `ats_typing_test_attempt`, and `ats_queue_token`.

Current highest migration: `518_dpdp_feature_flags.sql`. Next: `519`.

## Your job: Create TWO files

### File 1: `backend/sql/519_ats_performance_indexes.sql`

Use MySQL-safe INFORMATION_SCHEMA guards (no `ADD INDEX IF NOT EXISTS` — not supported on MySQL 5.7):

```sql
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
```

### File 2: Modify `backend/src/db/runPendingMigrations.ts`

Read the file first to find where migration filenames are listed. Add `"519_ats_performance_indexes.sql"` to the array in the correct sequential position (after `518_dpdp_feature_flags.sql`).

## Global Constraints
- Use INFORMATION_SCHEMA pattern (not `ADD INDEX IF NOT EXISTS`)
- Do NOT use `ALTER TABLE ... ADD INDEX IF NOT EXISTS` — MySQL 5.7 doesn't support it
- Each index must have a distinct name
- Must add to runPendingMigrations.ts manifest

## Steps
1. Create `backend/sql/519_ats_performance_indexes.sql` with the SQL above
2. Read `backend/src/db/runPendingMigrations.ts` fully, find the migration list array, add `"519_ats_performance_indexes.sql"` after `518_dpdp_feature_flags.sql`
3. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit` — 0 errors
4. Commit: `git add backend/sql/519_ats_performance_indexes.sql backend/src/db/runPendingMigrations.ts && git commit -m "perf(ats): add covering indexes for command center hot query paths"`

## Report file
`c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ats-perf-task-1-report.md`

Return: status, commit hash, TypeScript result, concerns.
