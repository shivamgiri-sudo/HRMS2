-- 1847_process_lob_map.sql
-- Process-wise LOB mapping. lob_master is a flat global dictionary; nothing said which LOBs a
-- given process actually runs, so employees.lob_id (11 of ~59k set) had no valid-option list.
-- process_lob_map is that list: one row per (process, LOB). branch_id is denormalised from
-- process_master.branch_id at write time so branch-scoped WFM users can be filtered cheaply.
--
-- Deliberately NOT related to the finance tables process_lob_master / employee_lob_assignment
-- (P&L dimension) - those are untouched. No FK constraints: employees/process_master/lob_master
-- span mixed collations (see memory hrms2-new-table-collation-trap) and integrity is enforced
-- in process-lob-map.service.ts. Audit trail reuses audit_action_log (no new audit table).
--
-- Additive + idempotent: CREATE TABLE IF NOT EXISTS; the lob_master update touches one row.

CREATE TABLE IF NOT EXISTS process_lob_map (
  id            CHAR(36)   NOT NULL PRIMARY KEY,
  process_id    CHAR(36)   NOT NULL,
  lob_id        CHAR(36)   NOT NULL,
  branch_id     CHAR(36)   NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by    CHAR(36)   NULL,
  updated_by    CHAR(36)   NULL,
  created_at    DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_lob_map_process_lob (process_id, lob_id),
  INDEX idx_process_lob_map_branch (branch_id),
  INDEX idx_process_lob_map_lob (lob_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Retire the leftover test LOB (soft, reversible; only ever that one code).
UPDATE lob_master SET active_status = 0 WHERE lob_code = 'ZZTEST-LOB' AND active_status = 1;
