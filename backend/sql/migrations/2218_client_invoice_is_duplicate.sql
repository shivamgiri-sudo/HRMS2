-- Add is_duplicate flag to client_invoice.
-- Marks billing-error duplicates confirmed in db_bill (same CC/month/amount/client,
-- raised days apart). Flagged rows are excluded from P&L revenue totals.
ALTER TABLE client_invoice
  ADD COLUMN is_duplicate TINYINT(1) NOT NULL DEFAULT 0;
