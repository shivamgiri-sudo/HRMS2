-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 020_employee_reactivation.sql
-- Purpose: Employee Reactivation Workflow
-- Dependencies: 002_employees.sql, 011_exit_management.sql
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_reactivation_requests (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  employee_id CHAR(36) NOT NULL,
  old_employment_status VARCHAR(50) NOT NULL COMMENT 'Status before reactivation (Inactive, Absconding, etc.)',
  proposed_joining_date DATE NOT NULL,
  reinstatement_reason TEXT NOT NULL,
  gap_days INT NOT NULL DEFAULT 0 COMMENT 'Days between exit and proposed rejoining',
  same_cost_centre TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = rejoining same cost centre, 0 = changed',
  ff_already_paid TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = F&F settlement already paid',

  status ENUM('pending', 'branch_head_approved', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',

  -- Optional overrides for new placement
  new_branch_id CHAR(36) NULL,
  new_process_id CHAR(36) NULL,
  new_cost_centre_id CHAR(36) NULL,

  -- Workflow tracking
  initiated_by CHAR(36) NOT NULL,
  initiated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  branch_head_actioned_by CHAR(36) NULL,
  branch_head_actioned_at DATETIME NULL,
  branch_head_remarks TEXT NULL,

  hr_final_actioned_by CHAR(36) NULL,
  hr_final_actioned_at DATETIME NULL,
  hr_final_remarks TEXT NULL,

  -- Reference to original exit request if available
  exit_request_id CHAR(36) NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_employee (employee_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at DESC),
  INDEX idx_pending_branch (status, branch_head_actioned_at) COMMENT 'For branch head queue',
  INDEX idx_pending_hr (status, hr_final_actioned_at) COMMENT 'For HR final queue'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Audit trail for reactivation actions
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_reactivation_audit (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  request_id CHAR(36) NOT NULL,
  action VARCHAR(100) NOT NULL COMMENT 'initiated, branch_approved, branch_rejected, hr_approved, hr_rejected, cancelled',
  actioned_by CHAR(36) NOT NULL,
  remarks TEXT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_request (request_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Sample data (dev/testing only)
-- ═══════════════════════════════════════════════════════════════════════════════

-- No sample data for production safety
