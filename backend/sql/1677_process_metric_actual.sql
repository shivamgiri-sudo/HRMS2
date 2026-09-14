-- Process-grain KPI values that HRMS cannot measure itself: entered by hand,
-- uploaded, or pulled from a client's own database through integration_config.
-- Deliberately NOT kpi_daily_actual: that table is per-employee and every
-- consumer inner-joins employees on it, so a process-wide figure (Prepaid %,
-- ROI, a GS1 TAT) has no honest employee_id to carry, and making employee_id
-- nullable there would silently drop rows from every existing inner join.
-- See docs/superpowers/specs/2026-09-07-process-data-source-architecture-design.md

CREATE TABLE IF NOT EXISTS process_metric_actual (
  id                   CHAR(36)      NOT NULL,
  process_id           CHAR(36)      NOT NULL,
  metric_key           VARCHAR(64)   NOT NULL,
  score_date           DATE          NOT NULL,
  actual_value         DECIMAL(18,4)     NULL,
  source               ENUM('manual','connector') NOT NULL DEFAULT 'manual',
  source_connector_key VARCHAR(64)       NULL,
  note                 TEXT              NULL,
  created_by           CHAR(36)          NULL,
  created_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_process_metric_date (process_id, metric_key, score_date),
  KEY idx_process_date (process_id, score_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tag a connector to one process. NULL keeps every existing estate-wide
-- connector (COSEC, dialer, db_bill) meaning exactly what it means today.
-- Guarded against re-running: an unguarded ALTER in a migration has taken this
-- production down once before.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'integration_config'
               AND COLUMN_NAME = 'process_id');
SET @sql := IF(@col = 0,
  'ALTER TABLE integration_config ADD COLUMN process_id CHAR(36) NULL AFTER integration_name',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'PROCESS_DATA_SOURCE', 'Process Data Sources', '/performance/process-data-sources', 'Performance', 1);

-- Write access (can_create/can_edit) only for the roles that own a process's own
-- numbers; everyone else on the dashboard's viewer list can read what was supplied.
-- Row scope is still enforced in SQL per request -- this grant is the page gate,
-- not the data boundary.
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',        'PROCESS_DATA_SOURCE', 1, 1, 1, 0, 1, 1),
  (UUID(), 'admin',              'PROCESS_DATA_SOURCE', 1, 1, 1, 0, 1, 1),
  (UUID(), 'ceo',                'PROCESS_DATA_SOURCE', 1, 0, 0, 0, 1, 1),
  (UUID(), 'coo',                'PROCESS_DATA_SOURCE', 1, 0, 0, 0, 1, 1),
  (UUID(), 'manager',            'PROCESS_DATA_SOURCE', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager',    'PROCESS_DATA_SOURCE', 1, 1, 1, 0, 1, 1),
  (UUID(), 'operations_manager', 'PROCESS_DATA_SOURCE', 1, 1, 1, 0, 1, 1),
  (UUID(), 'branch_head',        'PROCESS_DATA_SOURCE', 1, 0, 0, 0, 1, 1),
  (UUID(), 'qa',                 'PROCESS_DATA_SOURCE', 1, 0, 0, 0, 0, 1),
  (UUID(), 'quality_analyst',    'PROCESS_DATA_SOURCE', 1, 0, 0, 0, 0, 1),
  (UUID(), 'tq_head',            'PROCESS_DATA_SOURCE', 1, 0, 0, 0, 0, 1);
