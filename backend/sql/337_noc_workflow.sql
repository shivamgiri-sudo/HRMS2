-- Migration 337: NOC workflow for inactive employee salary/FNF release
-- NOC is only required when salary or FNF is pending for a left employee.
-- Upload flow: Branch Payroll uploads → Head Payroll validates → salary/FNF released.

CREATE TABLE IF NOT EXISTS payroll_noc (
  id                  CHAR(36)      NOT NULL,
  employee_id         CHAR(36)      NOT NULL,
  run_month           CHAR(7)       NULL,                    -- YYYY-MM for regular salary; NULL for FNF-only
  ff_calculation_id   CHAR(36)      NULL,                    -- FK to full_final_calculation.id for FNF flow
  noc_type            ENUM('salary','fnf') NOT NULL,
  upload_status       ENUM('pending','uploaded','validated','rejected') NOT NULL DEFAULT 'pending',
  uploaded_by         CHAR(36)      NULL,                    -- Branch Payroll user id
  uploaded_at         DATETIME      NULL,
  doc_path            VARCHAR(500)  NULL,
  doc_original_name   VARCHAR(255)  NULL,
  validated_by        CHAR(36)      NULL,                    -- Head Payroll user id
  validated_at        DATETIME      NULL,
  validation_note     TEXT          NULL,
  rejection_reason    TEXT          NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_noc (employee_id, run_month, noc_type),
  INDEX idx_noc_employee    (employee_id),
  INDEX idx_noc_status      (upload_status),
  INDEX idx_noc_uploaded_by (uploaded_by),
  INDEX idx_noc_validated_by(validated_by)
);
