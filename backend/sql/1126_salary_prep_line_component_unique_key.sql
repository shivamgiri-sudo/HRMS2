-- Migration 1126: unique constraint on salary_prep_line_component
--
-- payslip.service.ts deduplicates component rows in memory with a comment
-- "DB may contain duplicate rows from recalculations run before the unique key
-- was applied." This migration adds the key so the guard becomes unnecessary
-- going forward, and the dedup in the service remains as a safe backward-compat
-- layer for any rows that pre-date this migration.
--
-- The key is (run_id, line_id, component_code, component_type) — the four
-- columns that together identify one component entry on one payslip line.
-- employee_id is intentionally excluded: it is derivable from line_id and
-- including it would allow duplicate (run+line+code+type) rows to co-exist
-- for different employee_id values, which is the class of bug we are closing.
--
-- Safe to run on production: IF NOT EXISTS prevents re-execution.
-- Existing duplicates must be removed first — the dedup script
-- scripts/dedup-salary-prep-line-component.sql (companion to this migration)
-- should be run before applying this key.

ALTER TABLE salary_prep_line_component
  ADD CONSTRAINT uq_splc_run_line_code_type
    UNIQUE KEY (run_id, line_id, component_code, component_type);
