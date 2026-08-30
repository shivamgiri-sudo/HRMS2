-- 1637 — campaign_master ownership columns + Canonical_Productive_Minutes materialisation
-- (requirements.md Requirement 16 criteria 16.7-16.8, Requirement 18).
--
-- NOT YET EXECUTED. Additive: three nullable/defaulted columns on an existing table, two new
-- tables. No DROP, no DELETE, no backfill of existing campaign_master rows (0 rows exist today —
-- backend/sql/015_platform_foundation.sql created the table but nothing has ever populated it).
-- Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- campaign_master exists (015_platform_foundation.sql: id, campaign_code, campaign_name,
-- process_id, lob_id, active_status) but holds 0 rows, so the 78 distinct `apr.campaign_id`
-- values in production are unmanaged free text with no owning process or dialler anywhere. This
-- migration adds the two columns that let a campaign declare which Dialler_Source it belongs to
-- and, separately, marks the 'MANUAL_UPLOAD' sentinel campaign (criterion 16.8: 'MANUAL_UPLOAD'
-- is rejected as a Dialler_Source identifier, but still needs a seeded, inactive-by-convention
-- campaign_master row so the canonical aggregator can recognise and exclude it by is_sentinel
-- rather than by string comparison scattered across the codebase).
--
-- ALTER uses the INFORMATION_SCHEMA.COLUMNS + PREPARE/EXECUTE idiom (migration 1630's proven
-- pattern) because ADD COLUMN IF NOT EXISTS is not valid MySQL 8 syntax and would record as
-- applied while having failed. campaign_master's two PRE-EXISTING FOREIGN KEYs
-- (process_id -> process_master, lob_id -> lob_master) are untouched; the two NEW columns this
-- migration adds carry no FK, matching this feature's established no-FK convention.
--
-- WHAT attendance_productive_day / attendance_productive_contribution ARE
-- One row per (employee, work_date) holding the derived Canonical_Productive_Minutes and which
-- of the two Requirement-18 rules produced it; one row per (employee, work_date, dialler_source,
-- feed, source_row_ref) holding the individual contribution that fed that derivation, so the
-- Consolidated_Productivity_View (a later UI phase) can show the breakdown. NEITHER TABLE IS
-- WRITTEN BY ANYTHING YET — deriveCanonical() (this phase) is a pure function with no DB access;
-- the write path is Phase 3's ingestion tasks (vicidial sync worker, WFM upload, dbSyncService).
-- Creating the tables now, ahead of their writers, lets Task 4 of this plan and every later
-- phase's tests target a real schema instead of a moving target.
--
-- ROLLBACK
--   DROP TABLE attendance_productive_contribution;
--   DROP TABLE attendance_productive_day;
--   ALTER TABLE campaign_master DROP COLUMN is_sentinel, DROP COLUMN owning_branch_id, DROP COLUMN dialler_source_id;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'campaign_master'
      AND column_name = 'dialler_source_id') = 0,
  'ALTER TABLE campaign_master
     ADD COLUMN dialler_source_id CHAR(36) NULL
       COMMENT ''Owning Dialler_Source for this campaign (criterion 16.7). NULL until the migration-15 disposition assigns one.''
       AFTER lob_id',
  'SELECT ''campaign_master.dialler_source_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'campaign_master'
      AND column_name = 'owning_branch_id') = 0,
  'ALTER TABLE campaign_master
     ADD COLUMN owning_branch_id CHAR(36) NULL
       COMMENT ''Branch this campaign is scoped to, if any. NULL = every branch.''
       AFTER dialler_source_id',
  'SELECT ''campaign_master.owning_branch_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'campaign_master'
      AND column_name = 'is_sentinel') = 0,
  'ALTER TABLE campaign_master
     ADD COLUMN is_sentinel TINYINT(1) NOT NULL DEFAULT 0
       COMMENT ''1 for the seeded MANUAL_UPLOAD sentinel row (criterion 16.8) -- excluded from Canonical_Productive_Minutes by this flag, not by string comparison.''
       AFTER owning_branch_id',
  'SELECT ''campaign_master.is_sentinel already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS attendance_productive_day (
  employee_id         CHAR(36)  NOT NULL,
  work_date           DATE      NOT NULL,
  canonical_minutes    SMALLINT UNSIGNED NULL,
  producing_rule       ENUM('interval_union','max_contribution') NULL,
  contribution_count   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  derivation_version   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  derived_at           DATETIME  NULL,
  PRIMARY KEY (employee_id, work_date),
  KEY idx_apd_date (work_date)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Materialised Canonical_Productive_Minutes (Requirement 18), one row per employee-date. canonical_minutes NULL means absent -- never a measured zero. Not written by anything until Phase 3.';

CREATE TABLE IF NOT EXISTS attendance_productive_contribution (
  id                 CHAR(36)     NOT NULL,
  employee_id        CHAR(36)     NOT NULL,
  work_date          DATE         NOT NULL,
  dialler_source_id  CHAR(36)     NOT NULL,
  feed               ENUM('apr_sync','apr_manual','dialer_session_log') NOT NULL,
  source_row_ref     VARCHAR(255) NOT NULL,
  upload_batch_id    CHAR(36)     NULL,
  login_at           DATETIME     NULL,
  logout_at          DATETIME     NULL,
  magnitude_minutes  SMALLINT UNSIGNED NOT NULL,
  interval_usable    TINYINT(1)   NOT NULL DEFAULT 0,
  exclusion_reason   VARCHAR(255) NULL,
  metrics            JSON         NULL,
  superseded_at      DATETIME     NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_apc (employee_id, work_date, dialler_source_id, feed, source_row_ref),
  KEY idx_apc_emp_date (employee_id, work_date)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='One row per (employee, date, source) contribution to Canonical_Productive_Minutes (Requirement 18). superseded_at IS NULL rows are the live set; excluded once superseded. Not written by anything until Phase 3.';

SELECT '1637 applied: campaign_master ownership columns + attendance_productive_day + attendance_productive_contribution' AS migration_status;
