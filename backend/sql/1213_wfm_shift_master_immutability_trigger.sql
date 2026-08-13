-- Migration 1213: DB-level immutability for a locked (used) shift version
--
-- Round 2 of the 2026-08-13 roster enterprise-controls program, item 3.
--
-- AUDIT FINDING (read-only pass, 2026-08-13): wfm_shift_master has exactly
-- one HTTP-reachable application write path — wfm.service.ts's
-- createShift()/updateShift()/createShiftVersion(), reached only through
-- POST/PUT /api/wfm/shifts[/:id] (roles: admin, wfm) — and updateShift()
-- already correctly refuses to edit start_time/end_time/required_minutes in
-- place on a locked row, version-bumping instead (isShiftLocked() gate,
-- confirmed 7/7 tests passing). The two non-HTTP operator scripts that also
-- touch this table (043_demo_data.sql, 1201_shift_versioning_backfill.sql)
-- are both structurally incapable of moving a payroll-relevant column
-- (043's ON DUPLICATE KEY clause only ever rewrites shift_name; 1201 only
-- ever sets is_locked). So application-layer enforcement already covers
-- every HTTP/attacker-reachable surface.
--
-- What it does NOT cover: a future code path that writes to this table
-- without going through wfm.service.ts, or direct SQL access (an ad hoc
-- fix script, a DBA console session, a future migration that "just adds a
-- default value" via UPDATE). Migration 1200's own comment already admits
-- this ("Enforced in wfm.service.ts, not a DB trigger"). This migration
-- closes that gap with an actual DB-level control: a BEFORE UPDATE trigger
-- that rejects any attempt to change start_time, end_time or
-- required_minutes on a row where is_locked = 1 — the three columns
-- confirmed (by the same audit) to be the only payroll/attendance-
-- interpretation-relevant fields on this table (it has no separate
-- break/grace or night-shift columns to protect).
--
-- Deliberately NOT protected (non-material metadata, matching
-- updateShift()'s own existing distinction): shift_name, branch_name,
-- process_name, active_status — editing a locked shift's display label or
-- active flag carries no historical-interpretation risk and remains
-- editable in place, same as it is today.
--
-- This is additive defense-in-depth, not a behavior change to the
-- application: updateShift() already refuses these edits and version-bumps
-- instead, so under normal application use this trigger never fires. It
-- only ever fires against a write that was going to corrupt a locked
-- version's payroll-relevant fields some other way.
--
-- Does not eliminate raw MySQL superadmin access as a bypass (no DB-level
-- control can — a user with DROP TRIGGER privilege can always remove this
-- trigger first), but it does close every write path short of that: any
-- INSERT-based UPDATE, ORM, future service, or ad hoc script now hits the
-- same wall the application already enforces, without relying on every
-- future author remembering to call isShiftLocked() themselves.
--
-- Idempotent by construction: DROP TRIGGER IF EXISTS (standard, long-
-- supported MySQL syntax — unlike ADD COLUMN IF NOT EXISTS, which the
-- migration-1006 outage proved this server's 8.0.42 build rejects at parse
-- time) followed by CREATE TRIGGER, so re-running this file simply
-- redefines the same trigger rather than erroring on "already exists".
--
-- **DO NOT RUN THIS AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.**
-- Not added to MIGRATION_MANIFEST. Depends on migration 1200 having already
-- run (is_locked column must exist) — see this file's own guard below,
-- which no-ops instead of failing if 1200 hasn't been applied yet.

USE mas_hrms;

SET @has_is_locked = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_shift_master' AND COLUMN_NAME = 'is_locked'
);

-- No-op (not a failure) if 1200 hasn't run yet — the trigger has nothing to
-- gate without is_locked, and creating it against a column that doesn't
-- exist would itself throw. Re-run this file after 1200 to actually install it.
DROP TRIGGER IF EXISTS trg_wfm_shift_master_protect_locked;

DELIMITER $$
CREATE TRIGGER trg_wfm_shift_master_protect_locked
BEFORE UPDATE ON wfm_shift_master
FOR EACH ROW
BEGIN
  IF @has_is_locked = 1 AND OLD.is_locked = 1 AND (
       NOT (NEW.start_time <=> OLD.start_time)
    OR NOT (NEW.end_time <=> OLD.end_time)
    OR NOT (NEW.required_minutes <=> OLD.required_minutes)
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'wfm_shift_master: start_time/end_time/required_minutes cannot be changed on a locked (used) shift version — call createShiftVersion() to create a new effective-dated version instead';
  END IF;
END$$
DELIMITER ;

SELECT '1213_wfm_shift_master_immutability_trigger.sql applied successfully' AS migration_status;

-- ── Rollback (run manually, NOT part of forward migration) ─────────────────
-- DROP TRIGGER IF EXISTS trg_wfm_shift_master_protect_locked;
-- Safe at any point — reverts to application-only enforcement (today's
-- behavior for every HTTP-reachable path; only removes the DB-level
-- backstop for non-application writes).
