-- ============================================================
-- Migration 227: week_off_preference schema fix
-- Adds columns that backend services reference but never existed
-- in the original migration 060/061 schema.
--
-- SAFE: ADD COLUMN IF NOT EXISTS — MySQL 8.0 confirmed.
-- All columns are nullable or have defaults → zero impact on existing rows.
-- Old columns (preferred_day, alternate_day, approved) are KEPT
-- so existing wfm.routes.ts /week-off-preference endpoints keep working.
--
-- ROLLBACK (if needed before any data is written to new columns):
--   ALTER TABLE week_off_preference
--     DROP COLUMN IF EXISTS week_start_date,
--     DROP COLUMN IF EXISTS process_id,
--     DROP COLUMN IF EXISTS branch_id,
--     DROP COLUMN IF EXISTS preferred_day_1,
--     DROP COLUMN IF EXISTS preferred_day_2,
--     DROP COLUMN IF EXISTS reason,
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS manager_remarks,
--     DROP COLUMN IF EXISTS reviewed_at,
--     DROP COLUMN IF EXISTS created_by;
--   DROP INDEX IF EXISTS idx_wop_process_week ON week_off_preference;
--   DROP INDEX IF EXISTS idx_wop_status ON week_off_preference;
-- ============================================================

ALTER TABLE week_off_preference
  ADD COLUMN IF NOT EXISTS week_start_date  DATE         NULL COMMENT 'Roster week this preference applies to (NULL = standing preference)'
    AFTER employee_id,
  ADD COLUMN IF NOT EXISTS process_id       VARCHAR(36)  NULL COMMENT 'FK process_master.id — denormalised for fast WFM queries'
    AFTER week_start_date,
  ADD COLUMN IF NOT EXISTS branch_id        VARCHAR(36)  NULL COMMENT 'FK branch_master.id'
    AFTER process_id,
  ADD COLUMN IF NOT EXISTS preferred_day_1  INT          NULL COMMENT '0=Sun..6=Sat — mirrors preferred_day; used by governance routes'
    AFTER preferred_day,
  ADD COLUMN IF NOT EXISTS preferred_day_2  INT          NULL COMMENT 'Alternate day — mirrors alternate_day; used by governance routes'
    AFTER preferred_day_1,
  ADD COLUMN IF NOT EXISTS reason           TEXT         NULL COMMENT 'Employee-provided reason for this preference'
    AFTER preferred_day_2,
  ADD COLUMN IF NOT EXISTS status           ENUM('submitted','accepted','applied','rejected','waitlisted')
                                            NOT NULL DEFAULT 'submitted'
    COMMENT 'Governance lifecycle status — replaces binary approved flag'
    AFTER approved,
  ADD COLUMN IF NOT EXISTS manager_remarks  TEXT         NULL COMMENT 'WFM/manager review notes'
    AFTER status,
  ADD COLUMN IF NOT EXISTS reviewed_at      DATETIME     NULL COMMENT 'When WFM/manager acted on this preference'
    AFTER manager_remarks,
  ADD COLUMN IF NOT EXISTS created_by       VARCHAR(36)  NULL COMMENT 'auth_user.id who submitted (for bulk import)'
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
  ADD INDEX IF NOT EXISTS idx_wop_process_week (process_id, week_start_date),
  ADD INDEX IF NOT EXISTS idx_wop_status       (status);

SELECT '227_week_off_preference_schema_fix.sql applied successfully' AS migration_status;
