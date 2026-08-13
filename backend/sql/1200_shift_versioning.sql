-- Migration 1200: Shift versioning
--
-- Part of the roster enterprise-controls program (shift versioning, minimum rest,
-- week-off policy, roster lifecycle lock) commissioned 2026-08-13.
--
-- ADDITIVE ONLY. Do not execute on production without explicit approval.
-- All ADD COLUMN IF NOT EXISTS; every new column is nullable or has a safe
-- default. No existing row is modified by this file — a separate, explicitly-run
-- backfill script (see backend/scripts/shift-versioning-backfill.ts, not executed
-- as part of applying this migration) populates the new columns for pre-existing
-- data. This file only changes schema.
--
-- ROLLBACK:
--   ALTER TABLE wfm_shift_master
--     DROP COLUMN IF EXISTS parent_shift_id,
--     DROP COLUMN IF EXISTS version,
--     DROP COLUMN IF EXISTS effective_from,
--     DROP COLUMN IF EXISTS effective_to,
--     DROP COLUMN IF EXISTS is_locked,
--     DROP COLUMN IF EXISTS created_by,
--     DROP COLUMN IF EXISTS approved_by;
--   ALTER TABLE wfm_roster_assignment
--     DROP COLUMN IF EXISTS shift_version_id,
--     DROP COLUMN IF EXISTS scheduled_minutes;

USE mas_hrms;

-- ─── 1. wfm_shift_master: bring it up to the same versioning model  ───────────
-- wfm_shift_template already has this (version/effective_from/effective_to,
-- 020_roster_governance.sql) and no UPDATE route has ever existed for it — the
-- only way to "edit" a template is to insert a new version row, so historical
-- foreign-key references are untouched by construction.
--
-- wfm_shift_master (005_attendance_wfm.sql) never had that: wfm.service.ts's
-- updateShift() does a direct in-place `UPDATE wfm_shift_master SET start_time=?,
-- end_time=? ... WHERE id=?`. attendance-engine.service.ts's late-mark calculation
-- was fixed (2026-08-13) to prefer the roster assignment's own time snapshot over
-- this table, but the underlying mutability remained — any other future reader
-- that joins straight to wfm_shift_master for a historical date would still see
-- today's edited value, not what was actually scheduled. This adds the columns
-- needed to close that at the source: the service layer (separate change) stops
-- updating in place and starts creating a new, immutable version row instead,
-- exactly mirroring wfm_shift_template.
ALTER TABLE wfm_shift_master
  ADD COLUMN IF NOT EXISTS parent_shift_id CHAR(36)    NULL COMMENT 'Self-reference to the first version in this shift_code lineage. NULL means this row IS the root of its own lineage.' AFTER shift_code,
  ADD COLUMN IF NOT EXISTS version         INT         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS effective_from  DATE        NULL,
  ADD COLUMN IF NOT EXISTS effective_to    DATE        NULL,
  ADD COLUMN IF NOT EXISTS is_locked       TINYINT(1)  NOT NULL DEFAULT 0 COMMENT 'Set true the first time this specific row is referenced by a published roster assignment, an attendance calculation, or a payroll run. A locked row can never be UPDATEd again by application code — an edit request must create a new version row instead. Enforced in wfm.service.ts, not a DB trigger.',
  ADD COLUMN IF NOT EXISTS created_by      CHAR(36)    NULL,
  ADD COLUMN IF NOT EXISTS approved_by     CHAR(36)    NULL;

-- shift_code currently carries a lone UNIQUE index (one row per code, full stop) —
-- the exact constraint that makes versioning impossible: a second version of the
-- same shift_code cannot be inserted while the first exists. wfm_shift_template
-- already uses the correct shape for this (UNIQUE(shift_code, version),
-- 020_roster_governance.sql). Guarded by an information_schema existence check
-- (rather than DROP INDEX IF EXISTS, which older MySQL rejects) so this file is
-- safe to re-run.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_shift_master' AND INDEX_NAME = 'shift_code'
);
SET @drop_stmt := IF(@idx_exists > 0, 'ALTER TABLE wfm_shift_master DROP INDEX shift_code', 'SELECT 1');
PREPARE stmt FROM @drop_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @uq_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_shift_master' AND INDEX_NAME = 'uq_wfm_shift_master_code_version'
);
SET @add_stmt := IF(@uq_exists = 0, 'ALTER TABLE wfm_shift_master ADD UNIQUE KEY uq_wfm_shift_master_code_version (shift_code, version)', 'SELECT 1');
PREPARE stmt FROM @add_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 2. wfm_roster_assignment: canonical versioned-shift reference + minutes ──
-- shift_start_time/shift_end_time already exist (012_roster_shift_times.sql) and
-- the live generation engine already populates them on every write — they
-- already serve as the "scheduled_start"/"scheduled_end" snapshot in substance,
-- so this does not duplicate them under a second name. scheduled_minutes is a
-- genuine gap: duration is currently only implicitly derivable from start/end,
-- which does not cleanly represent a cross-midnight shift's actual worked
-- minutes for payroll reproduction. shift_version_id is additive and
-- backward-compatible: existing code keeps reading shift_id/shift_template_id
-- unchanged; new code should prefer shift_version_id once populated.
ALTER TABLE wfm_roster_assignment
  ADD COLUMN IF NOT EXISTS shift_version_id  CHAR(36) NULL COMMENT 'FK wfm_shift_master.id — a specific, immutable-once-referenced version row. The canonical source for reproducing what was actually scheduled on this date. Prefer over shift_id/shift_template_id for anything payroll-facing.' AFTER shift_id,
  ADD COLUMN IF NOT EXISTS scheduled_minutes INT      NULL COMMENT 'Snapshot of the shift''s working minutes at assignment time, cross-midnight-safe. NULL for rows created before this migration, until backfilled.';

SELECT '1200_shift_versioning.sql applied successfully' AS migration_status;
