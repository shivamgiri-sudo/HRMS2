-- Speed up Employee Directory filters, counts, pagination and typeahead search.
-- Uses PREPARE blocks so the migration stays idempotent on MySQL.

SET @idx_exists := (
  SELECT COUNT(1) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'employees'
     AND index_name = 'idx_employees_directory_status'
);
SET @ddl := IF(@idx_exists = 0,
  'CREATE INDEX idx_employees_directory_status ON employees (active_status, employment_status)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(1) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'employees'
     AND index_name = 'idx_employees_directory_org'
);
SET @ddl := IF(@idx_exists = 0,
  'CREATE INDEX idx_employees_directory_org ON employees (branch_id, process_id, department_id)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(1) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'employees'
     AND index_name = 'idx_employees_directory_code'
);
SET @ddl := IF(@idx_exists = 0,
  'CREATE INDEX idx_employees_directory_code ON employees (employee_code)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
