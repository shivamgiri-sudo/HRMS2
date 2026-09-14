-- Migration 1002: Fix salary_register_audit_log schema conflict
-- Problem: Migration 306 defined different columns than what JCR service writes
-- Solution: Add missing columns expected by joining-control-room.service.ts lockSalaryRegister()
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` are MariaDB
-- syntax, rejected by this production MySQL 8.0.42 build with ER_PARSE_ERROR. All four columns
-- and the index already exist on production (confirmed via information_schema before this
-- fix), so this is a no-op guard rewrite. Not yet in MIGRATION_MANIFEST.
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_register_audit_log' AND COLUMN_NAME = 'candidate_id');
SET @sql = IF(@c1 = 0, 'ALTER TABLE salary_register_audit_log ADD COLUMN candidate_id INT NULL AFTER salary_register_id', 'SELECT "candidate_id already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_register_audit_log' AND COLUMN_NAME = 'actor_id');
SET @sql = IF(@c2 = 0, 'ALTER TABLE salary_register_audit_log ADD COLUMN actor_id INT NULL AFTER candidate_id', 'SELECT "actor_id already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_register_audit_log' AND COLUMN_NAME = 'action');
SET @sql = IF(@c3 = 0, 'ALTER TABLE salary_register_audit_log ADD COLUMN action VARCHAR(100) NULL AFTER actor_id', 'SELECT "action already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c4 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_register_audit_log' AND COLUMN_NAME = 'payload_json');
SET @sql = IF(@c4 = 0, 'ALTER TABLE salary_register_audit_log ADD COLUMN payload_json LONGTEXT NULL AFTER action', 'SELECT "payload_json already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add index for candidate lookups
SET @i1 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_register_audit_log' AND INDEX_NAME = 'idx_sral_candidate');
SET @sql = IF(@i1 = 0, 'ALTER TABLE salary_register_audit_log ADD INDEX idx_sral_candidate (candidate_id)', 'SELECT "idx_sral_candidate already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
