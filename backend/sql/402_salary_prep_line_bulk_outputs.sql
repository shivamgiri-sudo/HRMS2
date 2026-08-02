-- Migration 402: Add bulk payslip tracking columns to salary_prep_line
-- These columns let the bulk-outputs module track generation and email delivery per payslip

ALTER TABLE salary_prep_line
  ADD COLUMN payslip_generated    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN payslip_generated_at DATETIME NULL,
  ADD COLUMN payslip_emailed      TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN payslip_emailed_at   DATETIME NULL;

-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_spl_payslip_gen = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND INDEX_NAME = 'idx_spl_payslip_gen'
);
SET @sql = IF(@idx_idx_spl_payslip_gen = 0,
  'CREATE INDEX idx_spl_payslip_gen ON salary_prep_line (run_id, payslip_generated)',
  'SELECT ''idx_spl_payslip_gen already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
