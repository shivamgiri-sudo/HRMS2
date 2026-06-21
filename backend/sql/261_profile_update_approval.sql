-- Profile update approval requests (bank details, statutory, emergency contact)
CREATE TABLE IF NOT EXISTS profile_update_approval (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  employee_id VARCHAR(36) NOT NULL COMMENT 'Employee requesting change',
  request_type VARCHAR(50) NOT NULL COMMENT 'bank_details, statutory_details, emergency_contact',
  old_values JSON COMMENT 'Previous values',
  new_values JSON COMMENT 'Requested new values',
  status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending, approved, rejected',
  requested_by_role VARCHAR(50) COMMENT 'employee, manager, hr',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_by VARCHAR(36) COMMENT 'FK to employees.id',
  reviewed_at TIMESTAMP NULL,
  reviewer_role VARCHAR(50) COMMENT 'branch_hr, payroll_hr, admin',
  reviewer_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_employee (employee_id),
  KEY idx_status (status),
  KEY idx_request_type (request_type),
  CONSTRAINT fk_profile_upd_emp FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Profile update requests pending approval';
