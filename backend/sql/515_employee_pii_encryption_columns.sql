-- Migration 515: Additive encrypted PAN / Aadhaar columns on employees
-- These columns hold AES-256-GCM ciphertext produced by backend/src/shared/fieldEncryption.ts.
-- The existing plaintext columns (pan_number, aadhaar_number) are NOT dropped here.
-- A dual-read period is required: read from _encrypted first, fall back to masked plaintext.
-- Plaintext column nullification requires a separate approved migration after verification.

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'pan_number_encrypted');
SET @sql = IF(@col = 0, 'ALTER TABLE employees ADD COLUMN pan_number_encrypted TEXT NULL COMMENT ''AES-256-GCM ciphertext of PAN''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'pan_enc_key_version');
SET @sql = IF(@col = 0, 'ALTER TABLE employees ADD COLUMN pan_enc_key_version TINYINT NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'aadhaar_number_encrypted');
SET @sql = IF(@col = 0, 'ALTER TABLE employees ADD COLUMN aadhaar_number_encrypted TEXT NULL COMMENT ''AES-256-GCM ciphertext of Aadhaar''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'aadhaar_enc_key_version');
SET @sql = IF(@col = 0, 'ALTER TABLE employees ADD COLUMN aadhaar_enc_key_version TINYINT NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'pan_number_masked');
SET @sql = IF(@col = 0, 'ALTER TABLE employees ADD COLUMN pan_number_masked VARCHAR(20) NULL COMMENT ''Masked representation e.g. ABCDE****F''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'pan_blind_index');
SET @sql = IF(@col = 0, 'ALTER TABLE employees ADD COLUMN pan_blind_index CHAR(64) NULL COMMENT ''HMAC-SHA256 blind index for PAN exact-match lookup''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index for exact-match lookup via blind index (used by payroll/HR searching by PAN)
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_employees_pan_blind');
SET @sql = IF(@idx = 0, 'CREATE INDEX idx_employees_pan_blind ON employees (pan_blind_index)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
