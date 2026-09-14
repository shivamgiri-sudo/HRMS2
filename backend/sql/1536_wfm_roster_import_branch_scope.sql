-- Migration 1536: Whole-branch roster import
--
-- Today wfm_roster_import_batch.process_id is NOT NULL with a FK straight to
-- process_master(id), so every upload must be filed against exactly one
-- process even though roster-import.service.ts has matched employees purely
-- by employee_code (globally unique) since 2026-08-20 — process_id is
-- already optional at the application layer (see the doc comment on
-- createImportBatch's `processId` param), it just can't be omitted yet
-- because the column itself still refuses NULL.
--
-- This adds a branch_id alternative so a WFM user can upload one workbook for
-- an entire branch (all processes mixed in one sheet) instead of one process
-- at a time. Employee-code matching does not change — this only affects (a)
-- what the batch is filed under and (b) what "missing employees" is checked
-- against (getMissingEmployees in roster-import.service.ts).
--
-- Collation: branch_id is CHAR(36) COLLATE utf8mb4_unicode_ci to match
-- branch_master.id and employees.branch_id (verified live 2026-08-21) — the
-- same FK-collation trap already called out in 1500_wfm_roster_import_engine.sql
-- for this same table.

ALTER TABLE wfm_roster_import_batch
  MODIFY COLUMN process_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
  ADD COLUMN branch_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL AFTER process_id,
  ADD INDEX idx_branch (branch_id),
  ADD CONSTRAINT wfm_roster_import_batch_ibfk_branch
    FOREIGN KEY (branch_id) REFERENCES branch_master(id),
  -- A batch must be filed under a process, a branch, or both (branch selected
  -- but every employee still carries their own process) — never neither,
  -- which would make getMissingEmployees silently return nothing to check.
  ADD CONSTRAINT chk_batch_has_scope
    CHECK (process_id IS NOT NULL OR branch_id IS NOT NULL);
