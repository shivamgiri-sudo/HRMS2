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
--     DROP COLUMN workload_type,
--     DROP COLUMN workload_config;
--   DROP INDEX idx_pm_workload_type ON process_master;
-- ============================================================

ALTER TABLE process_master
  ADD COLUMN workload_type ENUM(
    'inbound_voice',
    'outbound_voice',
    'chat',
    'email',
    'backoffice',
    'data_verification',
    'audit_quality',
    'blended'
  ) NULL COMMENT 'WFM planning workload classification — drives HC formula selection'
  AFTER process_name,

  ADD COLUMN workload_config JSON NULL
    COMMENT 'For blended processes: {"sub_types":["inbound_voice","chat"]}; for outbound: {"campaign_target_type":"sales"}'
  AFTER workload_type;

ALTER TABLE process_master
  ADD INDEX idx_pm_workload_type (workload_type);

SELECT '231_process_master_workload_type.sql applied successfully' AS migration_status;
