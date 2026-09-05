-- 1673_upload_batch_job_heartbeat.sql
--
-- WHY
-- ---
-- A running import or approval is tracked in `jobMap` / `jobs` — plain in-process JavaScript
-- Maps in bulk-approval-async.ts and batch-job.ts — while the batch is marked 'importing' or
-- 'approving' IN THE DATABASE. The durable half says "working"; the half that would finish it
-- lives in one Node process's memory. A deploy, a pm2 restart or an OOM erases the Map and the
-- batch is orphaned. Even the fire-and-forget `.catch()` cannot help: it writes
-- `job.status = "failed"` to an object nobody will ever read again.
--
-- Measured on production 2026-09-05: BATCH-1788604867017 was created at 16:11:20, last touched
-- at 16:11:42, and was still 'importing' two and a half hours later with 1,246 of its 3,765 rows
-- never processed. Nothing retried it, nothing failed it, nobody was told. It was found by hand.
--
-- WHAT THIS ADDS
-- --------------
-- Two nullable columns that let a running job PROVE it is alive, so a dead one can be told apart
-- from a slow one:
--
--   job_heartbeat_at  the job stamps this every few seconds while it works. Stale means dead.
--   job_owner         which process held it, for diagnosis after the fact.
--
-- Without a heartbeat the only available signal is `updated_at`, which moves only as rows are
-- processed. That cannot distinguish "the process died" from "this row is taking a while", so
-- the stale-batch reaper has to wait a generously long time (30 minutes) before declaring death.
-- With a heartbeat the same judgement is safe in a couple of minutes, because a living job says
-- so continuously rather than only when it finishes a row.
--
-- Deliberately NOT used to auto-resume. An import that died for an unknown reason should not
-- restart itself in a loop unattended, and an approval batch moves people's pay. Faster, more
-- accurate DETECTION is the goal; resuming stays a decision.
--
-- PURELY ADDITIVE
-- ---------------
-- Two nullable columns and one index. No existing column is altered or dropped and no existing
-- row is touched — every current batch keeps job_heartbeat_at NULL, which the reaper reads as
-- "no heartbeat recorded, fall back to updated_at", exactly the behaviour it has today.
--
-- Guarded on information_schema so a second run is a no-op, not an error.
--
-- ROLLBACK
-- --------
--   DROP INDEX idx_upload_batch_job_heartbeat ON upload_batch;
--   ALTER TABLE upload_batch DROP COLUMN job_heartbeat_at, DROP COLUMN job_owner;

USE mas_hrms;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'upload_batch'
              AND COLUMN_NAME = 'job_heartbeat_at');
SET @s := IF(@c = 0,
  'ALTER TABLE upload_batch
     ADD COLUMN job_heartbeat_at DATETIME NULL AFTER batch_status',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'upload_batch'
              AND COLUMN_NAME = 'job_owner');
SET @s := IF(@c = 0,
  'ALTER TABLE upload_batch
     ADD COLUMN job_owner VARCHAR(100) NULL AFTER job_heartbeat_at',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- The reaper scans (batch_status, job_heartbeat_at) to find batches whose job stopped proving
-- itself alive. Without the index that is a full scan of upload_batch every sweep.
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'upload_batch'
              AND INDEX_NAME = 'idx_upload_batch_job_heartbeat');
SET @s := IF(@c = 0,
  'CREATE INDEX idx_upload_batch_job_heartbeat
     ON upload_batch (batch_status, job_heartbeat_at)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
