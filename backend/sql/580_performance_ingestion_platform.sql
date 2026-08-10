-- Migration 580: Governed multi-source performance ingestion platform
-- Additive only. No external source is activated and no KPI facts are modified by this migration.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS performance_source_dataset (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()),
  dataset_key           VARCHAR(100)  NOT NULL,
  dataset_name          VARCHAR(255)  NOT NULL,
  source_type           VARCHAR(30)   NOT NULL,
  connector_key         VARCHAR(100)  NULL,
  source_entity         VARCHAR(255)  NULL,
  process_id            CHAR(36)      NULL,
  branch_id             CHAR(36)      NULL,
  timezone_name         VARCHAR(64)   NOT NULL DEFAULT 'Asia/Kolkata',
  config_json           JSON          NOT NULL,
  mapping_json          JSON          NOT NULL,
  schedule_cron         VARCHAR(100)  NULL,
  approval_status       VARCHAR(20)   NOT NULL DEFAULT 'draft',
  active_status         TINYINT(1)    NOT NULL DEFAULT 1,
  created_by            CHAR(36)      NULL,
  approved_by           CHAR(36)      NULL,
  approved_at           DATETIME      NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_performance_dataset_key (dataset_key),
  INDEX idx_performance_dataset_source (source_type, connector_key, active_status),
  INDEX idx_performance_dataset_scope (process_id, branch_id, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_mapping_version (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()),
  dataset_id            CHAR(36)      NOT NULL,
  version_no            INT UNSIGNED  NOT NULL,
  mapping_json          JSON          NOT NULL,
  effective_from        DATE          NOT NULL,
  effective_to          DATE          NULL,
  status                VARCHAR(20)   NOT NULL DEFAULT 'draft',
  approved_by           CHAR(36)      NULL,
  approved_at           DATETIME      NULL,
  created_by            CHAR(36)      NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_performance_mapping_version (dataset_id, version_no),
  INDEX idx_performance_mapping_effective (dataset_id, status, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_identity_map (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()),
  source_key            VARCHAR(100)  NOT NULL,
  external_identifier   VARCHAR(255)  NOT NULL,
  identifier_type       VARCHAR(50)   NOT NULL DEFAULT 'client_login',
  employee_id           CHAR(36)      NOT NULL,
  process_id            CHAR(36)      NULL,
  mapping_method        VARCHAR(30)   NOT NULL DEFAULT 'manual',
  confidence_pct        DECIMAL(5,2)  NULL,
  mapping_status        VARCHAR(20)   NOT NULL DEFAULT 'verified',
  effective_from        DATE          NOT NULL,
  effective_to          DATE          NULL,
  verified_by           CHAR(36)      NULL,
  verified_at           DATETIME      NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_performance_identity_effective (source_key, external_identifier, effective_from),
  INDEX idx_performance_identity_lookup (source_key, external_identifier, mapping_status, effective_from, effective_to),
  INDEX idx_performance_identity_employee (employee_id, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_process_map (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()),
  source_key            VARCHAR(100)  NOT NULL,
  external_process      VARCHAR(255)  NOT NULL,
  process_id            CHAR(36)      NOT NULL,
  branch_id             CHAR(36)      NULL,
  effective_from        DATE          NOT NULL,
  effective_to          DATE          NULL,
  mapping_status        VARCHAR(20)   NOT NULL DEFAULT 'verified',
  verified_by           CHAR(36)      NULL,
  verified_at           DATETIME      NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_performance_process_effective (source_key, external_process, effective_from),
  INDEX idx_performance_process_lookup (source_key, external_process, mapping_status, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_ingestion_run (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()),
  dataset_id            CHAR(36)      NOT NULL,
  mapping_version_id    CHAR(36)      NULL,
  run_mode              VARCHAR(20)   NOT NULL DEFAULT 'preview',
  trigger_type          VARCHAR(20)   NOT NULL DEFAULT 'manual',
  status                VARCHAR(30)   NOT NULL DEFAULT 'queued',
  window_from           DATETIME      NULL,
  window_to             DATETIME      NULL,
  checkpoint_in         VARCHAR(500)  NULL,
  checkpoint_out        VARCHAR(500)  NULL,
  source_file_name      VARCHAR(500)  NULL,
  source_file_hash      CHAR(64)      NULL,
  source_row_count      INT UNSIGNED  NOT NULL DEFAULT 0,
  staged_row_count      INT UNSIGNED  NOT NULL DEFAULT 0,
  mapped_row_count      INT UNSIGNED  NOT NULL DEFAULT 0,
  invalid_row_count     INT UNSIGNED  NOT NULL DEFAULT 0,
  published_fact_count  INT UNSIGNED  NOT NULL DEFAULT 0,
  error_count           INT UNSIGNED  NOT NULL DEFAULT 0,
  error_summary         TEXT          NULL,
  metadata_json         JSON          NULL,
  requested_by          CHAR(36)      NULL,
  started_at            DATETIME      NULL,
  finished_at           DATETIME      NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_performance_run_dataset (dataset_id, created_at),
  INDEX idx_performance_run_status (status, run_mode, created_at),
  INDEX idx_performance_run_file_hash (dataset_id, source_file_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_ingestion_checkpoint (
  dataset_id             CHAR(36)      NOT NULL,
  checkpoint_value       VARCHAR(500)  NULL,
  last_successful_run_id CHAR(36)      NULL,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (dataset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_raw_record (
  id                           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id                       CHAR(36)        NOT NULL,
  source_record_key            VARCHAR(500)    NULL,
  source_event_date            DATE            NULL,
  external_employee_identifier VARCHAR(255)    NULL,
  external_process_identifier  VARCHAR(255)    NULL,
  source_row_json              JSON            NOT NULL,
  row_hash                     CHAR(64)        NOT NULL,
  created_at                   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_performance_raw_run_hash (run_id, row_hash),
  INDEX idx_performance_raw_run (run_id, id),
  INDEX idx_performance_raw_identity (external_employee_identifier, source_event_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_validation_result (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id                CHAR(36)        NOT NULL,
  raw_record_id         BIGINT UNSIGNED NULL,
  validation_code       VARCHAR(100)    NOT NULL,
  severity              VARCHAR(20)     NOT NULL DEFAULT 'error',
  field_name            VARCHAR(255)    NULL,
  invalid_value         VARCHAR(1000)   NULL,
  validation_message    VARCHAR(1000)   NOT NULL,
  resolution_status     VARCHAR(20)     NOT NULL DEFAULT 'open',
  resolved_by           CHAR(36)        NULL,
  resolved_at           DATETIME        NULL,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_performance_validation_run (run_id, severity, resolution_status),
  INDEX idx_performance_validation_record (raw_record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_reconciliation_result (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()),
  run_id                CHAR(36)      NOT NULL,
  reconciliation_code   VARCHAR(100)  NOT NULL,
  expected_value        DECIMAL(20,6) NULL,
  actual_value          DECIMAL(20,6) NULL,
  variance_value        DECIMAL(20,6) NULL,
  tolerance_value       DECIMAL(20,6) NULL,
  passed                TINYINT(1)    NOT NULL DEFAULT 0,
  detail_json           JSON          NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_performance_reconciliation (run_id, reconciliation_code),
  INDEX idx_performance_reconciliation_run (run_id, passed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_publication_batch (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()),
  run_id                CHAR(36)      NOT NULL,
  status                VARCHAR(20)   NOT NULL DEFAULT 'publishing',
  published_fact_count  INT UNSIGNED  NOT NULL DEFAULT 0,
  superseded_fact_count INT UNSIGNED  NOT NULL DEFAULT 0,
  published_by          CHAR(36)      NULL,
  published_at          DATETIME      NULL,
  rolled_back_by        CHAR(36)      NULL,
  rolled_back_at        DATETIME      NULL,
  rollback_reason       VARCHAR(1000) NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_performance_publication_run (run_id),
  INDEX idx_performance_publication_status (status, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_fact_lineage (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  publication_batch_id  CHAR(36)        NOT NULL,
  run_id                CHAR(36)        NOT NULL,
  raw_record_id         BIGINT UNSIGNED NULL,
  employee_id           CHAR(36)        NOT NULL,
  metric_id             CHAR(36)        NOT NULL,
  score_date            DATE            NOT NULL,
  source_record_key     VARCHAR(500)    NULL,
  actual_value          DECIMAL(20,6)   NULL,
  numerator_value       DECIMAL(20,6)   NULL,
  denominator_value     DECIMAL(20,6)   NULL,
  calculation_multiplier DECIMAL(20,6)  NULL,
  source_event_timestamp DATETIME       NULL,
  source_record_count   INT UNSIGNED    NULL,
  process_id_at_event   CHAR(36)        NULL,
  branch_id_at_event    CHAR(36)        NULL,
  lineage_status        VARCHAR(20)     NOT NULL DEFAULT 'current',
  superseded_by_id      BIGINT UNSIGNED NULL,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_performance_lineage_fact (employee_id, metric_id, score_date, lineage_status),
  INDEX idx_performance_lineage_batch (publication_batch_id, run_id),
  INDEX idx_performance_lineage_latest (employee_id, metric_id, score_date, source_event_timestamp, source_record_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dynamic metric presentation and aggregation metadata.
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'aggregation_method'), 'SELECT 1', 'ALTER TABLE kpi_metric_master ADD COLUMN aggregation_method VARCHAR(30) NOT NULL DEFAULT ''average'' AFTER direction');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'decimal_places'), 'SELECT 1', 'ALTER TABLE kpi_metric_master ADD COLUMN decimal_places TINYINT UNSIGNED NOT NULL DEFAULT 2 AFTER aggregation_method');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'display_order'), 'SELECT 1', 'ALTER TABLE kpi_metric_master ADD COLUMN display_order INT NOT NULL DEFAULT 100 AFTER decimal_places');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'minimum_sample_size'), 'SELECT 1', 'ALTER TABLE kpi_metric_master ADD COLUMN minimum_sample_size INT UNSIGNED NULL AFTER display_order');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'max_achievement_pct'), 'SELECT 1', 'ALTER TABLE kpi_metric_master ADD COLUMN max_achievement_pct DECIMAL(8,2) NOT NULL DEFAULT 120 AFTER minimum_sample_size');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'role_visibility_json'), 'SELECT 1', 'ALTER TABLE kpi_metric_master ADD COLUMN role_visibility_json JSON NULL AFTER max_achievement_pct');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'missing_data_behavior'), 'SELECT 1', 'ALTER TABLE kpi_metric_master ADD COLUMN missing_data_behavior VARCHAR(30) NOT NULL DEFAULT ''exclude'' AFTER role_visibility_json');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add full source lineage to canonical daily KPI facts.
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'source_dataset_id'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD COLUMN source_dataset_id CHAR(36) NULL AFTER source_system');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'source_record_key'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD COLUMN source_record_key VARCHAR(500) NULL AFTER source_dataset_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'mapping_version_id'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD COLUMN mapping_version_id CHAR(36) NULL AFTER source_record_key');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'publication_batch_id'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD COLUMN publication_batch_id CHAR(36) NULL AFTER mapping_version_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'process_id_at_event'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD COLUMN process_id_at_event CHAR(36) NULL AFTER publication_batch_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'branch_id_at_event'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD COLUMN branch_id_at_event CHAR(36) NULL AFTER process_id_at_event');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'team_leader_id_at_event'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD COLUMN team_leader_id_at_event CHAR(36) NULL AFTER branch_id_at_event');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'published_at'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD COLUMN published_at DATETIME NULL AFTER computed_at');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'calculation_multiplier'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD COLUMN calculation_multiplier DECIMAL(20,6) NULL AFTER source_record_count');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND INDEX_NAME = 'idx_kpi_daily_dataset_date'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD INDEX idx_kpi_daily_dataset_date (source_dataset_id, score_date)');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND INDEX_NAME = 'idx_kpi_daily_publication'), 'SELECT 1', 'ALTER TABLE kpi_daily_actual ADD INDEX idx_kpi_daily_publication (publication_batch_id)');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Safe defaults for existing standard metrics.
UPDATE kpi_metric_master SET aggregation_method = 'sum', display_order = 10 WHERE metric_code IN ('DIALS', 'CALLS', 'SALES_COUNT', 'REVENUE');
UPDATE kpi_metric_master SET aggregation_method = 'ratio', display_order = 20 WHERE metric_code IN ('AHT', 'TALK_TIME', 'ACW', 'QUALITY_SCORE', 'FATAL_RATE', 'CONVERSION_RATE', 'AOV', 'COD_SHARE', 'RTO_RATE', 'ADHERENCE', 'UTILIZATION', 'ATTENDANCE_PCT');

-- VERIFY AFTER STAGING EXECUTION:
-- SHOW TABLES LIKE 'performance_ingestion_run';
-- SHOW COLUMNS FROM kpi_daily_actual LIKE 'source_dataset_id';
-- SHOW COLUMNS FROM kpi_metric_master LIKE 'aggregation_method';
