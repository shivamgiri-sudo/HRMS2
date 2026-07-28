-- 424_employee_reimbursement_claim.sql
-- Canonical schema for employee payroll reimbursement claims.
-- Replaces reliance on route-import-time CREATE TABLE while remaining additive and idempotent.

USE mas_hrms;

CREATE TABLE IF NOT EXISTS employee_reimbursement_claim (
  id                CHAR(36)                                                    NOT NULL,
  employee_id       VARCHAR(36)                                                 NOT NULL,
  claim_type        ENUM('LTA','MEDICAL','INTERNET','PHONE','FUEL','OTHER')     NOT NULL,
  claim_month       VARCHAR(7)                                                  NOT NULL,
  amount_claimed    DECIMAL(10,2)                                               NOT NULL,
  amount_approved   DECIMAL(10,2)                                               NULL,
  description       TEXT                                                        NULL,
  documents_url     VARCHAR(500)                                                NULL,
  status            ENUM('draft','submitted','approved','rejected','processed') NOT NULL DEFAULT 'draft',
  submitted_at      DATETIME                                                    NULL,
  approved_by       VARCHAR(36)                                                 NULL,
  approved_at       DATETIME                                                    NULL,
  rejected_by       VARCHAR(36)                                                 NULL,
  rejected_at       DATETIME                                                    NULL,
  rejection_reason  TEXT                                                        NULL,
  payroll_run_id    VARCHAR(36)                                                 NULL,
  processed_at      DATETIME                                                    NULL,
  created_at        DATETIME                                                    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME                                                    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_erc_emp (employee_id),
  KEY idx_erc_month (claim_month),
  KEY idx_erc_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 424 applied: employee reimbursement claim schema ready' AS status;
