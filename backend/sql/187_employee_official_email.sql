USE mas_hrms;

SET @has_official_email = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employees'
     AND COLUMN_NAME = 'official_email'
);

SET @add_official_email_sql = IF(
  @has_official_email = 0,
  'ALTER TABLE employees ADD COLUMN official_email VARCHAR(255) NULL AFTER email',
  'SELECT 1'
);

PREPARE add_official_email_stmt FROM @add_official_email_sql;
EXECUTE add_official_email_stmt;
DEALLOCATE PREPARE add_official_email_stmt;

UPDATE employees
   SET official_email = email
 WHERE (official_email IS NULL OR TRIM(official_email) = '')
   AND (
     LOWER(email) LIKE '%@teammas.in'
     OR LOWER(email) LIKE '%@teammas.co.in'
   );

SET @has_official_email_index = (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employees'
     AND INDEX_NAME = 'idx_employees_official_email'
);

SET @add_official_email_index_sql = IF(
  @has_official_email_index = 0,
  'CREATE INDEX idx_employees_official_email ON employees (official_email)',
  'SELECT 1'
);

PREPARE add_official_email_index_stmt FROM @add_official_email_index_sql;
EXECUTE add_official_email_index_stmt;
DEALLOCATE PREPARE add_official_email_index_stmt;
