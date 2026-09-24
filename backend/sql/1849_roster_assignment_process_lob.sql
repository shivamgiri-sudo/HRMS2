-- 1849_roster_assignment_process_lob.sql
-- Adds nullable process_id / lob_id to wfm_roster_assignment so a roster row can be filed
-- against a process and an LOB without reading the text columns branch_name/process_name
-- (333k of the live rows carry process_name NULL).
--
-- ADDITIVE ONLY. Nullable columns are a metadata-only change on MySQL 8 (no table rebuild) and the
-- two secondary indexes are built online. NOTHING is backfilled here: the table has 413k+ rows
-- and a blind UPDATE would lock/slow the live database. Existing rows stay NULL until
-- backend/scripts/backfill-roster-assignment-process-lob.mjs (throttled, resumable) is run.
--
-- COLLATION: like 1847, each id column copies the collation of the column it compares with
-- (process_master.id / lob_master.id) from information_schema at migration time, because a
-- mismatch raises ER_CANT_AGGREGATE_2COLLATIONS and a COLLATE cast would kill the index.
-- Every step is guarded through information_schema (no ADD COLUMN IF NOT EXISTS - that is a
-- MariaDB-only clause and ER_PARSE_ERRORs on this production MySQL).
--
-- Idempotent: safe to apply repeatedly.

SET @ra_pc = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_master' AND COLUMN_NAME = 'id' LIMIT 1), 'utf8mb4_unicode_ci');
SET @ra_lc = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lob_master' AND COLUMN_NAME = 'id' LIMIT 1), 'utf8mb4_unicode_ci');

SET @ra_sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment') = 0
  OR (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'process_id') > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE wfm_roster_assignment ADD COLUMN process_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @ra_pc, ' NULL'));
PREPARE ra_stmt FROM @ra_sql;
EXECUTE ra_stmt;
DEALLOCATE PREPARE ra_stmt;

SET @ra_sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment') = 0
  OR (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'lob_id') > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE wfm_roster_assignment ADD COLUMN lob_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @ra_lc, ' NULL'));
PREPARE ra_stmt FROM @ra_sql;
EXECUTE ra_stmt;
DEALLOCATE PREPARE ra_stmt;

SET @ra_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'process_id') = 0
  OR (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND INDEX_NAME = 'idx_wra_process_date') > 0,
  'SELECT 1',
  'ALTER TABLE wfm_roster_assignment ADD INDEX idx_wra_process_date (process_id, roster_date)');
PREPARE ra_stmt FROM @ra_sql;
EXECUTE ra_stmt;
DEALLOCATE PREPARE ra_stmt;

SET @ra_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'lob_id') = 0
  OR (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND INDEX_NAME = 'idx_wra_lob_date') > 0,
  'SELECT 1',
  'ALTER TABLE wfm_roster_assignment ADD INDEX idx_wra_lob_date (lob_id, roster_date)');
PREPARE ra_stmt FROM @ra_sql;
EXECUTE ra_stmt;
DEALLOCATE PREPARE ra_stmt;
