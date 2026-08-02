-- Migration 402: Add bulk payslip tracking columns to salary_prep_line
-- These columns let the bulk-outputs module track generation and email delivery per payslip

ALTER TABLE salary_prep_line
  ADD COLUMN payslip_generated    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN payslip_generated_at DATETIME NULL,
  ADD COLUMN payslip_emailed      TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN payslip_emailed_at   DATETIME NULL;

-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_spl_payslip_gen = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND INDEX_NAME = 'idx_spl_payslip_gen'
);
SET @col_idx_spl_payslip_gen = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME IN ('run_id', 'payslip_generated')
);
SET @sql = IF(@idx_idx_spl_payslip_gen = 0 AND @col_idx_spl_payslip_gen = 2,
  'CREATE INDEX idx_spl_payslip_gen ON salary_prep_line (run_id, payslip_generated)',
  'SELECT ''idx_spl_payslip_gen skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
