-- Retention job for employee_location_history.
-- At 30-60s heartbeat cadence, one employee generates ~500-1000 rows/shift.
-- This event prunes rows older than 90 days to cap table growth.
-- Requires MySQL event_scheduler = ON (set in my.cnf or via SET GLOBAL).
-- Safe to run multiple times: CREATE EVENT IF NOT EXISTS.

SET GLOBAL event_scheduler = ON;

CREATE EVENT IF NOT EXISTS ev_location_history_cleanup
  ON SCHEDULE EVERY 1 DAY
  STARTS (CURDATE() + INTERVAL 1 DAY + INTERVAL 2 HOUR)
  ON COMPLETION PRESERVE
  ENABLE
  COMMENT 'Prune employee_location_history rows older than 90 days'
  DO
    DELETE FROM employee_location_history
     WHERE captured_at < NOW() - INTERVAL 90 DAY;
