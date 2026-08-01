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
-- COLLATE is required, not cosmetic. Without it MySQL 8 applies the SERVER default
-- (utf8mb4_0900_ai_ci) while employees and the other 757 tables in mas_hrms are
-- utf8mb4_unicode_ci — so any later JOIN on employee_id or branch_id would fail with
-- ER_CANT_AGGREGATE_2COLLATIONS. That is exactly what broke employee_reimbursement_claim,
-- which was also created without it (see 1038_reimbursement_claim_collation.sql).
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
