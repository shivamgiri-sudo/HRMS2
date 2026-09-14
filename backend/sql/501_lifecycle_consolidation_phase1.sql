-- Migration: 501_lifecycle_consolidation_phase1.sql
-- Purpose: Phase 1 candidate-to-employee lifecycle fixes
-- Date: 2026-07-16
-- Changes:
--   1. Add employment_status column to employees for lifecycle tracking
--   2. Add assignment_exception and sla_due_at to it_provisioning_request
--   3. Add is_auto_approved flag to BGV tables for audit
--   4. Add employee_lifecycle_event table for status transitions

-- ============================================================================
-- 1. Add employment_status to employees table
-- ============================================================================

-- Check if employment_status column exists
SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employees'
    AND COLUMN_NAME = 'employment_status'
);

-- Add employment_status column if it doesn't exist
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE employees
   ADD COLUMN employment_status ENUM(
     ''preboarding'',
     ''provisioning_pending'',
     ''ready_to_join'',
     ''active'',
     ''blocked'',
     ''cancelled''
   ) NOT NULL DEFAULT ''preboarding'' AFTER active_status',
  'SELECT ''employment_status column already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill existing active employees as 'active'
UPDATE employees
SET employment_status = 'active'
WHERE active_status = 1
  AND (employment_status IS NULL OR employment_status = 'preboarding');

-- ============================================================================
-- 2. Modify employees.official_email to allow NULL
-- ============================================================================

ALTER TABLE employees
MODIFY COLUMN official_email VARCHAR(100) NULL
COMMENT 'Company email set by IT provisioning, NULL until IT creates domain account';

-- ============================================================================
-- 3. Add provisioning task SLA and assignment tracking fields
-- ============================================================================

-- Check if assignment_exception column exists
SET @assignment_exception_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'it_provisioning_request'
    AND COLUMN_NAME = 'assignment_exception'
);

-- Add assignment_exception if it doesn't exist
SET @sql = IF(@assignment_exception_exists = 0,
  'ALTER TABLE it_provisioning_request
   ADD COLUMN assignment_exception TINYINT(1) NOT NULL DEFAULT 0
   COMMENT ''1 if no users found for assigned role'' AFTER assigned_user_id',
  'SELECT ''assignment_exception column already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check if sla_due_at column exists
SET @sla_due_at_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'it_provisioning_request'
    AND COLUMN_NAME = 'sla_due_at'
);

-- Add sla_due_at if it doesn't exist
SET @sql = IF(@sla_due_at_exists = 0,
  'ALTER TABLE it_provisioning_request
   ADD COLUMN sla_due_at DATETIME NULL
   COMMENT ''24h SLA deadline from joining date'' AFTER actioned_at',
  'SELECT ''sla_due_at column already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for SLA queries
SET @sla_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'it_provisioning_request'
    AND INDEX_NAME = 'idx_sla_overdue'
);

SET @sql = IF(@sla_index_exists = 0,
  'CREATE INDEX idx_sla_overdue ON it_provisioning_request (sla_due_at, status)',
  'SELECT ''idx_sla_overdue index already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 4. Add BGV auto-approval audit flags
-- ============================================================================

-- Check if is_auto_approved column exists in candidate_bgv_check
SET @bgv_check_auto_approved_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'candidate_bgv_check'
    AND COLUMN_NAME = 'is_auto_approved'
);

-- Add is_auto_approved to candidate_bgv_check if it doesn't exist
SET @sql = IF(@bgv_check_auto_approved_exists = 0,
  'ALTER TABLE candidate_bgv_check
   ADD COLUMN is_auto_approved TINYINT(1) NOT NULL DEFAULT 0
   COMMENT ''1 if auto-approved without real provider verification'' AFTER verified_at',
  'SELECT ''is_auto_approved column already exists in candidate_bgv_check'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check if is_auto_approved column exists in candidate_bgv_report
SET @bgv_report_auto_approved_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'candidate_bgv_report'
    AND COLUMN_NAME = 'is_auto_approved'
);

