-- Deduplicated COSEC daily attendance imported through Integration Hub.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS integration_biometric_daily (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key   VARCHAR(100) NOT NULL,
  source_table      VARCHAR(255) NOT NULL,
  employee_code     VARCHAR(100) NOT NULL,
  activity_date     DATE         NOT NULL,
  first_punch       DATETIME     NULL,
  last_punch        DATETIME     NULL,
  biometric_minutes INT          NOT NULL DEFAULT 0,
  run_id            CHAR(36)     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_biometric_daily_source (
    integration_key, source_table, employee_code, activity_date
  ),
  INDEX idx_biometric_daily_employee_date (employee_code, activity_date),
  INDEX idx_biometric_daily_date (activity_date)
);
