-- 1065_employee_geofence_alerts.sql
--
-- Creates employee_geofence_alerts, which the schema verifier lists as a required table and
-- which no migration has ever created.
--
-- Three places depend on it: src/db/schema-presence-check.ts names it in the required set,
-- server.ts fails its readiness check without it, and location.routes.ts writes a row every
-- time an employee marks attendance outside their branch radius.
--
-- That write is wrapped in `.catch(err => console.warn("geofence alert insert skipped"))`, so
-- on a database without the table every out-of-radius attendance has been silently discarded
-- rather than raising anything. The feature reports nothing and looks like it is working.
--
-- The shape is taken directly from that INSERT — it is the only writer, so its column list is
-- the definition:
--
--   INSERT INTO employee_geofence_alerts
--     (employee_id, branch_id, branch_name, latitude, longitude, distance_km, radius_km)
--
-- No charset is declared, so the table inherits the database default (utf8mb4_unicode_ci),
-- which is what keeps the foreign keys into employees and branch_master valid.
--
-- Safe for production: CREATE TABLE IF NOT EXISTS cannot alter a table that already exists,
-- and production does not run migrations at all.

CREATE TABLE IF NOT EXISTS employee_geofence_alerts (
  id           CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id  CHAR(36)      NOT NULL,
  branch_id    CHAR(36)          NULL,
  -- Denormalised deliberately: the alert records where the employee was expected to be at
  -- the time, which must survive a branch being renamed or deleted.
  branch_name  VARCHAR(255)      NULL,
  latitude     DECIMAL(10,7)     NULL,
  longitude    DECIMAL(10,7)     NULL,
  distance_km  DECIMAL(10,3)     NULL COMMENT 'How far outside the radius the punch was',
  radius_km    DECIMAL(10,3)     NULL COMMENT 'The branch radius in force when this fired',
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ega_employee (employee_id, created_at),
  INDEX idx_ega_branch (branch_id, created_at),
  CONSTRAINT fk_ega_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  -- SET NULL rather than CASCADE: deleting a branch must not erase the record that someone
  -- punched in outside it. branch_name preserves which branch it was.
  CONSTRAINT fk_ega_branch FOREIGN KEY (branch_id) REFERENCES branch_master (id) ON DELETE SET NULL
);

SELECT TABLE_NAME, TABLE_COLLATION
  FROM INFORMATION_SCHEMA.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_geofence_alerts';
-- EXPECT: 1 row, utf8mb4_unicode_ci.
