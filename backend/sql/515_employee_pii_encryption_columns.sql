-- Migration 515: Additive encrypted PAN / Aadhaar columns on employees
-- These columns hold AES-256-GCM ciphertext produced by backend/src/shared/fieldEncryption.ts.
-- The existing plaintext columns (pan_number, aadhaar_number) are NOT dropped here.
-- A dual-read period is required: read from _encrypted first, fall back to masked plaintext.
-- Plaintext column nullification requires a separate approved migration after verification.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pan_number_encrypted      TEXT        NULL COMMENT 'AES-256-GCM ciphertext of PAN',
  ADD COLUMN IF NOT EXISTS pan_enc_key_version       TINYINT     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS aadhaar_number_encrypted  TEXT        NULL COMMENT 'AES-256-GCM ciphertext of Aadhaar',
  ADD COLUMN IF NOT EXISTS aadhaar_enc_key_version   TINYINT     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pan_number_masked         VARCHAR(20) NULL COMMENT 'Masked representation e.g. ABCDE****F',
  ADD COLUMN IF NOT EXISTS pan_blind_index           CHAR(64)    NULL COMMENT 'HMAC-SHA256 blind index for PAN exact-match lookup';

-- Index for exact-match lookup via blind index (used by payroll/HR searching by PAN)
CREATE INDEX IF NOT EXISTS idx_employees_pan_blind ON employees (pan_blind_index);
