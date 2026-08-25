-- 440_salary_date_revision_requests.sql
-- Salary Date Sync Feature: Employee salary date revision requests table
-- Allows employees/HR to request changes to salary date effective_from
-- with approval workflow support

CREATE TABLE IF NOT EXISTS employee_salary_date_revision_requests (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  employee_id              VARCHAR(50) NOT NULL,
  current_effective_from   DATE NOT NULL,
  requested_effective_from DATE NOT NULL,
  reason                   TEXT NOT NULL,
  status                   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by             INT NOT NULL,
  reviewed_by              INT NULL,
  reviewed_at              DATETIME NULL,
  review_remarks           TEXT NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_esdrr_employee (employee_id),
  INDEX idx_esdrr_status (status)
);
