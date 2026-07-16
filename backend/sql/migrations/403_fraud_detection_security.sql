-- Migration 403: Fraud Detection & Security Enhancement
-- Adds encrypted account storage, OCR extraction tracking, duplicate detection, face matching

-- 1. Add encrypted account number column (AES-256-CBC reversible encryption for penny drop)
ALTER TABLE candidate_onboarding_bank_detail
  ADD COLUMN account_no_encrypted TEXT NULL AFTER account_no_hash;

-- 2. Add OCR extraction columns to documents
ALTER TABLE candidate_onboarding_document
  ADD COLUMN ocr_extracted_number VARCHAR(255) NULL AFTER file_size_bytes,
  ADD COLUMN ocr_extracted_name VARCHAR(255) NULL AFTER ocr_extracted_number,
  ADD COLUMN ocr_extraction_status ENUM('pending','processing','success','failed','skipped') DEFAULT 'pending' AFTER ocr_extracted_name,
  ADD COLUMN ocr_number_match ENUM('matched','mismatch','not_checked','no_number_found') DEFAULT 'not_checked' AFTER ocr_extraction_status,
  ADD COLUMN ocr_raw_text TEXT NULL AFTER ocr_number_match;

-- 3. Fraud alerts table
CREATE TABLE IF NOT EXISTS candidate_fraud_alert (
  id CHAR(36) NOT NULL PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  alert_type ENUM(
    'DUPLICATE_AADHAAR','DUPLICATE_PAN','DUPLICATE_BANK_ACCOUNT',
    'DOCUMENT_NUMBER_MISMATCH','NAME_MISMATCH','FACE_MISMATCH',
    'PROVIDER_NUMBER_MISMATCH','CHEQUE_ACCOUNT_MISMATCH'
  ) NOT NULL,
  severity ENUM('low','medium','high','critical') NOT NULL DEFAULT 'high',
  status ENUM('open','under_review','resolved_fraud','resolved_false_positive','dismissed') NOT NULL DEFAULT 'open',
  details JSON NULL,
  matched_candidate_id CHAR(36) NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  review_notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_status (status),
  INDEX idx_type_status (alert_type, status),
  INDEX idx_matched (matched_candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Face matching results table
CREATE TABLE IF NOT EXISTS candidate_face_match (
  id CHAR(36) NOT NULL PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  photo_document_id CHAR(36) NULL,
  id_document_id CHAR(36) NULL,
  match_score DECIMAL(5,2) NULL,
  match_status ENUM('matched','mismatch','no_face_detected','processing','failed') NOT NULL DEFAULT 'processing',
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Sensitive data access audit log
CREATE TABLE IF NOT EXISTS sensitive_data_access_log (
  id CHAR(36) NOT NULL PRIMARY KEY,
  candidate_id CHAR(36) NULL,
  employee_id CHAR(36) NULL,
  data_type ENUM('bank_account','aadhaar','pan','face_data') NOT NULL,
  action VARCHAR(100) NOT NULL,
  accessed_by CHAR(36) NULL,
  access_reason VARCHAR(255) NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_accessed_by (accessed_by),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Also add encrypted column to ats_candidate for bank
ALTER TABLE ats_candidate
  ADD COLUMN bank_account_no_encrypted TEXT NULL AFTER bank_account_no_hash;
