-- 178_tax_declaration_form12bb.sql
-- Additive Form 12BB detail layer. The original tax_declaration table remains
-- the payroll-compatible summary and API paths remain unchanged.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS tax_declaration_form12bb_detail (
  declaration_id              CHAR(36)      NOT NULL,
  declared_ltc                DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  declared_home_loan_interest DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  declared_nps_80ccd1b        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  declared_80e                DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  declared_80g                DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  declared_other_chapter_via  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  other_income                DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  employee_consent            TINYINT(1)    NOT NULL DEFAULT 0,
  submission_status           ENUM('draft','submitted','verified','rejected')
                                             NOT NULL DEFAULT 'draft',
  submitted_at                DATETIME       NULL,
  verified_by                 CHAR(36)       NULL,
  verified_at                 DATETIME       NULL,
  review_note                 TEXT           NULL,
  created_at                  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (declaration_id),
  INDEX idx_tax12bb_status (submission_status),
  CONSTRAINT fk_tax12bb_declaration
    FOREIGN KEY (declaration_id) REFERENCES tax_declaration(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Extended Form 12BB declaration values and submission workflow';
