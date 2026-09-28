-- Employee warnings: a disciplinary record kept on the employee (date, category, severity, description,
-- who issued it, remarks, status). Each issue and withdrawal is also written to employee_journey_log so it
-- appears on the existing Journey timeline; this table is the record itself. Collation matches
-- employees (utf8mb4_unicode_ci). Additive and idempotent.

CREATE TABLE IF NOT EXISTS employee_warning (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  employee_id CHAR(36) NOT NULL,
  warning_date DATE NOT NULL,
  category VARCHAR(40) NOT NULL,
  severity ENUM('verbal','written','final') NOT NULL DEFAULT 'written',
  description TEXT NOT NULL,
  remarks TEXT NULL,
  status ENUM('active','withdrawn') NOT NULL DEFAULT 'active',
  issued_by CHAR(36) NULL,
  issued_by_name VARCHAR(255) NULL,
  withdrawn_at DATETIME NULL,
  withdrawn_by_name VARCHAR(255) NULL,
  withdrawn_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ew_employee (employee_id, status, warning_date),
  KEY idx_ew_issued_by (issued_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
