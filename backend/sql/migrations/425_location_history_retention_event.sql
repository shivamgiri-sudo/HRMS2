-- Retention job for employee_location_history and employee_geofence_alerts.
-- At 30-60s heartbeat cadence, one employee generates ~500-1000 rows/shift.
-- This event prunes rows older than 90 days to cap table growth.
-- INFRA PREREQUISITE: event_scheduler must be ON. Set it in my.cnf:
--   [mysqld]
--   event_scheduler = ON
-- Do NOT use SET GLOBAL event_scheduler here — it requires SUPER/SYSTEM_VARIABLES_ADMIN
-- which a least-privilege app DB user will not have.
-- Safe to run multiple times: CREATE EVENT IF NOT EXISTS.

CREATE EVENT IF NOT EXISTS ev_location_history_cleanup
  ON SCHEDULE EVERY 1 DAY
  STARTS (CURDATE() + INTERVAL 1 DAY + INTERVAL 2 HOUR)
  ON COMPLETION PRESERVE
  ENABLE
  COMMENT 'Prune location_history and geofence_alerts rows older than 90 days'
  DO BEGIN
    DELETE FROM employee_location_history
     WHERE captured_at < NOW() - INTERVAL 90 DAY;
    DELETE FROM employee_geofence_alerts
     WHERE captured_at < NOW() - INTERVAL 90 DAY;
  END
