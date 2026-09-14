-- 410_visitor_configuration_branch_fk.sql
-- Additive repair for visitor_configuration.branch_id.
-- Safe to rerun. No destructive data operations.

CREATE PROCEDURE IF NOT EXISTS visitor_configuration_branch_fk_410()
BEGIN
  DECLARE branch_engine_count INT DEFAULT 0;
  DECLARE visitor_engine_count INT DEFAULT 0;
  DECLARE branch_column_count INT DEFAULT 0;
  DECLARE visitor_column_count INT DEFAULT 0;
  DECLARE branch_pk_count INT DEFAULT 0;
  DECLARE orphan_count INT DEFAULT 0;
  DECLARE fk_count INT DEFAULT 0;
  DECLARE idx_count INT DEFAULT 0;

  SELECT COUNT(*)
    INTO branch_engine_count
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'branch_master'
    AND ENGINE = 'InnoDB';

  IF branch_engine_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'migration 410 blocked: branch_master must use InnoDB';
  END IF;

  SELECT COUNT(*)
    INTO visitor_engine_count
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'visitor_configuration'
    AND ENGINE = 'InnoDB';

  IF visitor_engine_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'migration 410 blocked: visitor_configuration must use InnoDB';
  END IF;

  SELECT COUNT(*)
    INTO branch_column_count
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'branch_master'
    AND COLUMN_NAME = 'id'
    AND COLUMN_TYPE = 'char(36)'
    AND IS_NULLABLE = 'NO'
    AND CHARACTER_SET_NAME = 'utf8mb4'
    AND COLLATION_NAME = 'utf8mb4_unicode_ci'
    AND COLUMN_KEY = 'PRI';

  IF branch_column_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'migration 410 blocked: branch_master.id must stay CHAR(36) utf8mb4_unicode_ci PRIMARY KEY';
  END IF;

  SELECT COUNT(*)
    INTO visitor_column_count
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'visitor_configuration'
    AND COLUMN_NAME = 'branch_id'
    AND COLUMN_TYPE = 'char(36)'
    AND CHARACTER_SET_NAME = 'utf8mb4'
    AND COLLATION_NAME = 'utf8mb4_unicode_ci';

  IF visitor_column_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'migration 410 blocked: visitor_configuration.branch_id must stay CHAR(36) utf8mb4_unicode_ci';
  END IF;

  SELECT COUNT(*)
    INTO branch_pk_count
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'branch_master'
    AND COLUMN_NAME = 'id'
    AND REFERENCED_TABLE_NAME IS NULL;

  IF branch_pk_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'migration 410 blocked: branch_master.id must remain indexed as the parent key';
  END IF;

  SELECT COUNT(*)
    INTO orphan_count
  FROM visitor_configuration vc
  LEFT JOIN branch_master bm ON bm.id = vc.branch_id
  WHERE vc.branch_id IS NOT NULL
    AND bm.id IS NULL;

  IF orphan_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'migration 410 blocked: orphan visitor_configuration.branch_id rows exist';
  END IF;

  SELECT COUNT(*)
    INTO idx_count
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'visitor_configuration'
    AND INDEX_NAME = 'idx_visitor_configuration_branch_id';

  IF idx_count = 0 THEN
    ALTER TABLE visitor_configuration
      ADD INDEX idx_visitor_configuration_branch_id (branch_id);
  END IF;

  SELECT COUNT(*)
    INTO fk_count
  FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'visitor_configuration'
    AND CONSTRAINT_NAME = 'fk_visitor_config_branch';

  IF fk_count = 0 THEN
    ALTER TABLE visitor_configuration
      ADD CONSTRAINT fk_visitor_config_branch
      FOREIGN KEY (branch_id) REFERENCES branch_master(id)
      ON DELETE RESTRICT
      ON UPDATE RESTRICT;
  END IF;
END;

CALL visitor_configuration_branch_fk_410();
