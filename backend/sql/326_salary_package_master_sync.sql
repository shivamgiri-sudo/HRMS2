-- Migration 326: Salary Package Master System
-- Syncs Band_Master + mas_packagemaster + cost_master from db_bill into mas_hrms
-- Creates the complete lookup-based salary package system
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Salary Band Master (14 bands A–N, monthly CTC ranges) ─────────────────
DROP TABLE IF EXISTS salary_band_master;
CREATE TABLE salary_band_master (
  id           CHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
  band_code    VARCHAR(10) NOT NULL UNIQUE,
  band_name    VARCHAR(100) NOT NULL,
  slab_from    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Monthly CTC lower bound',
  slab_to      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Monthly CTC upper bound',
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_band_active (active_status, band_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Salary bands A–N with monthly CTC ranges. Source: db_bill.Band_Master';

INSERT INTO salary_band_master (band_code, band_name, slab_from, slab_to) VALUES
  ('A', 'Band A', 0, 4000),
  ('B', 'Band B', 4001, 6000),
  ('C', 'Band C', 6001, 7500),
  ('D', 'Band D', 7501, 9000),
  ('E', 'Band E', 9001, 11000),
  ('F', 'Band F', 11001, 15000),
  ('G', 'Band G', 15001, 18000),
  ('H', 'Band H', 18001, 25000),
  ('I', 'Band I', 25001, 35000),
  ('J', 'Band J', 35001, 50000),
  ('K', 'Band K', 50001, 75000),
  ('L', 'Band L', 75001, 100000),
  ('M', 'Band M', 100001, 125000),
  ('N', 'Band N', 125001, 500000)
ON DUPLICATE KEY UPDATE
  band_name = VALUES(band_name), slab_from = VALUES(slab_from), slab_to = VALUES(slab_to),
  active_status = 1, updated_at = NOW();

-- ── 2. Cost Centre Master (branch-wise, with friendly display name) ──────────
CREATE TABLE IF NOT EXISTS salary_cost_centre (
  id              CHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
  cost_centre_code VARCHAR(100) NOT NULL COMMENT 'Raw code e.g. BSS/BO/NOIDA-2/576',
  display_name    VARCHAR(255) NULL COMMENT 'Friendly name e.g. Back Office / Reliance',
  branch_name     VARCHAR(100) NOT NULL COMMENT 'Branch this CC belongs to',
  category        VARCHAR(50) NULL COMMENT 'Voice / BackOffice / Field',
  client_name     VARCHAR(255) NULL COMMENT 'Client company name if applicable',
  process_name    VARCHAR(255) NULL COMMENT 'Process associated with this CC',
  active_status   TINYINT(1) NOT NULL DEFAULT 1,
  source_db       VARCHAR(50) NOT NULL DEFAULT 'db_bill' COMMENT 'Which upstream DB this came from',
  source_id       INT NULL COMMENT 'ID in source table for sync reference',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cc_branch (cost_centre_code, branch_name),
  INDEX idx_branch_active (branch_name, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Cost centres per branch. Display: code (friendly_name). Save: code only.';

-- ── 3. Salary Package Master (pre-calculated component breakdowns) ────────────
CREATE TABLE IF NOT EXISTS salary_package_master (
  id               CHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
  branch_name      VARCHAR(100) NOT NULL,
  cost_centre_code VARCHAR(100) NULL COMMENT 'If NULL, applies to all CCs in that branch',
  band_code        VARCHAR(10) NOT NULL,
  package_amount   DECIMAL(12,2) NOT NULL COMMENT 'Monthly CTC amount',
  basic            DECIMAL(12,2) NOT NULL DEFAULT 0,
  hra              DECIMAL(12,2) NOT NULL DEFAULT 0,
  conveyance       DECIMAL(12,2) NOT NULL DEFAULT 0,
  portfolio        DECIMAL(12,2) NOT NULL DEFAULT 0,
  medical          DECIMAL(12,2) NOT NULL DEFAULT 0,
  special_allowance DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_allowance  DECIMAL(12,2) NOT NULL DEFAULT 0,
  bonus            DECIMAL(12,2) NOT NULL DEFAULT 0,
  pli              DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross            DECIMAL(12,2) NOT NULL DEFAULT 0,
  epf_employee     DECIMAL(12,2) NOT NULL DEFAULT 0,
  esic_employee    DECIMAL(12,2) NOT NULL DEFAULT 0,
  professional_tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_in_hand      DECIMAL(12,2) NOT NULL DEFAULT 0,
  epf_employer     DECIMAL(12,2) NOT NULL DEFAULT 0,
  esic_employer    DECIMAL(12,2) NOT NULL DEFAULT 0,
  admin_charges    DECIMAL(12,2) NOT NULL DEFAULT 0,
  ctc              DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Total CTC including employer costs',
  active_status    TINYINT(1) NOT NULL DEFAULT 1,
  source_db        VARCHAR(50) NOT NULL DEFAULT 'db_bill',
  source_id        INT NULL COMMENT 'ID in mas_packagemaster for sync',
  created_by       CHAR(36) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_branch_band (branch_name, band_code, active_status),
  INDEX idx_branch_cc_band (branch_name, cost_centre_code, band_code, active_status),
  INDEX idx_package_amount (package_amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Pre-calculated salary packages. Lookup: branch + CC + band → available packages with fixed components.';

-- ── 4. State-wise package types (minimum wage compliance) ────────────────────
CREATE TABLE IF NOT EXISTS salary_package_state_wise (
  id              CHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
  state_name      VARCHAR(100) NOT NULL,
  package_type    VARCHAR(100) NOT NULL COMMENT 'Unskilled / Semi Skilled / Skilled / Highly Skilled',
  branch_name     VARCHAR(100) NULL,
  cost_centre_code VARCHAR(100) NULL,
  band_code       VARCHAR(10) NULL,
  package_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  basic           DECIMAL(12,2) NOT NULL DEFAULT 0,
  conveyance      DECIMAL(12,2) NOT NULL DEFAULT 0,
  hra             DECIMAL(12,2) NOT NULL DEFAULT 0,
  bonus           DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross           DECIMAL(12,2) NOT NULL DEFAULT 0,
  epf_employee    DECIMAL(12,2) NOT NULL DEFAULT 0,
  esic_employee   DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_in_hand     DECIMAL(12,2) NOT NULL DEFAULT 0,
  epf_employer    DECIMAL(12,2) NOT NULL DEFAULT 0,
  esic_employer   DECIMAL(12,2) NOT NULL DEFAULT 0,
  admin_charges   DECIMAL(12,2) NOT NULL DEFAULT 0,
  ctc             DECIMAL(12,2) NOT NULL DEFAULT 0,
  active_status   TINYINT(1) NOT NULL DEFAULT 1,
  source_id       INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_state_type (state_name, package_type, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'State-wise minimum wage packages for compliance.';

-- ── 5. Package audit log (track who created/modified packages) ───────────────
CREATE TABLE IF NOT EXISTS salary_package_audit_log (
  id            CHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
  table_name    VARCHAR(50) NOT NULL,
  record_id     CHAR(36) NOT NULL,
  action        ENUM('create','update','delete','sync') NOT NULL,
  changed_by    CHAR(36) NULL,
  change_summary JSON NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_record (table_name, record_id),
  INDEX idx_actor (changed_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. Page catalog entries for admin pages ──────────────────────────────────
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, description) VALUES
  (UUID(), 'SALARY_PACKAGE_ADMIN', 'Salary Package Administration', '/payroll/package-admin', 'PAYROLL',
   'Super Admin / Payroll Head: manage salary bands, packages per branch/cost-centre, state-wise packages'),
  (UUID(), 'SALARY_BAND_MASTER', 'Salary Band Master', '/payroll/bands', 'PAYROLL',
   'View and manage salary bands A–N with monthly CTC ranges');
