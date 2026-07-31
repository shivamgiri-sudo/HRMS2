-- Migration 426: Append-only log of geofence violation events.
-- One row per heartbeat that places an employee outside their branch radius.
-- Additive: no existing tables are altered.

CREATE TABLE IF NOT EXISTS employee_geofence_alerts (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id    VARCHAR(36)     NOT NULL,
  branch_id      VARCHAR(36)     NOT NULL,
  branch_name    VARCHAR(128)    NOT NULL,
  latitude       DECIMAL(10,7)   NOT NULL,
  longitude      DECIMAL(10,7)   NOT NULL,
  distance_km    DECIMAL(8,3)    NOT NULL,
  radius_km      DECIMAL(8,3)    NOT NULL,
  captured_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_emp_captured (employee_id, captured_at),
  INDEX idx_branch_captured (branch_id, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
