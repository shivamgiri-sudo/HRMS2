-- 1640 - close the unattributed manual write path into `apr` at the database
-- (requirements.md criterion 17.10: "THE system SHALL reject any manual write to `apr` that
-- carries no Dialler_Source attribution and no upload batch identifier, so that the unattributed
-- path that produced the 3,810 existing 'MANUAL_UPLOAD' rows with empty process_name and empty
-- branch_name is closed").
--
-- NOT YET EXECUTED. Needs owner approval before it runs (CLAUDE.md).
--
-- ============================================================================================
-- THIS MIGRATION MUST BE APPLIED IN THE SAME DEPLOYMENT AS ITS ROUTE CHANGE
-- ============================================================================================
-- Its pair is the phase-3 evidence write in
-- backend/src/modules/wfm/attendance-apr-bulk.routes.ts, changed in the same commit range to
-- carry a campaign owned by a registered Dialler_Source plus a real productivity_upload_batch id
-- (backend/src/modules/wfm/attendance-apr-bulk-attribution.service.ts).
--
-- Applying THIS FILE WITHOUT that route change breaks the live route on its first upload: the old
-- write inserts campaign_id = 'MANUAL_UPLOAD' with upload_batch_id NULL and source = 'manual',
-- which is exactly what the BEFORE INSERT trigger below rejects. The attendance_daily_record write
-- would still succeed (it runs first, in its own statement, and is never rolled back by a later
-- failure), so an uploader would see every row saved for attendance and every row reporting
-- "the dialler evidence row could not be recorded" - loud, not silent, but a broken route.
--
-- Applying the ROUTE CHANGE WITHOUT this file is safe: attribution is then enforced by the
-- application only, which is the state migration 1213's header describes as insufficient - it does
-- not stop an ad hoc fix script, a DBA console session, or a future service that writes `apr`
-- without going through this route. Criteria 15.18 and 17.10 ask for the path to be CLOSED, not
-- merely unused, which is why the enforcement belongs here as well.
--
-- ============================================================================================
-- WHAT COUNTS AS A "MANUAL WRITE" - and why the integrated dialler sync is untouched
-- ============================================================================================
-- `apr.source` is ENUM('sync','manual') NOT NULL DEFAULT 'sync' (migration 1502), and it is the
-- only column on the table that declares where a row came from. The integrated ViciDial sync
-- (backend/src/workers/apr-vicidial-sync.worker.ts) writes `source` explicitly as 'sync' on every
-- row it inserts and never assigns `source` in its ON DUPLICATE KEY UPDATE clause, so a synced row
-- can never present as 'manual' to the triggers below. That worker runs continuously against a live
-- feed; a condition that caught it would take production ingestion down, so the condition is keyed
-- on `source = 'manual'` alone and nothing else.
--
-- Deliberately NOT enforced here: that campaign_id RESOLVES to a campaign_master row owning a
-- dialler_source_id. A trigger can run that SELECT, but it would make every manual row insert take
-- a read dependency on campaign_master's contents - so a missing or renamed campaign row would hard
-- fail an otherwise fully attributed write, on a table with 46,163 rows and a live ingestion path.
-- Resolution stays where criteria 16.5 and 16.7 put it: the application layer
-- (dialler-source-registry.service.ts resolveCampaignOwner) and the aggregation that rejects an
-- unresolvable contribution. What the triggers enforce is the part that is knowable from the row
-- alone and that was actually missing in production: a batch identifier, and a campaign that is not
-- the bare sentinel.
--
-- Also inherent, and stated rather than hidden: a write that sets source = 'sync' while being
-- manual in truth evades these triggers entirely. No row-local trigger can detect a write that
-- lies about its own provenance; the control for that is the registry resolution above.
--
-- ============================================================================================
-- THE 3,810 LEGACY ROWS - grandfathered, deliberately, and no backfill is required first
-- ============================================================================================
-- Those rows are source = 'manual', campaign_id = 'MANUAL_UPLOAD', upload_batch_id NULL. They are
-- unattributed by definition, so a BEFORE UPDATE trigger that judged only the NEW row's state
-- would reject EVERY future update to them, including:
--   * a corrected re-upload for a historical date (the live route accepts an attendance_date up to
--     90 days old, so this is ordinary traffic, not a hypothetical);
--   * requirement 15's own attribution/backfill work on exactly these rows, which must be able to
--     update them;
--   * the enrichment update that fills process_name / branch_name.
--
-- So the UPDATE branch fires only on a TRANSITION INTO an unattributed manual state: NEW is
-- unattributed-manual AND OLD was not. That gives three properties worth having:
--   1. A row that is already attributed cannot be stripped of its attribution.
--   2. A synced row cannot be flipped to manual without attribution.
--   3. A legacy row can still be updated while it stays as it already was - so nothing has to be
--      backfilled before this migration is safe to apply, and the live route does not start failing
--      on historical dates.
-- The cost of grandfathering is that a legacy row can be edited and remain unattributed. It cannot
-- get WORSE, and no new unattributed row can be created, which is what "the path is closed" means.
-- Attributing the existing 3,810 is Requirement 15's job (criterion 15.17), and it is now
-- unblocked rather than blocked by this trigger.
--
-- The same transition rule also protects the ViciDial worker's ON DUPLICATE KEY UPDATE branch: if
-- it ever lands on a manual row, its clause preserves every column of that row (IF(source =
-- 'manual', ...)) and never assigns `source`, so NEW equals OLD, the transition is absent, and the
-- trigger stays quiet.
--
-- ============================================================================================
-- MECHANICS
-- ============================================================================================
-- Row state only, never a session variable: migration 1213's header records the live proof that
-- @user_variables are session-scoped, so a guard set by the migrating session reads NULL in every
-- session that later fires the trigger, and `NULL = 1` is NULL - a trigger that signals nothing,
-- ever, while every comment claims the gap is closed.
--
-- DROP TRIGGER IF EXISTS before each CREATE, so re-running this file redefines the triggers rather
-- than failing on "already exists" (standard MySQL syntax, unlike the MariaDB conditional-DDL forms
-- this server rejects at parse time). No dependency guard is needed: CREATE TRIGGER validates its
-- own column references, so if migration 1502 has not run this fails with "Unknown column
-- 'upload_batch_id' in NEW", which names the missing column and the fix.
--
-- MESSAGE_TEXT is capped by MySQL at 128 characters - past that the server replaces SQLSTATE 45000
-- with HY000 "Data too long for condition item 'MESSAGE_TEXT'", so the write is still blocked but
-- the caller is told about truncation instead of the reason (migration 1213 hit exactly this). Both
-- messages below are under the cap and name the actionable fix.
--
-- ROLLBACK (run manually, NOT part of the forward migration)
--   DROP TRIGGER IF EXISTS trg_apr_reject_unattributed_manual_insert;
--   DROP TRIGGER IF EXISTS trg_apr_reject_unattributed_manual_update;
--   Safe at any point, and reverts to application-only enforcement - which is today's behaviour for
--   the one HTTP path that writes manual apr rows. Roll this back if and only if the paired route
--   change is also rolled back; leaving the trigger while the route is reverted is the broken
--   combination described at the top of this file.

DROP TRIGGER IF EXISTS trg_apr_reject_unattributed_manual_insert;

DELIMITER $$
CREATE TRIGGER trg_apr_reject_unattributed_manual_insert
BEFORE INSERT ON apr
FOR EACH ROW
BEGIN
  IF NEW.source = 'manual'
     AND (NEW.upload_batch_id IS NULL
          OR NEW.campaign_id IS NULL
          OR NEW.campaign_id = ''
          OR NEW.campaign_id = 'MANUAL_UPLOAD') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'apr: a manual row needs upload_batch_id and a registered campaign_id, not MANUAL_UPLOAD (criterion 17.10)';
  END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_apr_reject_unattributed_manual_update;

DELIMITER $$
CREATE TRIGGER trg_apr_reject_unattributed_manual_update
BEFORE UPDATE ON apr
FOR EACH ROW
BEGIN
  -- Transition only: reject becoming unattributed-manual, never merely being it. See "THE 3,810
  -- LEGACY ROWS" above. OLD.source is NOT NULL, and the OR chain short-circuits to TRUE on the
  -- IS NULL test, so no branch here can evaluate to NULL and skip the check by accident.
  IF NEW.source = 'manual'
     AND (NEW.upload_batch_id IS NULL
          OR NEW.campaign_id IS NULL
          OR NEW.campaign_id = ''
          OR NEW.campaign_id = 'MANUAL_UPLOAD')
     AND NOT (OLD.source = 'manual'
              AND (OLD.upload_batch_id IS NULL
                   OR OLD.campaign_id IS NULL
                   OR OLD.campaign_id = ''
                   OR OLD.campaign_id = 'MANUAL_UPLOAD')) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'apr: an attributed row cannot lose its upload_batch_id or registered campaign_id (criterion 17.10)';
  END IF;
END$$
DELIMITER ;

SELECT '1640 applied: apr unattributed-manual-write rejection triggers' AS migration_status;
