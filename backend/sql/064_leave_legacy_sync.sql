-- Migration: Add legacy sync support to leave_request table
-- Purpose: Track legacy leave_management records and enable safe sync

-- Add legacy tracking columns to leave_request
ALTER TABLE leave_request
ADD COLUMN legacy_leave_id INT NULL COMMENT 'ID from legacy leave_management table',
ADD COLUMN leave_type_code VARCHAR(20) NULL COMMENT 'Legacy leave type code (CL, ML, DL, EL, etc)',
ADD COLUMN start_date DATE NULL COMMENT 'Alias for from_date',
ADD COLUMN end_date DATE NULL COMMENT 'Alias for to_date',
ADD COLUMN requested_at DATETIME NULL COMMENT 'When leave was requested',
ADD COLUMN approved_at DATETIME NULL COMMENT 'When leave was approved',
ADD COLUMN approved_by VARCHAR(100) NULL COMMENT 'Who approved the leave',
ADD COLUMN rejection_reason TEXT NULL COMMENT 'Reason for rejection if status=rejected',
ADD COLUMN legacy_created_at DATETIME NULL COMMENT 'Original CreateDate from legacy';

-- Create index on legacy_leave_id for fast lookups during sync
ALTER TABLE leave_request ADD INDEX idx_legacy_leave_id (legacy_leave_id);

-- Create index on employee_id + start_date for leave balance queries
ALTER TABLE leave_request ADD INDEX idx_employee_dates (employee_id, start_date, end_date);

-- Update existing records to populate start_date/end_date from from_date/to_date
UPDATE leave_request SET
  start_date = from_date,
  end_date = to_date,
  requested_at = applied_at
WHERE start_date IS NULL;

-- Create view for legacy-compatible leave queries
CREATE OR REPLACE VIEW v_leave_requests_legacy AS
SELECT
  lr.id,
  lr.employee_id,
  e.employee_code,
  e.first_name,
  e.last_name,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
  lr.leave_type_id,
  lt.leave_code AS leave_type_code,
  lt.leave_name AS leave_type_name,
  COALESCE(lr.start_date, lr.from_date) AS start_date,
  COALESCE(lr.end_date, lr.to_date) AS end_date,
  lr.total_days,
  lr.reason,
  lr.status,
  lr.requested_at,
  lr.approved_at,
  lr.approved_by,
  lr.rejection_reason,
  lr.legacy_leave_id,
  lr.legacy_created_at,
  lr.created_at,
  lr.applied_at
FROM leave_request lr
JOIN employees e ON e.id = lr.employee_id
LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
ORDER BY lr.created_at DESC;

-- Log migration
INSERT INTO migration_log (migration_name, status, executed_at)
VALUES ('064_leave_legacy_sync', 'completed', NOW())
ON DUPLICATE KEY UPDATE status = 'completed', executed_at = NOW();
