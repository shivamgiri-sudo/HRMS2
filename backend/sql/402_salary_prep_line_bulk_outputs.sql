-- Migration 402: Add bulk payslip tracking columns to salary_prep_line
-- These columns let the bulk-outputs module track generation and email delivery per payslip

ALTER TABLE salary_prep_line
  ADD COLUMN IF NOT EXISTS payslip_generated    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_generated_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS payslip_emailed      TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_emailed_at   DATETIME NULL;

CREATE INDEX IF NOT EXISTS idx_spl_payslip_gen
  ON salary_prep_line (run_id, payslip_generated);
