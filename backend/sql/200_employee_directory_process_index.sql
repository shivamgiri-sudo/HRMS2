-- Speed up process-wise Employee Directory charts, especially inactive employee grouping.

SET @idx_exists := (
  SELECT COUNT(1) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'employees'
     AND index_name = 'idx_employees_directory_status_process'
);
SET @ddl := IF(@idx_exists = 0,
  'CREATE INDEX idx_employees_directory_status_process ON employees (active_status, process_id)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
