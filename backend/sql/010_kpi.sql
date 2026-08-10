-- 010_kpi.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS kpi_metric_master (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  metric_code  VARCHAR(50)  NOT NULL UNIQUE,
  metric_name  VARCHAR(255) NOT NULL,
  category     ENUM('operations','quality','sales','hr','custom') NOT NULL,
  unit         VARCHAR(50)  NOT NULL,
  direction    ENUM('higher_is_better','lower_is_better') NOT NULL,
  active_status TINYINT(1)  NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_kpi_metric_cat (category)
);

CREATE TABLE IF NOT EXISTS kpi_template (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_name VARCHAR(255) NOT NULL,
  description   TEXT,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kpi_template_metric (
  id           CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_id  CHAR(36)       NOT NULL,
  metric_id    CHAR(36)       NOT NULL,
  target_value DECIMAL(12,4)  NOT NULL,
  weight_pct   DECIMAL(5,2)   NOT NULL DEFAULT 0,
  UNIQUE KEY uq_tpl_metric (template_id, metric_id),
  FOREIGN KEY (template_id) REFERENCES kpi_template(id)        ON DELETE CASCADE,
  FOREIGN KEY (metric_id)   REFERENCES kpi_metric_master(id)   ON DELETE CASCADE
);

-- Assignment priority: employee > designation > department
CREATE TABLE IF NOT EXISTS kpi_assignment (
  id             CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_id    CHAR(36)  NOT NULL,
  designation_id CHAR(36),
  department_id  CHAR(36),
  employee_id    CHAR(36),
  active_status  TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES kpi_template(id) ON DELETE CASCADE,
  INDEX idx_kpi_asgn_emp  (employee_id),
  INDEX idx_kpi_asgn_desig (designation_id),
  INDEX idx_kpi_asgn_dept  (department_id)
);

CREATE TABLE IF NOT EXISTS kpi_score (
  id           CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id  CHAR(36)      NOT NULL,
  metric_id    CHAR(36)      NOT NULL,
  period       CHAR(7)       NOT NULL,  -- YYYY-MM
  actual_value DECIMAL(12,4) NOT NULL,
  source       VARCHAR(50)   NOT NULL DEFAULT 'manual',
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_score (employee_id, metric_id, period),
  FOREIGN KEY (employee_id) REFERENCES employees(id)          ON DELETE CASCADE,
  FOREIGN KEY (metric_id)   REFERENCES kpi_metric_master(id)  ON DELETE CASCADE,
  INDEX idx_kpi_score_period (period),
  INDEX idx_kpi_score_emp    (employee_id)
);

-- Seed standard BPO/callcenter metrics
INSERT INTO kpi_metric_master (metric_code, metric_name, category, unit, direction) VALUES
  ('AHT',              'Average Handle Time',      'operations', 'seconds',    'lower_is_better'),
  ('ACW',              'After Call Work',           'operations', 'seconds',    'lower_is_better'),
  ('ATTENDANCE_PCT',   'Attendance Percentage',     'hr',         'percent',    'higher_is_better'),
  ('CSAT',             'Customer Satisfaction',     'quality',    'percent',    'higher_is_better'),
  ('FCR',              'First Call Resolution',     'quality',    'percent',    'higher_is_better'),
  ('FATAL_RATE',       'Fatal Error Rate',          'quality',    'percent',    'lower_is_better'),
  ('QUALITY_SCORE',    'Quality Audit Score',       'quality',    'percent',    'higher_is_better'),
  ('CONVERSION_RATE',  'Sales Conversion Rate',     'sales',      'percent',    'higher_is_better'),
  ('REVENUE',          'Revenue Generated',         'sales',      'currency',   'higher_is_better'),
  ('DIALS',            'Total Dials',               'sales',      'count',      'higher_is_better'),
  ('ADHERENCE',        'Schedule Adherence',        'operations', 'percent',    'higher_is_better'),
  ('SHRINKAGE',        'Shrinkage Percentage',      'operations', 'percent',    'lower_is_better'),
  ('ESCALATIONS',      'Escalation Count',          'quality',    'count',      'lower_is_better'),
  ('HOLD_TIME',        'Average Hold Time',         'operations', 'seconds',    'lower_is_better'),
  ('TALK_TIME',        'Average Talk Time',         'operations', 'seconds',    'lower_is_better')
ON DUPLICATE KEY UPDATE metric_name = VALUES(metric_name);
