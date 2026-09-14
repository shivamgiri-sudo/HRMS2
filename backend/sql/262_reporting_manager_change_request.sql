-- Extend profile_update_approval to track branch for WFM scoping
SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profile_update_approval' AND COLUMN_NAME = 'branch_id'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE profile_update_approval ADD COLUMN branch_id VARCHAR(36) NULL COMMENT ''Branch of employee — used for WFM scoping''',
  'SELECT "branch_id already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profile_update_approval' AND COLUMN_NAME = 'pending_manager_id'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE profile_update_approval ADD COLUMN pending_manager_id VARCHAR(36) NULL COMMENT ''Proposed reporting_manager_id (for reporting_manager_change type)''',
  'SELECT "pending_manager_id already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @midx_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profile_update_approval' AND INDEX_NAME = 'idx_branch_status'
);
SET @midxsql_3 = IF(@midx_3 = 0,
  'ALTER TABLE profile_update_approval ADD KEY idx_branch_status (branch_id, status)',
  'SELECT "idx_branch_status already exists" AS message');
PREPARE midxstmt_3 FROM @midxsql_3;
EXECUTE midxstmt_3;
DEALLOCATE PREPARE midxstmt_3;
