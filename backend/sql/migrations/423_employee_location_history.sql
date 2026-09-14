-- Migration 423: append-only GPS trail for field-worker route replay.
--
-- Additive and independent: employee_live_location keeps ONE latest row per
-- employee (upsert); this table keeps EVERY heartbeat so a worker's movement
-- over a day can be replayed on the map. No existing table is altered.
--
-- Growth note: one worker at a 30-60s heartbeat produces ~500-1000 rows/shift.
-- A retention job (e.g. delete rows older than 90 days) should be added before
-- this runs at full fleet scale; kept out of this migration to stay additive.

CREATE TABLE IF NOT EXISTS employee_location_history (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id  CHAR(36)        NOT NULL,
  latitude     DECIMAL(10,8)   NOT NULL,
  longitude    DECIMAL(11,8)   NOT NULL,
  accuracy     FLOAT           NULL,
  captured_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_emp_captured (employee_id, captured_at),
  INDEX idx_captured (captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
