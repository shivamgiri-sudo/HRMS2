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

-- ── 2026-08-28 CORRECTION: the is_locked guard must NOT live in the trigger body ──
--
-- This file previously did:
--     SET @has_is_locked = (SELECT COUNT(*) ... COLUMN_NAME = 'is_locked');
-- and then tested `@has_is_locked = 1` INSIDE the trigger. That is a user
-- variable, and user variables are SESSION-scoped. The session that runs this
-- migration sets it to 1; every other session — i.e. every session that will
-- ever fire the trigger — sees NULL. `NULL = 1` is NULL, so the IF is never
-- true and the trigger would have SIGNALed nothing, ever.
--
-- Demonstrated live 2026-08-28 on two connections: the setting session reads 1,
-- a second connection reads NULL, and `(@has_is_locked = 1)` returns NULL there.
--
-- That is worse than not installing it at all: migration 1200's comment and this
-- file's own header both then claim the direct-SQL gap is closed, while nothing
-- guards it. The dependency on 1200 is a decision about whether to CREATE the
-- trigger, not a condition to re-evaluate on every UPDATE — so the trigger body
-- now tests only row state.
--
-- No separate precondition query is needed, and the one drafted here first was a
-- hack (it forced an error via a deliberately multi-row subquery, which reports
-- "Subquery returns more than 1 row" — an error that tells the reader nothing).
-- CREATE TRIGGER validates its own column references: if 1200 has not run, the
-- statement below fails with "Unknown column 'is_locked' in NEW", which names the
-- missing column and the fix. Let the server produce that message.

DROP TRIGGER IF EXISTS trg_wfm_shift_master_protect_locked;

DELIMITER $$
CREATE TRIGGER trg_wfm_shift_master_protect_locked
BEFORE UPDATE ON wfm_shift_master
FOR EACH ROW
BEGIN
  -- Row state only. No session variables: see the 2026-08-28 correction above.
  IF OLD.is_locked = 1 AND (
       NOT (NEW.start_time <=> OLD.start_time)
    OR NOT (NEW.end_time <=> OLD.end_time)
    OR NOT (NEW.required_minutes <=> OLD.required_minutes)
  ) THEN
      -- MESSAGE_TEXT is capped at 128 characters. The original text ran to 180 and
      -- MySQL replaced the intended SQLSTATE 45000 with HY000 "Data too long for
      -- condition item 'MESSAGE_TEXT'" — the write was still blocked, but the caller
      -- got a truncation error instead of the reason. Keep this under 128.
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'wfm_shift_master: start_time/end_time/required_minutes are immutable on a locked shift version; create a new version instead';
  END IF;
END$$
DELIMITER ;

SELECT '1213_wfm_shift_master_immutability_trigger.sql applied successfully' AS migration_status;

-- ── Rollback (run manually, NOT part of forward migration) ─────────────────
-- DROP TRIGGER IF EXISTS trg_wfm_shift_master_protect_locked;
-- Safe at any point — reverts to application-only enforcement (today's
-- behavior for every HTTP-reachable path; only removes the DB-level
-- backstop for non-application writes).
