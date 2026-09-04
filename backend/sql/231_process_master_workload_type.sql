-- ============================================================
-- Migration 231: process_master — add workload_type + workload_config
--
-- The existing process_type ENUM('INBOUND','OUTBOUND',...) is a
-- different coarse-grained classification. We add a new workload_type
-- column with the fine-grained WFM planning values.
-- The old process_type is NOT touched.
--
-- workload_config JSON stores blended sub-types for blended processes:
--   {"sub_types":["inbound_voice","chat"]} for a blended voice+chat floor.
--
-- SAFE: ADD COLUMN IF NOT EXISTS, nullable with NULL default.
--
-- ROLLBACK:
--   ALTER TABLE process_master
--     DROP COLUMN IF EXISTS workload_type,
--     DROP COLUMN IF EXISTS workload_config;
--   DROP INDEX IF EXISTS idx_pm_workload_type ON process_master;
-- ============================================================

SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_master' AND COLUMN_NAME = 'workload_type'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE process_master ADD COLUMN workload_type ENUM(
    ''inbound_voice'',
    ''outbound_voice'',
    ''chat'',
    ''email'',
    ''backoffice'',
    ''data_verification'',
    ''audit_quality'',
    ''blended''
  ) NULL COMMENT ''WFM planning workload classification — drives HC formula selection''
  AFTER process_name',
  'SELECT "workload_type already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_master' AND COLUMN_NAME = 'workload_config'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE process_master ADD COLUMN workload_config JSON NULL
    COMMENT ''For blended processes: {"sub_types":["inbound_voice","chat"]}',
  'SELECT "workload_config already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2; for outbound: {"campaign_target_type":"sales"}'
  AFTER workload_type;

ALTER TABLE process_master
  ADD INDEX IF NOT EXISTS idx_pm_workload_type (workload_type);

SELECT '231_process_master_workload_type.sql applied successfully' AS migration_status;
