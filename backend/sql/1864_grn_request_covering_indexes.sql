-- 1864_grn_request_covering_indexes.sql
-- Two covering indexes on grn_request so the GRN status summary and the daily GRN trend are answered
-- from the index instead of ~83k random reads of wide rows (summary took 15s, daily GRN 3s).
--   idx_grn_status_cover  (status, grn_number, branch_id, cost_centre_id, amount_with_tax, amount)
--     serves the GRN list count / status summary (they filter on grn_number, branch and cost centre
--     and sum the gross amount, grouped by status).
--   idx_grn_bill_date_amount (bill_date, amount_without_tax)
--     serves the P&L daily trend's GRN-by-day read.
-- ADDITIVE ONLY: secondary indexes, built online. Guarded through information_schema (no
-- CREATE INDEX IF NOT EXISTS on this MySQL). Idempotent: safe to apply repeatedly.

SET @gr_sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request') = 0
  OR (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request' AND INDEX_NAME = 'idx_grn_status_cover') > 0,
  'SELECT 1',
  'ALTER TABLE grn_request ADD INDEX idx_grn_status_cover (status, grn_number, branch_id, cost_centre_id, amount_with_tax, amount)');
PREPARE gr_stmt FROM @gr_sql;
EXECUTE gr_stmt;
DEALLOCATE PREPARE gr_stmt;

SET @gr_sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request') = 0
  OR (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request' AND INDEX_NAME = 'idx_grn_bill_date_amount') > 0,
  'SELECT 1',
  'ALTER TABLE grn_request ADD INDEX idx_grn_bill_date_amount (bill_date, amount_without_tax)');
PREPARE gr_stmt FROM @gr_sql;
EXECUTE gr_stmt;
DEALLOCATE PREPARE gr_stmt;
