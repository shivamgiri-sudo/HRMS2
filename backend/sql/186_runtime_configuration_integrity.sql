USE mas_hrms;

SET @leave_type_has_updated_at = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'leave_type_master'
     AND COLUMN_NAME = 'updated_at'
);

SET @leave_type_updated_at_sql = IF(
  @leave_type_has_updated_at = 0,
  'ALTER TABLE leave_type_master ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  'SELECT 1'
);

PREPARE leave_type_updated_at_stmt FROM @leave_type_updated_at_sql;
EXECUTE leave_type_updated_at_stmt;
DEALLOCATE PREPARE leave_type_updated_at_stmt;

CREATE TABLE IF NOT EXISTS process_configuration (
  id CHAR(36) NOT NULL,
  process_id CHAR(36) NOT NULL,
  config_key VARCHAR(100) NOT NULL,
  config_value JSON NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_process_configuration_key (process_id, config_key),
  KEY idx_process_configuration_process (process_id, active_status),
  CONSTRAINT fk_process_configuration_process
    FOREIGN KEY (process_id) REFERENCES process_master(id)
    ON DELETE CASCADE
);
