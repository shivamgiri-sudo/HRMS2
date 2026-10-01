-- Attrition hub: follow-up log (absent outreach, stay conversations, ...) and a daily snapshot of the
-- backtest so model quality can be charted over time. Additive; no foreign keys on purpose
-- (startup migrations that add FKs to hot master tables have hit lock-wait timeouts here before).
CREATE TABLE IF NOT EXISTS attrition_followup (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  employee_id CHAR(36) NOT NULL,
  kind VARCHAR(30) NOT NULL,
  outcome VARCHAR(30) NOT NULL,
  note VARCHAR(500) NULL,
  tier_at_action VARCHAR(10) NULL,
  score_at_action SMALLINT NULL,
  created_by CHAR(36) NULL,
  created_by_name VARCHAR(160) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_af_employee (employee_id, created_at),
  KEY idx_af_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attrition_model_snapshot (
  snapshot_date DATE NOT NULL,
  auc DECIMAL(6,4) NULL,
  base_rate_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
  population INT NOT NULL DEFAULT 0,
  leavers INT NOT NULL DEFAULT 0,
  calibration_json TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
