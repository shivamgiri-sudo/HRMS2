-- Live employee GPS location — one row per employee, upserted on each heartbeat
CREATE TABLE IF NOT EXISTS employee_live_location (
  employee_id  CHAR(36)      NOT NULL,
  latitude     DECIMAL(10,8) NOT NULL,
  longitude    DECIMAL(11,8) NOT NULL,
  accuracy     FLOAT         NULL,
  captured_at  DATETIME      NOT NULL,
  full_name    VARCHAR(128)  NULL,
  branch_name  VARCHAR(128)  NULL,
  PRIMARY KEY (employee_id),
  INDEX idx_captured (captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
