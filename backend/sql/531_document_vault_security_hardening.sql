-- Document Vault Security Hardening
-- Adds retention policy tables, legal hold tracking, and enhanced audit columns

-- Document retention policy table
CREATE TABLE IF NOT EXISTS document_retention_policy (
  id              VARCHAR(36)   NOT NULL PRIMARY KEY,
  category        VARCHAR(100)  NOT NULL COMMENT 'Document category (e.g., employee-documents, payslips)',
  retention_days  INT           NOT NULL DEFAULT 2555 COMMENT 'Number of days to retain (7 years = 2555)',
  legal_hold_required TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Whether documents in this category can be placed on legal hold',
  deletion_requires_approval TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Whether deletion requires maker-checker approval',
  description     TEXT          NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_retention_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default retention policies
INSERT IGNORE INTO document_retention_policy (id, category, retention_days, legal_hold_required, deletion_requires_approval, description) VALUES
  (UUID(), 'employee-documents', 2555, 1, 1, 'Employee personal documents - 7 year retention'),
  (UUID(), 'payslips', 2555, 1, 1, 'Salary slips - 7 year retention'),
  (UUID(), 'offer-letters', 2555, 1, 1, 'Offer letters - 7 year retention'),
  (UUID(), 'appointment-letters', 2555, 1, 1, 'Appointment letters - 7 year retention'),
  (UUID(), 'tax-documents', 2555, 1, 1, 'Tax declarations and Form 16 - 7 year retention'),
  (UUID(), 'pf-documents', 2555, 1, 1, 'PF/EPF documents - 7 year retention'),
  (UUID(), 'exit-documents', 2555, 1, 1, 'Exit/separation documents - 7 year retention'),
  (UUID(), 'candidate-documents', 365, 0, 0, 'Candidate application documents - 1 year retention'),
  (UUID(), 'employee-photos', 90, 0, 0, 'Employee photos - 90 day retention after separation'),
  (UUID(), 'misc', 365, 0, 0, 'Miscellaneous uploads - 1 year retention');

-- Document legal hold table
CREATE TABLE IF NOT EXISTS document_legal_hold (
  id              VARCHAR(36)   NOT NULL PRIMARY KEY,
  vault_item_id   VARCHAR(36)   NULL COMMENT 'Specific document (null = hold on category)',
  category        VARCHAR(100)  NULL COMMENT 'Category-wide hold (null = hold on specific document)',
  hold_reason     TEXT          NOT NULL COMMENT 'Legal reason for hold (litigation, audit, regulatory)',
  placed_by       VARCHAR(36)   NOT NULL COMMENT 'User who placed the hold',
  placed_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by     VARCHAR(36)   NULL COMMENT 'User who released the hold',
  released_at     DATETIME      NULL,
  release_reason  TEXT          NULL,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  INDEX idx_legal_hold_vault_item (vault_item_id),
  INDEX idx_legal_hold_category (category),
  INDEX idx_legal_hold_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Document deletion request table (maker-checker workflow)
CREATE TABLE IF NOT EXISTS document_deletion_request (
  id              VARCHAR(36)   NOT NULL PRIMARY KEY,
  vault_item_id   VARCHAR(36)   NOT NULL,
  requested_by    VARCHAR(36)   NOT NULL COMMENT 'User requesting deletion',
  requested_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason          TEXT          NOT NULL,
  status          ENUM('pending', 'approved', 'rejected', 'executed') NOT NULL DEFAULT 'pending',
  reviewed_by     VARCHAR(36)   NULL COMMENT 'User who approved/rejected',
  reviewed_at     DATETIME      NULL,
  review_notes    TEXT          NULL,
  executed_at     DATETIME      NULL COMMENT 'When physical deletion was performed',
  quarantine_path VARCHAR(512)  NULL COMMENT 'Path to quarantine copy before deletion',
  INDEX idx_deletion_request_vault_item (vault_item_id),
  INDEX idx_deletion_request_status (status),
  INDEX idx_deletion_request_requested_by (requested_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add quarantine columns to document_vault_inventory if not exist
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'document_vault_inventory'
                   AND COLUMN_NAME = 'quarantine_until');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE document_vault_inventory ADD COLUMN quarantine_until DATETIME NULL COMMENT "File is soft-deleted but preserved until this date"',
  'SELECT "Column quarantine_until already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'document_vault_inventory'
                   AND COLUMN_NAME = 'retention_policy_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE document_vault_inventory ADD COLUMN retention_policy_id VARCHAR(36) NULL COMMENT "Link to document_retention_policy"',
  'SELECT "Column retention_policy_id already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add file validation columns
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'document_vault_inventory'
                   AND COLUMN_NAME = 'magic_bytes_validated');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE document_vault_inventory ADD COLUMN magic_bytes_validated TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Whether file passed magic-byte validation"',
  'SELECT "Column magic_bytes_validated already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'document_vault_inventory'
                   AND COLUMN_NAME = 'quarantine_reason');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE document_vault_inventory ADD COLUMN quarantine_reason VARCHAR(255) NULL COMMENT "Reason if file is quarantined (validation failure, malware, etc)"',
  'SELECT "Column quarantine_reason already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
