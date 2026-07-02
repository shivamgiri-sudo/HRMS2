-- 019_performance_surfaces.sql
-- Package 5: Management KPI summary, coaching sessions, performance alerts.
-- Additive only. Do not execute on production without explicit approval.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS management_kpi_summary (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)       NOT NULL,
  period          VARCHAR(7)     NOT NULL,
  template_id     CHAR(36),
  overall_score   DECIMAL(5,2),
  rank_position   INT,
  trend           ENUM('up','down','stable') DEFAULT 'stable',
  computed_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mks (employee_id, period, template_id),
  INDEX idx_mks_emp_period (employee_id, period),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coaching_session (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)       NOT NULL,
  coach_user_id   CHAR(36)       NOT NULL,
  session_date    DATE           NOT NULL,
  session_type    ENUM('performance','quality','development','pip') NOT NULL DEFAULT 'performance',
  notes           TEXT,
  action_items    JSON,
  status          ENUM('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_coach_emp (employee_id),
  INDEX idx_coach_date (session_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS performance_alert (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)       NOT NULL,
  alert_type      VARCHAR(100)   NOT NULL,
  severity        ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  message         TEXT,
  acknowledged    TINYINT(1)     NOT NULL DEFAULT 0,
  acknowledged_by CHAR(36),
  acknowledged_at DATETIME,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_alert_emp (employee_id),
  INDEX idx_alert_severity (severity),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
