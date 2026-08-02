-- backend/sql/141_branch_head_approval.sql
-- Branch Head Approval Tables
USE mas_hrms;

-- ── 1. Branch Head Assignments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branch_head_assignments (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_head_id CHAR(36) NOT NULL,
  branch_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  assigned_by CHAR(36) NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_branch_head (branch_head_id),
  INDEX idx_branch (branch_name),
  UNIQUE KEY unique_assignment (branch_head_id, branch_name)
);

-- ── 2. Branch Head Approval Records ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_branch_head_approval (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  payroll_validation_id CHAR(36) NOT NULL,
  branch_head_id CHAR(36) NOT NULL,
  approval_status ENUM('approved', 'rejected') NOT NULL,
  employee_code_generated VARCHAR(50) NULL,
  remarks TEXT NULL,
  approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payroll_validation (payroll_validation_id),
  INDEX idx_branch_head (branch_head_id),
  INDEX idx_status (approval_status),
  FOREIGN KEY (payroll_validation_id) REFERENCES ats_payroll_hr_validation(id) ON DELETE CASCADE
);

-- ── 3. Assign default branch heads (update with actual IDs) ──────────────────
-- These are examples - update with actual branch head employee IDs
INSERT INTO branch_head_assignments (branch_head_id, branch_name, assigned_by, is_active) VALUES
-- Replace with actual employee IDs from your employees table
-- ('employee_id_1', 'Trapezoid', 'SYSTEM', TRUE),
-- ('employee_id_2', 'Okaya', 'SYSTEM', TRUE),
-- ('employee_id_3', 'Jaldarshan', 'SYSTEM', TRUE)
('00000000-0000-0000-0000-000000000001', 'Trapezoid', 'SYSTEM', TRUE),
('00000000-0000-0000-0000-000000000002', 'Okaya', 'SYSTEM', TRUE)
ON DUPLICATE KEY UPDATE is_active=TRUE;

SELECT '✅ Migration 141 complete: Branch Head Approval tables created' AS result;
