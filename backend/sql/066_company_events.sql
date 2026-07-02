CREATE TABLE IF NOT EXISTS company_event_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  event_date    DATE         NOT NULL,
  end_date      DATE,
  event_type    VARCHAR(100) NOT NULL DEFAULT 'general',
  is_holiday    TINYINT(1)   NOT NULL DEFAULT 0,
  description   TEXT,
  branch_id     CHAR(36),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_by    CHAR(36),
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_event_date (event_date),
  INDEX idx_event_holiday (is_holiday)
);
