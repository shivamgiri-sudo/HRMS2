-- Migration 1218: Add company_code to grn_request
-- Supports multi-entity GRN creation (MAS / IDC / Pikquick)
-- finance_company table already exists with company_code, company_name, grn_prefix

ALTER TABLE grn_request
  ADD COLUMN company_code VARCHAR(20) NULL AFTER branch_id,
  ADD CONSTRAINT fk_grn_company_code
    FOREIGN KEY (company_code) REFERENCES finance_company(company_code)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX idx_grn_request_company_code ON grn_request(company_code);
