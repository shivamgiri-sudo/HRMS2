-- Migration 1218: GRN Phase A — all new columns for company, late invoice,
-- unbudgeted flag, and GST state codes. One migration, two tables touched.

ALTER TABLE grn_request
  ADD COLUMN company_code        VARCHAR(20)   NULL        AFTER branch_id,
  ADD COLUMN vendor_state_code   CHAR(2)       NULL        AFTER company_code,
  ADD COLUMN billing_state_code  CHAR(2)       NULL        AFTER vendor_state_code,
  ADD COLUMN gst_enabled         TINYINT(1)    NULL        AFTER billing_state_code,
  ADD COLUMN is_late_invoice     TINYINT(1)    NOT NULL DEFAULT 0 AFTER accounting_period,
  ADD COLUMN late_invoice_reason VARCHAR(500)  NULL        AFTER is_late_invoice,
  ADD COLUMN is_unbudgeted       TINYINT(1)    NOT NULL DEFAULT 0 AFTER is_late_invoice,
  ADD CONSTRAINT fk_grn_company_code
    FOREIGN KEY (company_code) REFERENCES finance_company(company_code)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE grn_cost_allocation
  ADD COLUMN is_unbudgeted TINYINT(1) NOT NULL DEFAULT 0 AFTER sequence_no;

CREATE INDEX idx_grn_request_company      ON grn_request(company_code);
CREATE INDEX idx_grn_request_late_invoice ON grn_request(is_late_invoice);
CREATE INDEX idx_grn_request_unbudgeted   ON grn_request(is_unbudgeted);
CREATE INDEX idx_grn_alloc_unbudgeted     ON grn_cost_allocation(is_unbudgeted);
