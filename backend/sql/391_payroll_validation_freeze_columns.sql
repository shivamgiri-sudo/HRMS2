-- Migration 391: Add missing payroll validation/freeze columns and audit table
-- These columns are referenced by payroll-governance.service.ts and payrollCompliance.service.ts
-- but were never included in any prior migration, causing runtime errors on freeze operations.

-- Add missing columns to salary_prep_run
SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'attendance_snapshot_locked'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN attendance_snapshot_locked TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT "attendance_snapshot_locked already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'compliance_checked'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN compliance_checked         TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT "compliance_checked already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'compliance_checked_at'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN compliance_checked_at      DATETIME   NULL',
  'SELECT "compliance_checked_at already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

SET @mcol_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'compliance_issues_count'
);
SET @msql_4 = IF(@mcol_4 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN compliance_issues_count    INT        NOT NULL DEFAULT 0',
  'SELECT "compliance_issues_count already exists" AS message');
PREPARE mstmt_4 FROM @msql_4;
EXECUTE mstmt_4;
DEALLOCATE PREPARE mstmt_4;

SET @mcol_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'branch_id'
);
SET @msql_5 = IF(@mcol_5 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN branch_id                  CHAR(36)   NULL',
  'SELECT "branch_id already exists" AS message');
PREPARE mstmt_5 FROM @msql_5;
EXECUTE mstmt_5;
DEALLOCATE PREPARE mstmt_5;

SET @mcol_6 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'process_id'
);
SET @msql_6 = IF(@mcol_6 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN process_id                 CHAR(36)   NULL',
  'SELECT "process_id already exists" AS message');
PREPARE mstmt_6 FROM @msql_6;
EXECUTE mstmt_6;
DEALLOCATE PREPARE mstmt_6;

-- Create the payroll calculation audit table referenced by freezeAttendance() and payrollCompliance.service.ts
-- Column names match exact INSERT statements in:
--   payroll-governance.service.ts: (id, run_id, employee_id, event_type, event_detail, actor_user_id)
--   payroll-compliance/payrollCompliance.service.ts: (id, run_id, employee_id, event_type, event_detail, actor_user_id)
CREATE TABLE IF NOT EXISTS payroll_calculation_audit (
  id           CHAR(36)     NOT NULL,
  run_id       CHAR(36)     NOT NULL,
  employee_id  CHAR(36)     NULL,
  event_type   VARCHAR(50)  NOT NULL,
  event_detail JSON         NULL,
  actor_user_id CHAR(36)    NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pca_run      (run_id),
  KEY idx_pca_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
