-- 1503_wfm_roster_assignment_import_columns.sql
-- Adds assignment_type, lifecycle_state, import_batch_id to wfm_roster_assignment.
-- Required by roster-import.service.ts (Task 12 / WFM import engine, mounted 2026-08-20
-- in commit 7e1a305d) — confirmed live: none of these three columns exist yet, so the
-- just-mounted import-commit endpoint (roster-import.service.ts:commitBatch) cannot
-- currently write a row.
--
-- RECREATED 2026-08-20: this file was registered in the migration manifest (638974b7) but
-- existed only as an untracked, never-committed file in a shared working tree — a later
-- concurrent `git clean`/reset wiped it from disk entirely (confirmed: no commit on
-- origin/main ever added or removed it; it simply never reached git). Recreated from the
-- last-read copy, with two real fixes made along the way, not just the syntax rewrite:
--
--   1. `ADD COLUMN IF NOT EXISTS` / `ADD INDEX IF NOT EXISTS` (MariaDB-only syntax MySQL
--      8.0.42 rejects with ER_PARSE_ERROR) rewritten as information_schema-guarded
--      PREPARE/EXECUTE blocks, one per column/index — matching 1110/1123/1218/1118/1500 in
--      this directory. A multi-column ALTER is not safely re-runnable, since MySQL fails
--      the whole statement atomically if even one column already exists.
--
--   2. import_batch_id's type corrected from CHAR(36) to INT. wfm_roster_import_batch.id
--      (1500_wfm_roster_import_engine.sql) is `INT AUTO_INCREMENT PRIMARY KEY`, not a UUID
--      — verified live. roster-import.service.ts's only writer (`batchId: number`,
--      commitBatch ~line 416-435) always passes a plain integer. CHAR(36) would not have
--      errored (MySQL stores a numeric string in it without complaint), but it is the wrong
--      type for the value it holds and for what it references — worth fixing now, before
--      any row exists, rather than after.
--
-- ROLLBACK:
--   ALTER TABLE wfm_roster_assignment
--     DROP COLUMN IF EXISTS assignment_type,
--     DROP COLUMN IF EXISTS lifecycle_state,
--     DROP COLUMN IF EXISTS import_batch_id;

SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'wfm_roster_assignment'
              AND column_name = 'assignment_type');
SET @ddl := IF(@c = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN assignment_type VARCHAR(50) NULL COMMENT ''WFM assignment type (REGULAR, WEEK_OFF, etc.)'' AFTER is_week_off',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'wfm_roster_assignment'
              AND column_name = 'lifecycle_state');
SET @ddl := IF(@c = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN lifecycle_state VARCHAR(50) NOT NULL DEFAULT ''DRAFT'' COMMENT ''Import/commit lifecycle: DRAFT, COMMITTED, SUPERSEDED'' AFTER assignment_type',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'wfm_roster_assignment'
              AND column_name = 'import_batch_id');
SET @ddl := IF(@c = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN import_batch_id INT NULL COMMENT ''FK wfm_roster_import_batch.id — set when row originates from an import'' AFTER lifecycle_state',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @i := (SELECT COUNT(1) FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND table_name = 'wfm_roster_assignment'
              AND index_name = 'idx_wra_lifecycle');
SET @ddl := IF(@i = 0,
  'CREATE INDEX idx_wra_lifecycle ON wfm_roster_assignment (lifecycle_state)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @i := (SELECT COUNT(1) FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND table_name = 'wfm_roster_assignment'
              AND index_name = 'idx_wra_import_batch');
SET @ddl := IF(@i = 0,
  'CREATE INDEX idx_wra_import_batch ON wfm_roster_assignment (import_batch_id)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1503_wfm_roster_assignment_import_columns.sql applied successfully' AS migration_status;
