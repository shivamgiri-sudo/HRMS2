-- Migration 327: Aadhaar eSign support for appointment letters
-- Adds provider-level transaction tracking, signer identity, and webhook callback state
-- Safe to apply: all new columns with defaults, no existing columns modified.

ALTER TABLE appointment_letter_request
  ADD COLUMN esign_request_id      VARCHAR(255) NULL COMMENT 'Provider eSign request/transaction ID',
  ADD COLUMN esign_signer_name      VARCHAR(255) NULL COMMENT 'Candidate full name for eSign',
  ADD COLUMN esign_signer_email     VARCHAR(255) NULL COMMENT 'Candidate email for eSign notification',
  ADD COLUMN esign_signer_mobile    VARCHAR(20)  NULL COMMENT 'Candidate mobile for Aadhaar OTP SMS',
  ADD COLUMN esign_initiated_at     DATETIME     NULL COMMENT 'When eSign request was sent to provider',
  ADD COLUMN esign_provider_used    VARCHAR(50)  NULL COMMENT 'Provider key at time of signing (digio/infinity_ai/mock)',
  ADD COLUMN generated_at           DATETIME     NULL,
  ADD COLUMN generated_by           CHAR(36)     NULL,
  ADD COLUMN template_data          JSON         NULL;
