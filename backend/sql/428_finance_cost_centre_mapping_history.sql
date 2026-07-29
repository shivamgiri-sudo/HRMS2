-- 428_finance_cost_centre_mapping_history.sql
-- Branch Budget foundation (PR 8): effective-dated cost-centre -> branch/process mapping
-- history. Additive, forward-only. cost_centre_master.branch_id/process_id remain the
-- "current mapping" columns (read by listActiveCostCentres and everything else that wants
-- today's state) and are kept in sync by cost-centre-mapping.service.ts's recordMappingChange();
-- this table is the audit trail that lets historical P&L reads eventually resolve "what was this
-- cost centre's branch/process as of period X" instead of always using today's mapping.
--
-- Rollback (manual, if ever needed before this ships to any environment):
--   DROP TABLE IF EXISTS finance_cost_centre_mapping_history;

CREATE TABLE IF NOT EXISTS finance_cost_centre_mapping_history (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cost_centre_id  CHAR(36) NOT NULL,
  branch_id       CHAR(36) NULL,
  process_id      CHAR(36) NULL,
  effective_from  DATE NOT NULL,
  effective_to    DATE NULL,
  change_reason   VARCHAR(255) NULL,
  created_by      CHAR(36) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cc_mapping_history_cost_centre
    FOREIGN KEY (cost_centre_id) REFERENCES cost_centre_master(id) ON DELETE CASCADE,
  INDEX idx_cc_mapping_history_cc_effective (cost_centre_id, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- cost_centre_master has diverged across deployment histories (see 423_cost_centre_lob_
-- compatibility.sql for the same pattern applied to cost_centre_code/cost_centre_name): some
-- installations never actually got a process_id column added to cost_centre_master despite
-- several existing Process P&L queries assuming one exists (COALESCE(..., ccm.process_id) in
-- bpo-pnl.service.ts / process-pnl.service.ts / bpo-pnl-allocation-overlay.service.ts). Ensure it
-- exists here — additive, nullable, no data loss — since this PR's own read/write path
-- (cost-centre-mapping.service.ts) needs it, and every other consumer benefits from it existing.
SET @has_process_id = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'cost_centre_master'
     AND column_name = 'process_id'
);
SET @sql = IF(
  @has_process_id = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN process_id CHAR(36) NULL, ADD INDEX idx_ccm_process_id (process_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: one open-ended history row per existing cost centre, matching its current mapping.
-- Nothing changes behaviorally until someone records a real change via recordMappingChange().
INSERT INTO finance_cost_centre_mapping_history
  (id, cost_centre_id, branch_id, process_id, effective_from, effective_to, change_reason, created_by)
SELECT
  UUID(),
  ccm.id,
  ccm.branch_id,
  ccm.process_id,
  COALESCE(ccm.go_live_date, '2000-01-01'),
  NULL,
  'Backfilled from existing cost_centre_master mapping',
  NULL
FROM cost_centre_master ccm
WHERE NOT EXISTS (
  SELECT 1 FROM finance_cost_centre_mapping_history h WHERE h.cost_centre_id = ccm.id
);
