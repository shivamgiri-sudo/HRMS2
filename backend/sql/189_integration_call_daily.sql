-- 189_integration_call_daily.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS integration_call_daily (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key VARCHAR(100)  NOT NULL,
  source_table    VARCHAR(255)  NOT NULL,
  employee_code   VARCHAR(100)  NOT NULL,
  activity_date   DATE          NOT NULL,
  process_name    VARCHAR(255)  NOT NULL DEFAULT '',
  total_calls     INT           NOT NULL DEFAULT 0,
  talk_minutes    DECIMAL(12,2) NOT NULL DEFAULT 0,
  run_id          CHAR(36),
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_call_daily_source (
    integration_key,
    source_table,
    employee_code,
    activity_date,
    process_name
  ),
  INDEX idx_call_daily_employee (employee_code, activity_date),
  INDEX idx_call_daily_process (process_name, activity_date),
  CONSTRAINT fk_call_daily_integration
    FOREIGN KEY (integration_key) REFERENCES integration_config(integration_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
