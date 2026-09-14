-- Migration 1551: Add leave_finalized and regularization_complete tracking columns to payroll_branch_readiness.
-- payroll-branch-readiness.service.ts references these in its scoring logic and UPSERT, but the table was
-- created by migration 400 before they were added to the service DDL, so they were never applied.
-- Additive and idempotent: information_schema-guarded, no data changed, no existing column touched.

SET @db = DATABASE();

-- leave_finalized
SELECT COUNT(*) INTO @has_lf
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'leave_finalized';
SET @sql = IF(@has_lf = 0,
  'ALTER TABLE payroll_branch_readiness
     ADD COLUMN leave_finalized       TINYINT(1)   NOT NULL DEFAULT 0 AFTER salary_verification_by,
     ADD COLUMN leave_finalized_at    DATETIME     NULL AFTER leave_finalized,
     ADD COLUMN leave_finalized_by    VARCHAR(36)  NULL AFTER leave_finalized_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- regularization_complete
SELECT COUNT(*) INTO @has_rc
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payroll_branch_readiness' AND COLUMN_NAME = 'regularization_complete';
SET @sql = IF(@has_rc = 0,
  'ALTER TABLE payroll_branch_readiness
     ADD COLUMN regularization_complete    TINYINT(1)  NOT NULL DEFAULT 0 AFTER leave_finalized_by,
     ADD COLUMN regularization_complete_at DATETIME    NULL AFTER regularization_complete,
     ADD COLUMN regularization_complete_by VARCHAR(36) NULL AFTER regularization_complete_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
