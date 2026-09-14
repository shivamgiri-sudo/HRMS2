-- Communication Preferences Table
CREATE TABLE IF NOT EXISTS communication_preferences (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  employee_id VARCHAR(36) NOT NULL UNIQUE COMMENT 'FK to employees.id',
  email_on_leave_approval BOOLEAN DEFAULT TRUE,
  email_on_leave_rejection BOOLEAN DEFAULT TRUE,
  email_on_attendance_mark BOOLEAN DEFAULT FALSE,
  email_on_payroll_ready BOOLEAN DEFAULT TRUE,
  email_on_performance_review BOOLEAN DEFAULT TRUE,
  email_on_promotion BOOLEAN DEFAULT TRUE,
  sms_on_leave_approval BOOLEAN DEFAULT FALSE,
  sms_on_attendance_mark BOOLEAN DEFAULT FALSE,
  in_app_on_leave_approval BOOLEAN DEFAULT TRUE,
  in_app_on_payroll_ready BOOLEAN DEFAULT TRUE,
  push_notifications_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_employee_id (employee_id),
  CONSTRAINT fk_comm_prefs_emp FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Employee notification preference settings';
