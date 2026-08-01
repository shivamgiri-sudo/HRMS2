-- Migration 1038: Add reason column to salary_prep_line_component
-- Stores human-readable reason for each earning/deduction component shown on payslips.
-- Nullable so all existing rows are unaffected.

ALTER TABLE salary_prep_line_component
  ADD COLUMN IF NOT EXISTS reason VARCHAR(500) NULL AFTER amount;
