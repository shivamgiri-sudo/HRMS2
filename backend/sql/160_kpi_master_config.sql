-- Migration 160: KPI Master Config
-- Creates 3 tables:
--   kpi_master_config       — define KPI targets at org-unit level (dept/designation/process/cost_centre)
--   kpi_employee_resolved   — cached resolved KPIs per employee (computed on-demand)
--   kpi_daily_actual        — daily actual metric values (enables Day/WTD/MTD trends)

CREATE TABLE IF NOT EXISTS kpi_master_config (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  metric_id       CHAR(36)       NOT NULL,
  org_unit_type   ENUM('department','designation','process','cost_centre') NOT NULL,
  org_unit_id     CHAR(36)       NOT NULL,
  target_value    DECIMAL(12,4)  NOT NULL,
  min_threshold   DECIMAL(12,4)  NULL,
  max_achievement DECIMAL(12,4)  NOT NULL DEFAULT 120,
  weightage       DECIMAL(5,2)   NOT NULL DEFAULT 100,
  is_active       TINYINT(1)     NOT NULL DEFAULT 1,
  created_by      CHAR(36)       NULL,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_org (metric_id, org_unit_type, org_unit_id),
  FOREIGN KEY (metric_id) REFERENCES kpi_metric_master(id)
);

CREATE TABLE IF NOT EXISTS kpi_employee_resolved (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)       NOT NULL,
  metric_id       CHAR(36)       NOT NULL,
  target_value    DECIMAL(12,4)  NOT NULL,
  min_threshold   DECIMAL(12,4)  NULL,
  max_achievement DECIMAL(12,4)  NOT NULL DEFAULT 120,
  weightage       DECIMAL(5,2)   NOT NULL DEFAULT 100,
  resolved_from   ENUM('process','cost_centre','designation','department') NOT NULL,
  resolved_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_metric (employee_id, metric_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (metric_id)   REFERENCES kpi_metric_master(id)
);

CREATE TABLE IF NOT EXISTS kpi_daily_actual (
  id           CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id  CHAR(36)      NOT NULL,
  metric_id    CHAR(36)      NOT NULL,
  score_date   DATE          NOT NULL,
  actual_value DECIMAL(12,4) NULL,
  source       ENUM('apr','attendance','quality','manual','calculated') NOT NULL DEFAULT 'manual',
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_metric_date (employee_id, metric_id, score_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (metric_id)   REFERENCES kpi_metric_master(id)
);
