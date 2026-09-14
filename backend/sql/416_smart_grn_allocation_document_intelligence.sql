-- 416_smart_grn_allocation_document_intelligence.sql
-- Additive smart-GRN schema: multi-cost-centre allocation, document intelligence,
-- deterministic validation and duplicate-invoice review. Legacy GRN/payment tables remain intact.

CREATE TABLE IF NOT EXISTS grn_cost_allocation (
  id CHAR(36) PRIMARY KEY,
  grn_request_id CHAR(36) NOT NULL,
  sequence_no INT NOT NULL,
  budget_id CHAR(36) NOT NULL,
  budget_line_id CHAR(36) NOT NULL,
  branch_id CHAR(36) NOT NULL,
  process_id CHAR(36) NULL,
  cost_centre_id CHAR(36) NULL,
  cost_class ENUM('direct','indirect') NOT NULL DEFAULT 'direct',
  allocation_percentage DECIMAL(9,6) NOT NULL DEFAULT 0,
  quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
  unit VARCHAR(60) NOT NULL,
  unit_rate DECIMAL(18,4) NOT NULL DEFAULT 0,
  tax_treatment ENUM('inclusive','exclusive','exempt','reverse_charge','non_gst') NOT NULL DEFAULT 'exclusive',
  gst_rate DECIMAL(7,4) NOT NULL DEFAULT 0,
  gst_type ENUM('cgst_sgst','igst','none') NOT NULL DEFAULT 'none',
  recoverable_tax_pct DECIMAL(7,4) NOT NULL DEFAULT 0,
  amount_without_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  cgst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  sgst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  igst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  amount_with_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
  recoverable_tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  pnl_cost_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  lifecycle_status ENUM('draft','reserved','consumed','released') NOT NULL DEFAULT 'draft',
  remarks TEXT NULL,
  reserved_at DATETIME NULL,
  consumed_at DATETIME NULL,
  released_at DATETIME NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_grn_allocation_sequence (grn_request_id, sequence_no),
  INDEX idx_grn_allocation_grn (grn_request_id),
  INDEX idx_grn_allocation_budget_line (budget_line_id),
  INDEX idx_grn_allocation_attribution (branch_id, cost_centre_id, process_id),
  INDEX idx_grn_allocation_lifecycle (lifecycle_status),
  CONSTRAINT fk_grn_allocation_grn
    FOREIGN KEY (grn_request_id) REFERENCES grn_request(id) ON DELETE CASCADE,
  CONSTRAINT fk_grn_allocation_budget
    FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id),
  CONSTRAINT fk_grn_allocation_budget_line
    FOREIGN KEY (budget_line_id) REFERENCES finance_budget_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grn_document (
  id CHAR(36) PRIMARY KEY,
  grn_request_id CHAR(36) NOT NULL,
  document_type ENUM('invoice','receipt','po','contract','supporting','other') NOT NULL DEFAULT 'invoice',
  original_name VARCHAR(255) NOT NULL,
  stored_path VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 CHAR(64) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  extraction_status ENUM('pending','processing','completed','manual_review','failed','not_requested') NOT NULL DEFAULT 'pending',
  uploaded_by CHAR(36) NOT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_grn_document_grn (grn_request_id, uploaded_at),
  INDEX idx_grn_document_hash (sha256),
  INDEX idx_grn_document_extraction (extraction_status),
  CONSTRAINT fk_grn_document_grn
    FOREIGN KEY (grn_request_id) REFERENCES grn_request(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grn_document_extraction (
  id CHAR(36) PRIMARY KEY,
  document_id CHAR(36) NOT NULL,
  grn_request_id CHAR(36) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  model_name VARCHAR(120) NULL,
  status ENUM('completed','manual_review','failed') NOT NULL,
  confidence_score DECIMAL(7,4) NULL,
  raw_text LONGTEXT NULL,
  extracted_fields_json JSON NULL,
  raw_response_json JSON NULL,
  error_message TEXT NULL,
  confirmed_by CHAR(36) NULL,
  confirmed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_grn_extraction_document (document_id, created_at),
  INDEX idx_grn_extraction_grn (grn_request_id, created_at),
  CONSTRAINT fk_grn_extraction_document
    FOREIGN KEY (document_id) REFERENCES grn_document(id) ON DELETE CASCADE,
  CONSTRAINT fk_grn_extraction_grn
    FOREIGN KEY (grn_request_id) REFERENCES grn_request(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grn_validation_result (
  id CHAR(36) PRIMARY KEY,
  grn_request_id CHAR(36) NOT NULL,
  validation_code VARCHAR(100) NOT NULL,
  severity ENUM('info','warning','error') NOT NULL DEFAULT 'info',
  validation_status ENUM('passed','warning','failed','overridden') NOT NULL,
  is_blocking TINYINT(1) NOT NULL DEFAULT 0,
  message VARCHAR(500) NOT NULL,
  details_json JSON NULL,
  overridden_by CHAR(36) NULL,
  override_reason TEXT NULL,
  overridden_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_grn_validation_grn (grn_request_id, created_at),
  INDEX idx_grn_validation_blocking (grn_request_id, is_blocking, validation_status),
  CONSTRAINT fk_grn_validation_grn
    FOREIGN KEY (grn_request_id) REFERENCES grn_request(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grn_duplicate_match (
  id CHAR(36) PRIMARY KEY,
  grn_request_id CHAR(36) NOT NULL,
  matched_grn_request_id CHAR(36) NULL,
  matched_document_id CHAR(36) NULL,
  match_type ENUM('invoice_identity','document_hash','amount_date_vendor','possible') NOT NULL,
  confidence_score DECIMAL(7,4) NOT NULL DEFAULT 0,
  match_details_json JSON NULL,
  review_status ENUM('open','cleared','confirmed_duplicate') NOT NULL DEFAULT 'open',
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  review_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_grn_duplicate_grn (grn_request_id, review_status),
  INDEX idx_grn_duplicate_match (matched_grn_request_id),
  CONSTRAINT fk_grn_duplicate_grn
    FOREIGN KEY (grn_request_id) REFERENCES grn_request(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Guarded parent-column additions preserve all legacy GRNs.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='allocation_mode')=0,
  'ALTER TABLE grn_request ADD COLUMN allocation_mode ENUM(''single'',''split'') NOT NULL DEFAULT ''single'' AFTER cost_class', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='invoice_number')=0,
  'ALTER TABLE grn_request ADD COLUMN invoice_number VARCHAR(150) NULL AFTER vendor_name', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='service_period_start')=0,
  'ALTER TABLE grn_request ADD COLUMN service_period_start DATE NULL AFTER bill_date', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='service_period_end')=0,
  'ALTER TABLE grn_request ADD COLUMN service_period_end DATE NULL AFTER service_period_start', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='purchase_reference')=0,
  'ALTER TABLE grn_request ADD COLUMN purchase_reference VARCHAR(180) NULL AFTER service_period_end', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='vendor_gstin')=0,
  'ALTER TABLE grn_request ADD COLUMN vendor_gstin VARCHAR(20) NULL AFTER purchase_reference', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='place_of_supply')=0,
  'ALTER TABLE grn_request ADD COLUMN place_of_supply VARCHAR(120) NULL AFTER vendor_gstin', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='other_charges')=0,
  'ALTER TABLE grn_request ADD COLUMN other_charges DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER tax_amount', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='round_off_amount')=0,
  'ALTER TABLE grn_request ADD COLUMN round_off_amount DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER other_charges', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='validation_score')=0,
  'ALTER TABLE grn_request ADD COLUMN validation_score DECIMAL(7,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='document_match_status')=0,
  'ALTER TABLE grn_request ADD COLUMN document_match_status ENUM(''not_checked'',''matched'',''near_match'',''mismatch'',''manual_review'') NOT NULL DEFAULT ''not_checked''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='grn_request' AND index_name='idx_grn_invoice_identity')=0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_invoice_identity (vendor_id, invoice_number, bill_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
