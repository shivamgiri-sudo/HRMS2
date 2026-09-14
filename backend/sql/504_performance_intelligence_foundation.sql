-- Migration 504: Performance Intelligence Hub foundation
-- Additive only. Do not execute against production without explicit approval.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS kpi_formula_version (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  formula_code      VARCHAR(50)  NOT NULL,
  version_no        INT UNSIGNED NOT NULL,
  metric_code       VARCHAR(50)  NOT NULL,
  formula_expression VARCHAR(1000) NOT NULL,
  numerator_definition VARCHAR(500) NULL,
  denominator_definition VARCHAR(500) NULL,
  source_system     VARCHAR(50)  NOT NULL,
  effective_from    DATE         NOT NULL,
  effective_to      DATE         NULL,
  status            ENUM('draft', 'active', 'retired') NOT NULL DEFAULT 'draft',
  approved_by       CHAR(36)     NULL,
  approved_at       DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_formula_version (formula_code, version_no),
  INDEX idx_kpi_formula_metric_status (metric_code, status, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_mapping_exception (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()),
  integration_run_id    CHAR(36)     NULL,
  source_system         VARCHAR(50)  NOT NULL,
  source_entity         VARCHAR(100) NOT NULL,
  external_identifier   VARCHAR(255) NOT NULL,
  exception_type        ENUM('employee_unmapped', 'process_unmapped', 'branch_unmapped', 'metric_unmapped', 'invalid_value') NOT NULL,
  exception_detail      VARCHAR(1000) NULL,
  status                ENUM('open', 'resolved', 'ignored') NOT NULL DEFAULT 'open',
  resolved_employee_id  CHAR(36)     NULL,
  resolved_process_id   CHAR(36)     NULL,
  resolved_branch_id    CHAR(36)     NULL,
  resolved_by           CHAR(36)     NULL,
  resolved_at           DATETIME     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mapping_exception_run (
    source_system,
    source_entity,
    external_identifier,
    exception_type,
    integration_run_id
  ),
  INDEX idx_mapping_exception_status (status, source_system, exception_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO kpi_metric_master (
  metric_code,
  metric_name,
  category,
  unit,
  direction
) VALUES (
  'UTILIZATION',
  'Agent Utilization',
  'operations',
  'percent',
  'higher_is_better'
);
-- MySQL 8 does not provide a portable ADD COLUMN IF NOT EXISTS form across all
-- supported deployments, so each additive change is guarded through metadata.
SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'numerator_value'
  ),
  'SELECT 1',
  'ALTER TABLE kpi_daily_actual ADD COLUMN numerator_value DECIMAL(18,6) NULL AFTER actual_value'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'denominator_value'
  ),
  'SELECT 1',
  'ALTER TABLE kpi_daily_actual ADD COLUMN denominator_value DECIMAL(18,6) NULL AFTER numerator_value'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'source_system'
  ),
  'SELECT 1',
  'ALTER TABLE kpi_daily_actual ADD COLUMN source_system VARCHAR(50) NULL AFTER source'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'source_record_count'
  ),
  'SELECT 1',
  'ALTER TABLE kpi_daily_actual ADD COLUMN source_record_count INT UNSIGNED NULL AFTER source_system'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'formula_version_id'
  ),
  'SELECT 1',
  'ALTER TABLE kpi_daily_actual ADD COLUMN formula_version_id CHAR(36) NULL AFTER source_record_count'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'integration_run_id'
  ),
  'SELECT 1',
  'ALTER TABLE kpi_daily_actual ADD COLUMN integration_run_id CHAR(36) NULL AFTER formula_version_id'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'computed_at'
  ),
  'SELECT 1',
  'ALTER TABLE kpi_daily_actual ADD COLUMN computed_at DATETIME NULL AFTER integration_run_id'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND INDEX_NAME = 'idx_kpi_daily_metric_date'
  ),
  'SELECT 1',
  'ALTER TABLE kpi_daily_actual ADD INDEX idx_kpi_daily_metric_date (metric_id, score_date)'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND INDEX_NAME = 'idx_kpi_daily_run'
  ),
  'SELECT 1',
  'ALTER TABLE kpi_daily_actual ADD INDEX idx_kpi_daily_run (integration_run_id)'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO kpi_formula_version (
  formula_code,
  version_no,
  metric_code,
  formula_expression,
  numerator_definition,
  denominator_definition,
  source_system,
  effective_from,
  status
) VALUES
  ('CALLS_TOTAL', 1, 'DIALS', 'SUM(answered_or_connected_calls)', 'answered_or_connected_calls', NULL, 'call_master', '2026-07-01', 'draft'),
  ('AHT_WEIGHTED', 1, 'AHT', 'SUM(handle_seconds) / NULLIF(SUM(handled_calls), 0)', 'handle_seconds', 'handled_calls', 'apr', '2026-07-01', 'draft'),
  ('ADHERENCE_RATE', 1, 'ADHERENCE', 'SUM(adherent_seconds) / NULLIF(SUM(scheduled_seconds), 0) * 100', 'adherent_seconds', 'scheduled_seconds', 'wfm', '2026-07-01', 'draft'),
  ('UTILIZATION_RATE', 1, 'UTILIZATION', 'SUM(productive_seconds) / NULLIF(SUM(net_login_seconds), 0) * 100', 'productive_seconds', 'net_login_seconds', 'apr', '2026-07-01', 'draft'),
  ('QUALITY_WEIGHTED', 1, 'QUALITY_SCORE', 'SUM(points_earned) / NULLIF(SUM(points_possible), 0) * 100', 'points_earned', 'points_possible', 'quality', '2026-07-01', 'draft'),
  ('FATAL_RATE', 1, 'FATAL_RATE', 'SUM(fatal_audits) / NULLIF(SUM(audited_calls), 0) * 100', 'fatal_audits', 'audited_calls', 'quality', '2026-07-01', 'draft'),
  ('CONVERSION_RATE', 1, 'CONVERSION_RATE', 'SUM(converted_sales) / NULLIF(SUM(eligible_contacts), 0) * 100', 'converted_sales', 'eligible_contacts', 'sales', '2026-07-01', 'draft');

-- VERIFY AFTER STAGING EXECUTION:
-- SELECT formula_code, version_no, status FROM kpi_formula_version ORDER BY formula_code;
-- SHOW COLUMNS FROM kpi_daily_actual LIKE 'numerator_value';
-- SHOW INDEX FROM integration_mapping_exception WHERE Key_name = 'idx_mapping_exception_status';
