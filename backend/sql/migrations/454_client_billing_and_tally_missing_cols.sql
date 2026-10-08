-- Migration 454: add missing columns to tables created in migration 453
-- The initial DDL used different column names than the service code.

ALTER TABLE client_invoice_change_request
  ADD COLUMN requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER requested_by,
  ADD COLUMN decided_by   CHAR(36)  NULL AFTER reviewed_at,
  ADD COLUMN decided_at   DATETIME  NULL AFTER decided_by,
  ADD COLUMN decision_note TEXT     NULL AFTER decided_at;

ALTER TABLE tally_voucher_batch
  ADD COLUMN generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER notes;
