-- Migration 339: Payroll validation and rejection workflow
-- Adds formal validate/reject step between calculation and NEFT export.
-- Salary transfer file (NEFT) can only be generated from a 'validated' run.

SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'validation_status'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN validation_status ENUM(''pending'',''validated'',''rejected'') NOT NULL DEFAULT ''pending'' AFTER status',
  'SELECT "validation_status already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'validated_by'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN validated_by       CHAR(36) NULL AFTER validation_status',
  'SELECT "validated_by already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'validated_at'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN validated_at       DATETIME NULL AFTER validated_by',
  'SELECT "validated_at already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

SET @mcol_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'rejection_reason'
);
SET @msql_4 = IF(@mcol_4 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN rejection_reason   TEXT     NULL AFTER validated_at',
  'SELECT "rejection_reason already exists" AS message');
PREPARE mstmt_4 FROM @msql_4;
EXECUTE mstmt_4;
DEALLOCATE PREPARE mstmt_4;

SET @mcol_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'rejected_by'
);
SET @msql_5 = IF(@mcol_5 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN rejected_by        CHAR(36) NULL AFTER rejection_reason',
  'SELECT "rejected_by already exists" AS message');
PREPARE mstmt_5 FROM @msql_5;
EXECUTE mstmt_5;
DEALLOCATE PREPARE mstmt_5;

SET @mcol_6 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'rejected_at'
);
SET @msql_6 = IF(@mcol_6 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN rejected_at        DATETIME NULL AFTER rejected_by',
  'SELECT "rejected_at already exists" AS message');
PREPARE mstmt_6 FROM @msql_6;
EXECUTE mstmt_6;
DEALLOCATE PREPARE mstmt_6;

-- Audit trail for each validate/reject action
CREATE TABLE IF NOT EXISTS payroll_validation_log (
  id              CHAR(36)     NOT NULL,
  run_id          CHAR(36)     NOT NULL,
  action          ENUM('validated','rejected','reopened') NOT NULL,
  actor_id        CHAR(36)     NOT NULL,
  actor_role      VARCHAR(100) NOT NULL,
  reason          TEXT         NULL,
  snapshot_json   JSON         NULL,     -- key figures at time of action
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pvl_run (run_id),
  INDEX idx_pvl_actor (actor_id)
);
