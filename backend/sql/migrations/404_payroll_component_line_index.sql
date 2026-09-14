-- Migration: Add composite index on salary_prep_line_component.line_id for batch lookups
-- Part of payroll workspace N+1 fix: batch component fetch instead of per-line queries

CREATE INDEX IF NOT EXISTS idx_splc_line_id
  ON salary_prep_line_component (line_id);
