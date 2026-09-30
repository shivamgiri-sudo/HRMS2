-- 1554_tds_efiling_integration.sql
--
-- Feature: tds-statutory-efiling-integration
-- Task 1: SQL migration for all new tables backing Deductor_Service,
-- Challan_Service, CSI_Import_Engine, Reconciliation_Engine, and the
-- Quarterly_Return obligation/Return_File_Generator tracking, per
-- .kiro/specs/tds-statutory-efiling-integration/design.md's "Data Models" section.
--
-- Creates six new tables only. Does not touch statutory_filing_record or any
-- other existing table. Pure CREATE TABLE — additive, safe to run at any time.

-- Deductor_Service
CREATE TABLE IF NOT EXISTS tds_deductor (
  id                              CHAR(36)      NOT NULL DEFAULT (UUID()),
  tan                             VARCHAR(10)   NOT NULL,   -- AAAA99999A
  deductor_name                   VARCHAR(200)  NOT NULL,
  registered_address              VARCHAR(500)  NOT NULL,
  responsible_person_name         VARCHAR(150)  NOT NULL,
  responsible_person_designation  VARCHAR(100)  NOT NULL,
  responsible_person_pan          VARCHAR(10)   NOT NULL,   -- AAAAA9999A
  is_active                       TINYINT(1)    NOT NULL DEFAULT 1,
  created_by                      CHAR(36)      NOT NULL,
  created_at                      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deactivated_at                  DATETIME      NULL,
  deactivated_by                  CHAR(36)      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tds_deductor_tan_active (tan, is_active),
  KEY idx_tds_deductor_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Note: uk on (tan, is_active) permits re-creating a TAN after a prior record with
-- the same TAN was deactivated (is_active=0), while still preventing two *active*
-- rows for the same TAN (Requirement 1.8), since a duplicate active insert collides
-- on (tan, 1).

CREATE TABLE IF NOT EXISTS tds_deductor_branch (
  id           CHAR(36)  NOT NULL DEFAULT (UUID()),
  deductor_id  CHAR(36)  NOT NULL,
  branch_id    CHAR(36)  NOT NULL,
  created_at   DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_deductor_branch (deductor_id, branch_id),
  FOREIGN KEY (deductor_id) REFERENCES tds_deductor(id) ON DELETE CASCADE,
  KEY idx_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- No row for a deductor = organization-wide TAN (Requirement 1.3).

-- Challan_Service + CSI_Import_Engine + Reconciliation_Engine (one table, two sources)
CREATE TABLE IF NOT EXISTS tds_challan (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  deductor_id            CHAR(36)      NOT NULL,
  source                 ENUM('payroll_entered','traces_csi') NOT NULL,
  filing_month           VARCHAR(7)    NULL,       -- YYYY-MM; set for payroll_entered, may be null for traces_csi until matched
  bsr_code               CHAR(7)       NOT NULL,
  challan_tender_date    DATE          NOT NULL,
  challan_serial_number  INT           NOT NULL,
  deposited_amount       DECIMAL(12,2) NOT NULL,
  cin                    VARCHAR(23)   NOT NULL,    -- derived: bsr_code(7) + DDMMYYYY(8) + serial(<=5) + case-normalized on compare, not on storage
  reconciliation_status  ENUM('unreconciled','reconciled','amount_discrepancy','unmatched') NOT NULL DEFAULT 'unreconciled',
  matched_challan_id     CHAR(36)      NULL,        -- for payroll_entered rows once matched, points to the traces_csi row
  discrepancy_amount     DECIMAL(12,2) NULL,         -- traces-reported amount, when status = amount_discrepancy
  import_batch_id        CHAR(36)      NULL,         -- for traces_csi rows, FK to tds_csi_import_batch
  created_by              CHAR(36)      NOT NULL,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_challan_cin_source (deductor_id, cin, source),  -- Req 3.8 (payroll_entered) and 6.5 (traces_csi), same mechanism
  FOREIGN KEY (deductor_id) REFERENCES tds_deductor(id),
  FOREIGN KEY (matched_challan_id) REFERENCES tds_challan(id),
  KEY idx_challan_month (deductor_id, filing_month),
  KEY idx_challan_status (reconciliation_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tds_csi_import_batch (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  deductor_id      CHAR(36)     NOT NULL,
  date_range_from  DATE         NOT NULL,
  date_range_to    DATE         NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  imported_count   INT          NOT NULL,
  skipped_duplicate_count INT   NOT NULL DEFAULT 0,
  imported_by      CHAR(36)     NOT NULL,
  imported_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (deductor_id) REFERENCES tds_deductor(id),
  KEY idx_batch_deductor (deductor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quarterly_Return obligation tracking (extends the Statutory_Filing_Tracker concept,
-- distinct table from statutory_filing_record — see design.md's Architecture section)
CREATE TABLE IF NOT EXISTS quarterly_return_obligation (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  deductor_id            CHAR(36)      NOT NULL,
  financial_year_start   SMALLINT      NOT NULL,   -- e.g. 2026 for FY 2026-27
  quarter                ENUM('Q1','Q2','Q3','Q4') NOT NULL,
  form_designation       VARCHAR(10)   NOT NULL,   -- '24Q' or '138', resolved at initialize time
  due_date               DATE          NOT NULL,
  current_file_id        CHAR(36)      NULL,       -- FK to quarterly_return_file, current (non-superseded) file
  status                 ENUM('pending','filed') NOT NULL DEFAULT 'pending',
  acknowledgement_number VARCHAR(50)   NULL,
  filed_by               CHAR(36)      NULL,
  filed_at               DATETIME      NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_qro_key (deductor_id, financial_year_start, quarter),  -- Requirement 5.1 key shape
  FOREIGN KEY (deductor_id) REFERENCES tds_deductor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Return_File_Generator output records
CREATE TABLE IF NOT EXISTS quarterly_return_file (
  id                          CHAR(36)      NOT NULL DEFAULT (UUID()),
  obligation_id               CHAR(36)      NOT NULL,
  vault_document_id           CHAR(36)      NOT NULL,  -- the FVU-style text file, in document_vault_inventory
  form27a_vault_document_id   CHAR(36)      NOT NULL,  -- the Form 27A chart, in document_vault_inventory
  form_designation            VARCHAR(10)   NOT NULL,
  challan_count                INT           NOT NULL,
  total_tax_deducted           DECIMAL(14,2) NOT NULL,
  deductee_count                INT           NOT NULL,
  total_amount_paid             DECIMAL(14,2) NOT NULL,
  excluded_employees_json      JSON          NULL,      -- [{employee_id, reason}]
  generated_by                 CHAR(36)      NOT NULL,
  generated_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at                 DATETIME      NULL,      -- set when a newer generation supersedes this row
  PRIMARY KEY (id),
  FOREIGN KEY (obligation_id) REFERENCES quarterly_return_obligation(id),
  KEY idx_file_obligation (obligation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Every persisted row here has already passed self-validation — a failed generation
-- is never written here at all (Requirement 9), so there is no "invalid" status to model.
