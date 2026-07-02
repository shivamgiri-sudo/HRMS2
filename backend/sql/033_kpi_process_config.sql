USE mas_hrms;

CREATE TABLE IF NOT EXISTS kpi_process_config (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      CHAR(36) NOT NULL,
  metric_id       CHAR(36) NOT NULL,
  target_value    DECIMAL(12,4) NOT NULL,
  min_threshold   DECIMAL(12,4) COMMENT 'Below this = red/critical',
  max_achievement DECIMAL(12,4) DEFAULT 120 COMMENT 'Cap (% of target) for scoring',
  weightage       DECIMAL(5,2) NOT NULL DEFAULT 100,
  effective_from  DATE NOT NULL DEFAULT (CURDATE()),
  created_by      CHAR(36),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_metric (process_id, metric_id),
  INDEX idx_kpc_process (process_id),
  INDEX idx_kpc_metric (metric_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS kpi_rating_config (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      CHAR(36) COMMENT 'NULL = global default applies to all processes',
  rating_label    VARCHAR(32) NOT NULL,
  min_score_pct   DECIMAL(5,2) NOT NULL,
  max_score_pct   DECIMAL(5,2) NOT NULL,
  color_code      VARCHAR(16),
  INDEX idx_krc_process (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO kpi_rating_config (id, process_id, rating_label, min_score_pct, max_score_pct, color_code) VALUES
  (UUID(), NULL, 'S', 100, 120, '#16a34a'),
  (UUID(), NULL, 'A', 90, 99.99, '#2563eb'),
  (UUID(), NULL, 'B', 75, 89.99, '#d97706'),
  (UUID(), NULL, 'C', 60, 74.99, '#ea580c'),
  (UUID(), NULL, 'D', 0, 59.99, '#dc2626');
