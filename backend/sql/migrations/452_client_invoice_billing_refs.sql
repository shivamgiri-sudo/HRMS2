-- Migration 452: add PO/GRN/JCC/RCM/send-tracking columns to client_invoice
--
-- These columns are already referenced in client-billing-edit.service.ts,
-- client-billing-submit.service.ts, client-billing.service.ts and
-- client-billing-pdf.service.ts but were never added via a migration, so every
-- UPDATE/SELECT that touched them has been silently writing NULLs or failing.
-- Additive-only; no existing column is modified or removed.

ALTER TABLE client_invoice
  ADD COLUMN po_numbers     TEXT         NULL          AFTER grand_total,
  ADD COLUMN grn_no         VARCHAR(100) NULL          AFTER po_numbers,
  ADD COLUMN grn_date       DATE         NULL          AFTER grn_no,
  ADD COLUMN jcc_no         VARCHAR(100) NULL          AFTER grn_date,
  ADD COLUMN jcc_date       DATE         NULL          AFTER jcc_no,
  ADD COLUMN rcm_applicable TINYINT(1)   NOT NULL DEFAULT 0 AFTER jcc_date,
  ADD COLUMN last_sent_at   DATETIME     NULL          AFTER rcm_applicable,
  ADD COLUMN last_sent_by   VARCHAR(36)  NULL          AFTER last_sent_at;
