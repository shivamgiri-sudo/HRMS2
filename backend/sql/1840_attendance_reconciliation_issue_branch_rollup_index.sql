-- 1840_attendance_reconciliation_issue_branch_rollup_index.sql
--
-- Speeds up the Ops Control Tower's "Attendance mismatched" block
-- (getAttendanceMismatchBlock, ops-control-tower.service.ts), which runs:
--   SELECT e.branch_id, SUM(ari.resolved_at IS NULL), MAX(ari.resolved_at)
--     FROM attendance_reconciliation_issue ari JOIN employees e ON e.id = ari.employee_id
--    GROUP BY e.branch_id
-- with no WHERE clause — every row is read to compute both the still-open count and the
-- last-corrected date per branch. Live 2026-09-22: this table holds a wide JSON payload column
-- (source_payload_json) the query never touches, so a full table scan reads far more bytes than
-- the two columns actually needed. First attempt through the app took 78s and errored; a retry
-- succeeded in ~12s, consistent with a full scan racing the reconciliation worker's writes.
--
-- None of migration 535's four existing indexes cover this: idx_att_recon_issue_employee is
-- (employee_id, issue_date), not resolved_at. This adds employee_id + resolved_at as a covering
-- index for the query above — the join key plus both aggregated columns, so MySQL can read the
-- index alone and skip the base table (and its JSON column) entirely. Idempotent (checks
-- information_schema, whose column values are UPPERCASE on mysql2) and additive: no column, no
-- data and no other index is touched. Standard InnoDB secondary-index add, ONLINE by default on
-- MySQL 8 (ALGORITHM=INPLACE, LOCK=NONE) — the reconciliation worker can keep writing while it
-- builds.
--
-- Owner approved 2026-09-22, after being shown the 78s failure live.

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_reconciliation_issue'
    AND INDEX_NAME = 'idx_att_recon_issue_employee_resolved'
);
SET @sql = IF(
  @idx = 0,
  'CREATE INDEX idx_att_recon_issue_employee_resolved ON attendance_reconciliation_issue (employee_id, resolved_at)',
  'SELECT ''idx_att_recon_issue_employee_resolved already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1840_attendance_reconciliation_issue_branch_rollup_index.sql applied' AS migration_status;
