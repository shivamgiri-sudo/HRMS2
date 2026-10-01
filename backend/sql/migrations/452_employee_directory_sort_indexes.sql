-- Migration 452: composite indexes so the Employee Directory list can ORDER BY ... LIMIT
-- without scanning the whole table.
--
-- GET /api/employees filters on active_status and sorts by employee_code (default) or
-- date_of_joining. With only single-column / (active_status, X) indexes the optimiser walks the
-- employee_code index in order and filters row by row; active employees are sparse in code order
-- so the default Active page took ~4.8s and "sort by joining date" ~8s on 57k rows.
-- (active_status, employee_code) and (active_status, date_of_joining) let MySQL range-scan the
-- right slice already in order and stop after LIMIT rows.
--
-- Additive and idempotent.

SET @s = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_emp_active_code ON employees (active_status, employee_code)', 'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'employees' AND index_name = 'idx_emp_active_code');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_emp_active_doj ON employees (active_status, date_of_joining)', 'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'employees' AND index_name = 'idx_emp_active_doj');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
