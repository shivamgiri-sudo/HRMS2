-- 590_cost_centre_relationships.sql
-- Adds mandatory relationships to cost_centre_master: client_id, lob_id, process_id
-- Cost centres must be linked to Client + LOB + Branch + Process (strictest model)
-- All additive. Do not execute on production without explicit approval.

USE mas_hrms;

-- ── 1. Add client_id column to cost_centre_master ────────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cost_centre_master' AND COLUMN_NAME = 'client_id') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN client_id CHAR(36) NULL AFTER department_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. Add lob_id column to cost_centre_master ───────────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cost_centre_master' AND COLUMN_NAME = 'lob_id') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN lob_id CHAR(36) NULL AFTER client_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. Add process_id column to cost_centre_master ───────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cost_centre_master' AND COLUMN_NAME = 'process_id') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN process_id CHAR(36) NULL AFTER lob_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 4. Add foreign key constraints ───────────────────────────────────────────
-- Using RESTRICT to prevent deletion of parent records while cost centres reference them

-- FK for client_id
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = 'mas_hrms' AND TABLE_NAME = 'cost_centre_master' AND CONSTRAINT_NAME = 'fk_cc_client') = 0,
  'ALTER TABLE cost_centre_master ADD CONSTRAINT fk_cc_client FOREIGN KEY (client_id) REFERENCES client_master(id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK for lob_id
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = 'mas_hrms' AND TABLE_NAME = 'cost_centre_master' AND CONSTRAINT_NAME = 'fk_cc_lob') = 0,
  'ALTER TABLE cost_centre_master ADD CONSTRAINT fk_cc_lob FOREIGN KEY (lob_id) REFERENCES lob_master(id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK for process_id
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = 'mas_hrms' AND TABLE_NAME = 'cost_centre_master' AND CONSTRAINT_NAME = 'fk_cc_process') = 0,
  'ALTER TABLE cost_centre_master ADD CONSTRAINT fk_cc_process FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 5. Add indexes for performance ───────────────────────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cost_centre_master' AND INDEX_NAME = 'idx_cc_client') = 0,
  'CREATE INDEX idx_cc_client ON cost_centre_master(client_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cost_centre_master' AND INDEX_NAME = 'idx_cc_lob') = 0,
  'CREATE INDEX idx_cc_lob ON cost_centre_master(lob_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cost_centre_master' AND INDEX_NAME = 'idx_cc_process') = 0,
  'CREATE INDEX idx_cc_process ON cost_centre_master(process_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 6. Add migration_complete flag to track if all orphans have been migrated ─
-- This is tracked via query, not a column - cost centres with NULL client_id/lob_id/branch_id/process_id are considered orphaned
