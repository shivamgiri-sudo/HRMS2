-- 018_payroll_exit_completion.sql
-- Package 4: Payslip, Tax Declaration, Full & Final, Payroll Disbursement
-- Additive only — no existing tables modified, no SQL executed on production.

-- ─── 1. salary_payslip — additive columns only (table created in 007_payroll.sql) ──
-- Add missing columns: payslip_ref, generated_by, acknowledged_at
-- run_id links to salary_prep_run via prep_line_id → salary_prep_line.run_id join; no additional column needed.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'salary_payslip'
     AND COLUMN_NAME  = 'generated_by') = 0,
  'ALTER TABLE salary_payslip ADD COLUMN generated_by CHAR(36) NULL, ADD COLUMN acknowledged_at DATETIME NULL, ADD COLUMN payslip_ref VARCHAR(64) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 2. tax_declaration ───────────────────────────────────────────────────────
-- Employee investment/income declaration for TDS projection.
-- One row per employee per financial year; upsert on re-submission.
CREATE TABLE IF NOT EXISTS tax_declaration (
  id                 CHAR(36)           NOT NULL DEFAULT (UUID()),
  employee_id        CHAR(36)           NOT NULL,
  financial_year     VARCHAR(9)         NOT NULL COMMENT 'Format: YYYY-YYYY e.g. 2026-2027',
  regime             ENUM('old','new')  NOT NULL DEFAULT 'new',
  total_investment   DECIMAL(12,2)      NOT NULL DEFAULT 0.00,
  declared_hra       DECIMAL(12,2)      NOT NULL DEFAULT 0.00,
  declared_80c       DECIMAL(12,2)      NOT NULL DEFAULT 0.00,
  declared_80d       DECIMAL(12,2)      NOT NULL DEFAULT 0.00,
  tds_projected      DECIMAL(12,2)      NOT NULL DEFAULT 0.00 COMMENT 'Projected annual TDS — provisional only',
  submitted_by       CHAR(36)               NULL,
  created_at         DATETIME           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_taxdecl_emp_year (employee_id, financial_year),
  INDEX idx_taxdecl_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3. full_final_calculation ───────────────────────────────────────────────
-- Full & Final settlement linked to an exit_request.
-- One record per exit; status lifecycle: draft → verified → approved → paid.
CREATE TABLE IF NOT EXISTS full_final_calculation (
  id                        CHAR(36)                                NOT NULL DEFAULT (UUID()),
  exit_request_id           CHAR(36)                                NOT NULL,
  employee_id               CHAR(36)                                NOT NULL,
  calculation_date          DATE                                    NOT NULL,
  notice_period_days        INT                                     NOT NULL DEFAULT 0,
  notice_shortfall_days     INT                                     NOT NULL DEFAULT 0,
  notice_recovery           DECIMAL(12,2)                           NOT NULL DEFAULT 0.00,
  earned_leave_encashment   DECIMAL(12,2)                           NOT NULL DEFAULT 0.00,
  gratuity_amount           DECIMAL(12,2)                           NOT NULL DEFAULT 0.00,
  salary_hold               DECIMAL(12,2)                           NOT NULL DEFAULT 0.00,
  advances_recovery         DECIMAL(12,2)                           NOT NULL DEFAULT 0.00,
  net_payable               DECIMAL(12,2)                           NOT NULL DEFAULT 0.00,
  status                    ENUM('draft','verified','approved','paid') NOT NULL DEFAULT 'draft',
  prepared_by               CHAR(36)                                    NULL,
  approved_by               CHAR(36)                                    NULL,
  approved_at               DATETIME                                    NULL,
  created_at                DATETIME                                NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME                                NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ff_exit (exit_request_id),
  INDEX idx_ff_employee (employee_id),
  CONSTRAINT fk_ff_exit_request
    FOREIGN KEY (exit_request_id) REFERENCES exit_request (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4. payroll_disbursement ─────────────────────────────────────────────────
-- Bank disbursement record for a finalized payroll run.
CREATE TABLE IF NOT EXISTS payroll_disbursement (
  id               CHAR(36)                                          NOT NULL DEFAULT (UUID()),
  run_id           CHAR(36)                                          NOT NULL,
  bank_ref         VARCHAR(128)                                          NULL COMMENT 'Bank transaction / NEFT reference',
  disbursed_at     DATETIME                                              NULL,
  disbursed_by     CHAR(36)                                              NULL,
  total_amount     DECIMAL(14,2)                                     NOT NULL DEFAULT 0.00,
  employee_count   INT                                               NOT NULL DEFAULT 0,
  status           ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  created_at       DATETIME                                          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_disbursement_run (run_id),
  CONSTRAINT fk_disbursement_run
    FOREIGN KEY (run_id) REFERENCES salary_prep_run (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5. Additive ALTERs — full_final_calculation ─────────────────────────────
-- Add is_ff_provisional: marks F&F as draft until statutory fields are verified.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'full_final_calculation'
     AND COLUMN_NAME  = 'is_ff_provisional') = 0,
  'ALTER TABLE full_final_calculation ADD COLUMN is_ff_provisional TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''1 = draft/unverified; 0 = statutory fields verified''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
