-- Migration 290: Dashboard Analytics Engine
-- Tables: dashboard_metric_catalog, dashboard_role_metric_config, dashboard_metric_snapshot, work_item, work_item_audit_log
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, INSERT IGNORE

CREATE TABLE IF NOT EXISTS dashboard_metric_catalog (
  id                CHAR(36)     NOT NULL,
  metric_code       VARCHAR(100) NOT NULL,
  metric_name       VARCHAR(255) NOT NULL,
  module_code       VARCHAR(50)  DEFAULT NULL,
  description       TEXT         DEFAULT NULL,
  data_source       VARCHAR(100) DEFAULT NULL,
  aggregation_fn    VARCHAR(50)  DEFAULT NULL,
  unit              VARCHAR(20)  DEFAULT NULL,
  higher_is_better  TINYINT(1)   NOT NULL DEFAULT 1,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_metric_code (metric_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dashboard_role_metric_config (
  id              CHAR(36)     NOT NULL,
  role_code       VARCHAR(50)  NOT NULL,
  dashboard_code  VARCHAR(100) NOT NULL,
  metric_code     VARCHAR(100) NOT NULL,
  display_order   INT          NOT NULL DEFAULT 0,
  is_primary      TINYINT(1)   NOT NULL DEFAULT 0,
  scope_level     VARCHAR(50)  NOT NULL DEFAULT 'BRANCH_ALL',
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_dash_metric (role_code, dashboard_code, metric_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dashboard_metric_snapshot (
  id              CHAR(36)       NOT NULL,
  metric_code     VARCHAR(100)   NOT NULL,
  scope_type      VARCHAR(50)    NOT NULL,
  scope_id        CHAR(36)       DEFAULT NULL,
  snapshot_date   DATE           NOT NULL,
  value           DECIMAL(18,4)  DEFAULT NULL,
  previous_value  DECIMAL(18,4)  DEFAULT NULL,
  trend           VARCHAR(10)    DEFAULT NULL,
  computed_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_metric_scope (metric_code, scope_type, scope_id, snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_item (
  id                  CHAR(36)     NOT NULL,
  item_type           VARCHAR(100) NOT NULL,
  title               VARCHAR(500) NOT NULL,
  description         TEXT         DEFAULT NULL,
  module_code         VARCHAR(50)  DEFAULT NULL,
  entity_type         VARCHAR(50)  DEFAULT NULL,
  entity_id           CHAR(36)     DEFAULT NULL,
  assigned_to_user_id CHAR(36)     DEFAULT NULL,
  assigned_to_role    VARCHAR(50)  DEFAULT NULL,
  branch_id           CHAR(36)     DEFAULT NULL,
  process_id          CHAR(36)     DEFAULT NULL,
  priority            VARCHAR(20)  NOT NULL DEFAULT 'medium',
  status              VARCHAR(30)  NOT NULL DEFAULT 'pending',
  due_at              DATETIME     DEFAULT NULL,
  completed_at        DATETIME     DEFAULT NULL,
  completed_by        CHAR(36)     DEFAULT NULL,
  escalation_level    INT          NOT NULL DEFAULT 0,
  created_by          CHAR(36)     DEFAULT NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_assigned_user (assigned_to_user_id),
  INDEX idx_status (status),
  INDEX idx_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_item_audit_log (
  id           CHAR(36)    NOT NULL,
  work_item_id CHAR(36)    NOT NULL,
  action       VARCHAR(50) NOT NULL,
  from_status  VARCHAR(30) DEFAULT NULL,
  to_status    VARCHAR(30) DEFAULT NULL,
  remarks      TEXT        DEFAULT NULL,
  performed_by CHAR(36)    DEFAULT NULL,
  performed_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_work_item (work_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
