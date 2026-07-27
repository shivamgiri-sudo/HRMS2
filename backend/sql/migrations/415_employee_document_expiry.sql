-- Migration 415: add expiry tracking fields to employee_documents
-- Enables document-expiry-tracker report (availabilityStatus: under_validation after migration applied)

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS expiry_date        DATE         NULL   AFTER verified,
  ADD COLUMN IF NOT EXISTS reminder_sent_at   DATETIME     NULL   AFTER expiry_date,
  ADD COLUMN IF NOT EXISTS issuing_authority  VARCHAR(255) NULL   AFTER reminder_sent_at,
  ADD COLUMN IF NOT EXISTS document_number    VARCHAR(100) NULL   AFTER issuing_authority;

-- Index to support the expiry tracker report efficiently
CREATE INDEX IF NOT EXISTS idx_emp_doc_expiry ON employee_documents (expiry_date);
