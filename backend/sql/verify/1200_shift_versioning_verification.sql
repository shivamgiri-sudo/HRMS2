-- Read-only verification queries for migration 1200_shift_versioning.sql and
-- backfill 1201_shift_versioning_backfill.sql.
--
-- Every statement in this file is a SELECT. Nothing here writes. Safe to run
-- against production at any time — before either migration (to size the work),
-- after 1200 (to confirm the schema landed as expected before backfilling),
-- and after 1201 (to confirm the backfill actually converged).

USE mas_hrms;

-- ── Before 1200: confirm the shape this migration expects ──────────────────

-- Expect exactly one UNIQUE index named `shift_code` (the one 1200 replaces).
SHOW INDEX FROM wfm_shift_master WHERE Key_name = 'shift_code';

-- Expect zero rows: confirms wfm_roster_assignment doesn't already have these
-- columns under a different migration.
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment'
   AND COLUMN_NAME IN ('shift_version_id', 'scheduled_minutes');

-- ── After 1200, before 1201: size the backfill ──────────────────────────────

-- How many wfm_roster_assignment rows will Part 1 (shift_version_id) touch.
SELECT
  COUNT(*) AS total_rows,
  SUM(shift_id IS NOT NULL AND shift_version_id IS NULL) AS backfillable_via_shift_id,
  SUM(shift_id IS NULL AND shift_template_id IS NOT NULL AND shift_version_id IS NULL) AS backfillable_via_shift_template_id,
  SUM(shift_id IS NULL AND shift_template_id IS NULL) AS neither_reference_present
FROM wfm_roster_assignment;

-- How many rows will Part 2 (scheduled_minutes) touch, and how many can't be
-- (missing one or both snapshot times — these need investigation, not backfill).
SELECT
  SUM(scheduled_minutes IS NULL AND shift_start_time IS NOT NULL AND shift_end_time IS NOT NULL) AS backfillable,
  SUM(scheduled_minutes IS NULL AND (shift_start_time IS NULL OR shift_end_time IS NULL)) AS unbackfillable_missing_snapshot_time
FROM wfm_roster_assignment;

-- How many wfm_shift_master rows Part 3 will lock, and which ones (small table
-- — 3 rows as of this program's recon — safe to list in full).
SELECT sm.id, sm.shift_code, sm.shift_name, sm.is_locked AS currently_locked,
       (SELECT COUNT(*) FROM wfm_roster_assignment ra
         WHERE ra.shift_id = sm.id OR ra.shift_version_id = sm.id) AS referencing_assignment_rows
  FROM wfm_shift_master sm;

-- ── After 1201: confirm convergence ─────────────────────────────────────────

-- Expect all zero. Any non-zero count here means the backfill did not fully
-- converge (e.g. it was interrupted mid-batch) and should be re-run — it's
-- idempotent, so re-running is always safe.
SELECT
  SUM(shift_id IS NOT NULL AND shift_version_id IS NULL) AS still_missing_shift_version_id_via_shift_id,
  SUM(shift_id IS NULL AND shift_template_id IS NOT NULL AND shift_version_id IS NULL) AS still_missing_shift_version_id_via_template,
  SUM(scheduled_minutes IS NULL AND shift_start_time IS NOT NULL AND shift_end_time IS NOT NULL) AS still_missing_scheduled_minutes
FROM wfm_roster_assignment;

-- Sanity spot-check: scheduled_minutes should never be negative or absurd
-- (over 24h for a single shift would indicate a snapshot-time data problem,
-- not a computation bug — cross-midnight is already handled and caps at 1439).
SELECT COUNT(*) AS suspicious_scheduled_minutes
  FROM wfm_roster_assignment
 WHERE scheduled_minutes IS NOT NULL
   AND (scheduled_minutes < 0 OR scheduled_minutes > 1439);

-- Confirms Part 3 is fully converged: expect zero rows (every referenced shift
-- master row should now be locked).
SELECT sm.id, sm.shift_code
  FROM wfm_shift_master sm
 WHERE sm.is_locked = 0
   AND EXISTS (
     SELECT 1 FROM wfm_roster_assignment ra
      WHERE ra.shift_id = sm.id OR ra.shift_version_id = sm.id
   );

-- ── Ongoing health check (safe to re-run any time, not just post-migration) ─

-- New rows going forward should be arriving with the snapshot fields already
-- populated by the application-code write paths (Area 4c) — this catches a
-- write path that silently regressed and stopped setting them.
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS rows_created,
  SUM(shift_id IS NOT NULL AND shift_version_id IS NULL) AS missing_shift_version_id,
  SUM(shift_start_time IS NOT NULL AND shift_end_time IS NOT NULL AND scheduled_minutes IS NULL) AS missing_scheduled_minutes
FROM wfm_roster_assignment
WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
GROUP BY DATE(created_at)
ORDER BY day DESC;
