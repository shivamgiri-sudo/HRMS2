-- ============================================================
-- Migration 227: week_off_preference schema fix
-- Adds columns that backend services reference but never existed
-- in the original migration 060/061 schema.
--
-- SAFE: ADD COLUMN — MySQL 8.0 confirmed.
-- All columns are nullable or have defaults → zero impact on existing rows.
-- Old columns (preferred_day, alternate_day, approved) are KEPT
-- so existing wfm.routes.ts /week-off-preference endpoints keep working.
--
-- ROLLBACK (if needed before any data is written to new columns):
--   ALTER TABLE week_off_preference
--     DROP COLUMN week_start_date,
--     DROP COLUMN process_id,
--     DROP COLUMN branch_id,
--     DROP COLUMN preferred_day_1,
--     DROP COLUMN preferred_day_2,
--     DROP COLUMN reason,
--     DROP COLUMN status,
--     DROP COLUMN manager_remarks,
--     DROP COLUMN reviewed_at,
--     DROP COLUMN created_by;
--   DROP INDEX idx_wop_process_week ON week_off_preference;
--   DROP INDEX idx_wop_status ON week_off_preference;
-- ============================================================

ALTER TABLE week_off_preference
  ADD COLUMN week_start_date  DATE         NULL COMMENT 'Roster week this preference applies to (NULL = standing preference)'
    AFTER employee_id,
  ADD COLUMN process_id       VARCHAR(36)  NULL COMMENT 'FK process_master.id — denormalised for fast WFM queries'
    AFTER week_start_date,
  ADD COLUMN branch_id        VARCHAR(36)  NULL COMMENT 'FK branch_master.id'
    AFTER process_id,
  ADD COLUMN preferred_day_1  INT          NULL COMMENT '0=Sun..6=Sat — mirrors preferred_day; used by governance routes'
    AFTER preferred_day,
  ADD COLUMN preferred_day_2  INT          NULL COMMENT 'Alternate day — mirrors alternate_day; used by governance routes'
    AFTER preferred_day_1,
  ADD COLUMN reason           TEXT         NULL COMMENT 'Employee-provided reason for this preference'
    AFTER preferred_day_2,
  ADD COLUMN status           ENUM('submitted','accepted','applied','rejected','waitlisted')
                                            NOT NULL DEFAULT 'submitted'
    COMMENT 'Governance lifecycle status — replaces binary approved flag'
    AFTER approved,
  ADD COLUMN manager_remarks  TEXT         NULL COMMENT 'WFM/manager review notes'
    AFTER status,
  ADD COLUMN reviewed_at      DATETIME     NULL COMMENT 'When WFM/manager acted on this preference'
    AFTER manager_remarks,
  ADD COLUMN created_by       VARCHAR(36)  NULL COMMENT 'auth_user.id who submitted (for bulk import)'
    AFTER reviewed_at;

-- Sync preferred_day_1 / preferred_day_2 from old columns for existing rows
-- so old data is immediately visible under the new column names.
UPDATE week_off_preference
   SET preferred_day_1 = preferred_day,
       preferred_day_2 = alternate_day
 WHERE preferred_day_1 IS NULL;

-- Sync status from old approved flag for existing rows
UPDATE week_off_preference
   SET status = CASE WHEN approved = 1 THEN 'accepted' ELSE 'submitted' END
 WHERE status = 'submitted' AND approved IS NOT NULL;

-- Useful indexes for the new columns
ALTER TABLE week_off_preference
  ADD INDEX idx_wop_process_week (process_id, week_start_date),
  ADD INDEX idx_wop_status       (status);

SELECT '227_week_off_preference_schema_fix.sql applied successfully' AS migration_status;
