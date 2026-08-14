-- Migration 1221: GST state codes + GST enable flag on grn_request
-- vendor_state_code: GST state of vendor (auto-populated from vendor_master.gst_state_code)
-- billing_state_code: GST state of the MAS entity's branch (from branch_master.gst_state_code)
-- gst_enabled: explicit Yes/No override by the raiser
-- IGST vs CGST/SGST derivation: vendor_state_code != billing_state_code → IGST

ALTER TABLE grn_request
  ADD COLUMN vendor_state_code  CHAR(2)     NULL AFTER company_code,
  ADD COLUMN billing_state_code CHAR(2)     NULL AFTER vendor_state_code,
  ADD COLUMN gst_enabled        TINYINT(1)  NULL AFTER billing_state_code;
