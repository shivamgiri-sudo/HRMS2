-- Migration 341: Dashboard Metric Targets
-- Additive — does not modify any existing table.
-- Purpose: store org/branch/process-level targets for dashboard metric tiles
--          so that trend, variance, and status can be computed at render time.

CREATE TABLE IF NOT EXISTS dashboard_metric_target (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()),
  metric_code     VARCHAR(100)   NOT NULL COMMENT 'e.g. attendance_rate, avg_calls_per_agent, headcount',
  dashboard_code  VARCHAR(100)   NULL     COMMENT 'e.g. CEO_DASHBOARD, WFM_DASHBOARD — null = applies to all',
  branch_id       CHAR(36)       NULL     COMMENT 'null = org-wide',
  process_id      CHAR(36)       NULL     COMMENT 'null = all processes in branch',
  target_value    DECIMAL(15,4)  NOT NULL,
  target_period   ENUM('daily','weekly','monthly','annual') NOT NULL DEFAULT 'monthly',
  effective_from  DATE           NOT NULL,
  effective_to    DATE           NULL     COMMENT 'null = open-ended (current target)',
  created_by      CHAR(36)       NULL,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_target_lookup  (metric_code, target_period, effective_from),
  INDEX idx_target_scope   (branch_id, process_id),
  INDEX idx_target_dash    (dashboard_code, metric_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Configurable metric targets for dashboard tiles — supports org/branch/process hierarchy';
