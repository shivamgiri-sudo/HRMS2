-- 508_ats_onboarding_bridge_code_columns.sql
-- Adds employee_code and bridge_status columns to ats_onboarding_bridge.
-- These columns are written by employee-code-gate.routes.ts at code-generation time
-- but were never defined in any migration file, causing silent UPDATE failures on
-- fresh schema installs. This migration makes the schema match the runtime code.
-- Additive only — no existing columns altered, no data deleted.

SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_onboarding_bridge' AND COLUMN_NAME = 'employee_code'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE ats_onboarding_bridge ADD COLUMN employee_code  VARCHAR(30)  NULL          COMMENT ''Denormalized copy of generated employee code for quick gate queries''',
  'SELECT "employee_code already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_onboarding_bridge' AND COLUMN_NAME = 'bridge_status'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE ats_onboarding_bridge ADD COLUMN bridge_status  VARCHAR(50)  NOT NULL DEFAULT ''pending'' COMMENT ''Lifecycle: pending | code_generated | employee_created | activated''',
  'SELECT "bridge_status already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_onboarding_bridge' AND COLUMN_NAME = 'updated_at'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE ats_onboarding_bridge ADD COLUMN updated_at     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP COMMENT ''Last updated timestamp''',
  'SELECT "updated_at already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

-- Index for gate-check queries that filter by bridge_status
SET @midx_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_onboarding_bridge' AND INDEX_NAME = 'idx_aob_bridge_status'
);
SET @midxsql_4 = IF(@midx_4 = 0,
  'CREATE INDEX idx_aob_bridge_status ON ats_onboarding_bridge (bridge_status)',
  'SELECT "idx_aob_bridge_status already exists" AS message');
PREPARE midxstmt_4 FROM @midxsql_4;
EXECUTE midxstmt_4;
DEALLOCATE PREPARE midxstmt_4;
-- Index for reverse-lookup by employee_code
SET @midx_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_onboarding_bridge' AND INDEX_NAME = 'idx_aob_employee_code'
);
SET @midxsql_5 = IF(@midx_5 = 0,
  'CREATE INDEX idx_aob_employee_code ON ats_onboarding_bridge (employee_code)',
  'SELECT "idx_aob_employee_code already exists" AS message');
PREPARE midxstmt_5 FROM @midxsql_5;
EXECUTE midxstmt_5;
DEALLOCATE PREPARE midxstmt_5;
