-- Migration 1219: Late invoice tracking on grn_request
-- Allows branch users to flag invoices dated prior to current period
-- with a mandatory reason; Finance Head sees the flag during review

ALTER TABLE grn_request
  ADD COLUMN is_late_invoice  TINYINT(1)    NOT NULL DEFAULT 0 AFTER accounting_period,
  ADD COLUMN late_invoice_reason VARCHAR(500) NULL         AFTER is_late_invoice;

CREATE INDEX idx_grn_request_late_invoice ON grn_request(is_late_invoice);
