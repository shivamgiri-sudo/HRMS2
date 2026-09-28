-- 1863_grn_request_created_at_index.sql
-- The GRN list orders by created_at DESC LIMIT 30, and grn_request had no index on created_at, so
-- every page did a filesort over ~83k wide rows (about 3.5s before joins). ADDITIVE ONLY: one
-- secondary index, built online. Guarded through information_schema (no CREATE INDEX IF NOT EXISTS
-- on this MySQL). Idempotent: safe to apply repeatedly.

SET @gr_sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request') = 0
  OR (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request' AND INDEX_NAME = 'idx_grn_created_at') > 0,
  'SELECT 1',
  'ALTER TABLE grn_request ADD INDEX idx_grn_created_at (created_at)');
PREPARE gr_stmt FROM @gr_sql;
EXECUTE gr_stmt;
DEALLOCATE PREPARE gr_stmt;
