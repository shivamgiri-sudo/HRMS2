-- Migration 391: Add missing payroll validation/freeze columns and audit table
-- These columns are referenced by payroll-governance.service.ts and payrollCompliance.service.ts
-- but were never included in any prior migration, causing runtime errors on freeze operations.

-- Add missing columns to salary_prep_run
ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS attendance_snapshot_locked TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS compliance_checked         TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS compliance_checked_at      DATETIME   NULL,
  ADD COLUMN IF NOT EXISTS compliance_issues_count    INT        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS branch_id                  CHAR(36)   NULL,
  ADD COLUMN IF NOT EXISTS process_id                 CHAR(36)   NULL;

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
