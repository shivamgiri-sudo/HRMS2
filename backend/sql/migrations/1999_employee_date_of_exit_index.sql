-- Migration 1999: index employees.date_of_exit.
--
-- The HR and CEO dashboards (headcount movement, attrition by branch / process / tenure, 12-month
-- exit history) filter and group on date_of_exit. With no index the scan walks all ~59k wide
-- employee rows: 4-26s under load, enough for the first call after a restart to exceed the
-- 12s insights-section timeout.
--
-- Additive and idempotent.

SET @s = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_emp_date_of_exit ON employees (date_of_exit)', 'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'employees' AND index_name = 'idx_emp_date_of_exit');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
