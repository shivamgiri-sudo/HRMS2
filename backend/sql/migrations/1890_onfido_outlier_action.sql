-- Onfido dashboard: action and closure tracking against an analyst who is outside target.
--   One row per action a TL/AM logs against an analyst + metric for a period: what was done, the
--   root cause, who owns it, when it is due, and whether it is closed. Lives in mas_hrms (not
--   onfido_db) so it survives raw-report re-uploads. Collation matches the other mas_hrms tables
--   (utf8mb4_unicode_ci). Additive and idempotent.

CREATE TABLE IF NOT EXISTS onfido_outlier_action (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  analyst_email VARCHAR(255) NOT NULL,
  analyst_name VARCHAR(255) NULL,
  tl_name VARCHAR(255) NULL,
  am_name VARCHAR(255) NULL,
  metric VARCHAR(60) NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  observed_value DECIMAL(10,2) NULL,
  target_value DECIMAL(10,2) NULL,
  action_taken TEXT NULL,
  rca TEXT NULL,
  owner_name VARCHAR(255) NULL,
  due_date DATE NULL,
  status ENUM('open','in_progress','closed') NOT NULL DEFAULT 'open',
  closure_remarks TEXT NULL,
  closed_at DATETIME NULL,
  created_by CHAR(36) NULL,
  created_by_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ooa_analyst_metric (analyst_email, metric, status),
  KEY idx_ooa_status_due (status, due_date),
  KEY idx_ooa_period (period_from, period_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
