CREATE TABLE IF NOT EXISTS payroll_attendance_conflict_review (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  conflict_key    VARCHAR(255) NOT NULL,
  employee_id     CHAR(36)     NULL,
  issue_date      DATE         NOT NULL,
  issue_type      VARCHAR(100) NOT NULL,
  status          ENUM('open','notified','reviewed','no_issue','regularization_required') NOT NULL DEFAULT 'open',
  manager_user_id CHAR(36)     NULL,
  reviewed_by     CHAR(36)     NULL,
  reviewed_at     DATETIME     NULL,
  review_note     TEXT         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payroll_att_conflict (conflict_key),
  KEY idx_payroll_att_conflict_employee_date (employee_id, issue_date),
  KEY idx_payroll_att_conflict_status (status),
  KEY idx_payroll_att_conflict_manager (manager_user_id)
);