-- Add is_auto_approved to candidate_bgv_report if it doesn't exist
SET @sql = IF(@bgv_report_auto_approved_exists = 0,
  'ALTER TABLE candidate_bgv_report
   ADD COLUMN is_auto_approved TINYINT(1) NOT NULL DEFAULT 0
   COMMENT ''1 if any checks were auto-approved'' AFTER bgv_score',
  'SELECT ''is_auto_approved column already exists in candidate_bgv_report'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill is_auto_approved for existing records with provider_key = 'system'
UPDATE candidate_bgv_check
SET is_auto_approved = 1
WHERE provider_key = 'system'
  AND result_summary LIKE '%Auto-approved%'
  AND is_auto_approved = 0;

UPDATE candidate_bgv_report r
SET is_auto_approved = 1
WHERE EXISTS (
  SELECT 1 FROM candidate_bgv_check c
  WHERE c.candidate_id = r.candidate_id
    AND c.provider_key = 'system'
  LIMIT 1
)
AND is_auto_approved = 0;

-- ============================================================================
-- 5. Create employee_lifecycle_event table for audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_lifecycle_event (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  event_type VARCHAR(50) NOT NULL COMMENT 'STATUS_TRANSITION, ACTIVATION, etc.',
  from_status VARCHAR(50) NULL,
  to_status VARCHAR(50) NOT NULL,
  actor_user_id CHAR(36) NULL,
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_employee (employee_id),
  INDEX idx_event_type (event_type),
  INDEX idx_created_at (created_at),

  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Employee lifecycle state transition audit trail';

-- ============================================================================
-- 6. Add index for assignment_exception queries
-- ============================================================================

SET @assignment_exception_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'it_provisioning_request'
    AND INDEX_NAME = 'idx_assignment_exception'
);

SET @sql = IF(@assignment_exception_index_exists = 0,
  'CREATE INDEX idx_assignment_exception ON it_provisioning_request (assignment_exception, status)',
  'SELECT ''idx_assignment_exception index already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Validation Queries
-- ============================================================================

-- Check schema changes
SELECT
  'Schema Validation' AS check_type,
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'employment_status') = 1
    THEN '✓ employees.employment_status added'
    ELSE '✗ employees.employment_status missing'
  END AS result
UNION ALL
SELECT
  'Schema Validation',
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'it_provisioning_request' AND COLUMN_NAME = 'assignment_exception') = 1
    THEN '✓ it_provisioning_request.assignment_exception added'
    ELSE '✗ it_provisioning_request.assignment_exception missing'
  END
UNION ALL
SELECT
  'Schema Validation',
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'it_provisioning_request' AND COLUMN_NAME = 'sla_due_at') = 1
    THEN '✓ it_provisioning_request.sla_due_at added'
    ELSE '✗ it_provisioning_request.sla_due_at missing'
  END
UNION ALL
SELECT
  'Schema Validation',
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_bgv_check' AND COLUMN_NAME = 'is_auto_approved') = 1
    THEN '✓ candidate_bgv_check.is_auto_approved added'
    ELSE '✗ candidate_bgv_check.is_auto_approved missing'
  END
UNION ALL
SELECT
  'Schema Validation',
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_lifecycle_event') = 1
    THEN '✓ employee_lifecycle_event table created'
    ELSE '✗ employee_lifecycle_event table missing'
  END;

-- Show BGV auto-approval audit summary
SELECT
  'BGV Auto-Approval Audit' AS audit_type,
  COUNT(DISTINCT candidate_id) AS total_candidates,
  SUM(CASE WHEN is_auto_approved = 1 THEN 1 ELSE 0 END) AS auto_approved_count,
  SUM(CASE WHEN is_auto_approved = 0 THEN 1 ELSE 0 END) AS real_verified_count
FROM candidate_bgv_report
WHERE EXISTS (SELECT 1 FROM candidate_bgv_check WHERE candidate_id = candidate_bgv_report.candidate_id LIMIT 1);

-- Show active employees backfill
SELECT
  'Employee Status Backfill' AS audit_type,
  COUNT(*) AS total_active_employees,
  SUM(CASE WHEN employment_status = 'active' THEN 1 ELSE 0 END) AS backfilled_as_active
FROM employees
WHERE active_status = 1;

-- ============================================================================
-- Migration Complete
-- ============================================================================

SELECT '✓ Migration 501_lifecycle_consolidation_phase1.sql completed successfully' AS status;
