-- Migration 402: Add bulk payslip tracking columns to salary_prep_line
-- These columns let the bulk-outputs module track generation and email delivery per payslip
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` are MariaDB
-- syntax, rejected by this production MySQL 8.0.42 build with ER_PARSE_ERROR. Recorded as
-- `success=1` since 2026-07-20 despite the last two columns and the index never actually
-- being created — payslip_generated / payslip_generated_at exist (added by a separate path
-- before this file's failure point), but payslip_emailed / payslip_emailed_at do not, which
-- is what breaks the two mounted endpoints that read them (see runPendingMigrations.ts Gate 3
-- comment). Each statement below is independently guarded, so this is safe to run regardless
-- of which columns already exist.
SET @c_payslip_generated = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'payslip_generated'
);
SET @sql = IF(@c_payslip_generated = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN payslip_generated TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT "payslip_generated already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_payslip_generated_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'payslip_generated_at'
);
SET @sql = IF(@c_payslip_generated_at = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN payslip_generated_at DATETIME NULL',
  'SELECT "payslip_generated_at already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_payslip_emailed = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'payslip_emailed'
);
SET @sql = IF(@c_payslip_emailed = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN payslip_emailed TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT "payslip_emailed already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_payslip_emailed_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'payslip_emailed_at'
);
SET @sql = IF(@c_payslip_emailed_at = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN payslip_emailed_at DATETIME NULL',
  'SELECT "payslip_emailed_at already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @i_payslip_gen = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND INDEX_NAME = 'idx_spl_payslip_gen'
);
SET @sql = IF(@i_payslip_gen = 0,
  'ALTER TABLE salary_prep_line ADD INDEX idx_spl_payslip_gen (run_id, payslip_generated)',
  'SELECT "idx_spl_payslip_gen already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
