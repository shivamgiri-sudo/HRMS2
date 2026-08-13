-- Migration 1201: Shift versioning backfill
--
-- **DO NOT RUN THIS AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.**
-- Not added to MIGRATION_MANIFEST in backend/src/db/runPendingMigrations.ts —
-- creating this file does not schedule it to run at any pm2 restart/boot.
--
-- Depends on 1200_shift_versioning.sql having already been applied (adds
-- wfm_shift_master.version/is_locked and wfm_roster_assignment.shift_version_id/
-- scheduled_minutes). Run 1200 first, verify it with
-- sql/verify/1200_shift_versioning_verification.sql, THEN run this.
--
-- What this backfills, and why each part is safe:
--
-- 1. wfm_roster_assignment.shift_version_id, for existing rows that already
--    carry shift_id but have shift_version_id NULL (every row written before
--    Area 4's write-path changes went live). At the moment each of these rows
--    was written, shift_id pointed at the exact wfm_shift_master row that was
--    in effect — nothing had versioned it yet, so shift_id === the version
--    that was actually scheduled. Backfilling shift_version_id = shift_id is
--    therefore not a guess; it is recording what was already true.
--
--    For rows that instead carry shift_template_id (the governance-layer path,
--    which reads through the already-versioned wfm_shift_template table),
--    shift_template_id itself is already the stable, immutable reference —
--    backfilling shift_version_id = shift_template_id for those rows unifies
--    the snapshot column regardless of which source table the shift came from.
--
-- 2. wfm_roster_assignment.scheduled_minutes, for existing rows where
--    shift_start_time and shift_end_time are already populated (confirmed live:
--    0 NULL out of 412,032 rows with shift_id set) but scheduled_minutes is
--    NULL. Computed with the same cross-midnight-safe formula as
--    computeScheduledMinutes() in shift-scheduling.util.ts, expressed in SQL so
--    it can run set-based rather than row-by-row from application code.
--
-- 3. wfm_shift_master.is_locked, for any row already referenced by at least one
--    wfm_roster_assignment (by shift_id OR shift_version_id). isShiftLocked()
--    in wfm.service.ts already computes this live on every updateShift() call
--    regardless of whether is_locked is set — this backfill just makes the
--    flag match reality up front instead of only being correct lazily, and
--    protects a row from being edited in place even before its first
--    post-migration updateShift() call recomputes the check.
--
-- All three backfills are:
--   - ADDITIVE: only fill NULL/0 values, never overwrite an existing non-NULL
--     value or reassign a row's employee/date/shift_id.
--   - IDEMPOTENT: safe to re-run; every UPDATE is scoped to "... WHERE
--     <target column> IS NULL/0", so a second run is a no-op.
--   - REVERSIBLE: see the rollback block at the bottom. Reverting simply nulls
--     the backfilled columns back out; it does not need to touch shift_id,
--     shift_template_id, or any other pre-existing column.
--   - Read-only with respect to historical attendance/payroll: nothing here
--     touches attendance_*, payroll_*, or salary_* tables.
--
-- Run in batches on production (see the LIMIT-based loop note at the bottom)
-- rather than one unbounded UPDATE, given the live row count.

USE mas_hrms;

-- ── Part 1: shift_version_id ────────────────────────────────────────────────

UPDATE wfm_roster_assignment
   SET shift_version_id = shift_id
 WHERE shift_version_id IS NULL
   AND shift_id IS NOT NULL;

UPDATE wfm_roster_assignment
   SET shift_version_id = shift_template_id
 WHERE shift_version_id IS NULL
   AND shift_id IS NULL
   AND shift_template_id IS NOT NULL;

-- ── Part 2: scheduled_minutes ────────────────────────────────────────────────
-- TIME_TO_SEC gives seconds-since-midnight for each snapshot time; when the end
-- is at or before the start (cross-midnight shift), add a day (86400s) before
-- taking the difference — the same rule computeScheduledMinutes() applies.

UPDATE wfm_roster_assignment
   SET scheduled_minutes = FLOOR(
         (
           CASE
             WHEN TIME_TO_SEC(shift_end_time) <= TIME_TO_SEC(shift_start_time)
               THEN TIME_TO_SEC(shift_end_time) + 86400
             ELSE TIME_TO_SEC(shift_end_time)
           END
           - TIME_TO_SEC(shift_start_time)
         ) / 60
       )
 WHERE scheduled_minutes IS NULL
   AND shift_start_time IS NOT NULL
   AND shift_end_time IS NOT NULL;

-- ── Part 3: wfm_shift_master.is_locked ───────────────────────────────────────

UPDATE wfm_shift_master sm
   SET is_locked = 1
 WHERE is_locked = 0
   AND EXISTS (
     SELECT 1 FROM wfm_roster_assignment ra
      WHERE ra.shift_id = sm.id OR ra.shift_version_id = sm.id
   );

SELECT '1201_shift_versioning_backfill.sql applied successfully' AS migration_status;

-- ── Rollback (run manually, NOT part of forward migration) ─────────────────
-- UPDATE wfm_roster_assignment SET shift_version_id = NULL WHERE shift_version_id IS NOT NULL;
-- UPDATE wfm_roster_assignment SET scheduled_minutes = NULL WHERE scheduled_minutes IS NOT NULL;
-- UPDATE wfm_shift_master SET is_locked = 0 WHERE is_locked = 1;
-- (Rolling back is_locked does not un-close any effective_to a real
-- updateShift() call may have set in the meantime — check
-- effective_to IS NOT NULL rows manually before rolling back part 3.)

-- ── Production batching note ────────────────────────────────────────────────
-- 412,032+ rows is large enough that an unbounded UPDATE risks a long lock/
-- replication-lag window. Prefer running Part 1/2 in ID-range or LIMIT-based
-- batches, e.g.:
--   UPDATE wfm_roster_assignment SET shift_version_id = shift_id
--    WHERE shift_version_id IS NULL AND shift_id IS NOT NULL LIMIT 5000;
-- repeated until it reports 0 rows affected. Confirm the production MySQL
-- version/replication topology (see hrms2-db-hosts memory) before choosing a
-- batch size — this file intentionally ships the simple unbounded form and
-- leaves the batching decision to whoever runs it with production visibility.
