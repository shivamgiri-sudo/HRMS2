-- 1087_branch_master_gst_registration.sql
-- Gives "Billing State Code" on the GRN screen a data source. It has none today.
--
-- The I-Spark GRN form shows Vendor State Code beside Billing State Code — the vendor's
-- GST state and MAS's own. The vendor side now comes from vendor_master.gst_state_code
-- (migration 1086). The MAS side had nowhere to come from: branch_master carries
-- branch_code / branch_name / city / state / address / pincode / call_centre_code /
-- branch_seq / close_date and no GST registration at all, and there is no company or
-- legal-entity master anywhere in this schema (tenant_config holds one 'MAS Callnet'
-- row and nothing else).
--
-- Per-branch rather than per-company is the correct grain: Indian GST registration is
-- per state, so a multi-state operator holds a separate GSTIN per state it operates in,
-- and the GRN's branch is what determines place of supply.
--
-- IMPORTANT — this migration adds the columns but CANNOT populate them. There is no
-- existing GSTIN anywhere to derive from. Every branch starts NULL, and the GRN form must
-- treat NULL as "not configured" and keep the field blank rather than inventing a code.
-- Finance must fill these in per branch before Billing State Code displays anything.
--
-- Equally important — nothing here may auto-drive tax. grn_request.gst_type
-- ('cgst_sgst' | 'igst' | 'none') is chosen explicitly today and existing GRNs were
-- computed from that choice. Comparing vendor and billing state codes to infer
-- intra- vs inter-state would silently move tax on flows that already reconcile. These
-- columns are display and validation only; deriving gst_type from them is a separate,
-- separately-approved change.
--
-- Additive only, safe to rerun.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'branch_master'
      AND column_name = 'gstin') = 0,
  'ALTER TABLE branch_master
     ADD COLUMN gstin VARCHAR(20) NULL COMMENT ''GST registration for this branch''''s state; NULL = not configured'',
     ADD COLUMN gst_state_code VARCHAR(2) NULL COMMENT ''First two digits of gstin; the billing-side state code on a GRN''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1087_branch_master_gst_registration.sql applied' AS migration_status;
