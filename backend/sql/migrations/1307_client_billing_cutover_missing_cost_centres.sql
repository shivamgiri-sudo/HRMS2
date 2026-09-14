-- 1307_client_billing_cutover_missing_cost_centres.sql
--
-- Client Billing Historical Cutover — creates 8 cost_centre_master rows that
-- were billed against in db_bill (tbl_invoice) but never actually created in
-- cost_centre_master, discovered while investigating the 87 unresolved
-- cost_centre_id rows in the cutover's validation report
-- (docs/superpowers/plans/2026-08-19-client-billing-cutover-validation-report.md,
--  docs/superpowers/specs/2026-08-19-client-billing-cutover-addendum.md A3).
--
-- These 8 are the "recent" cluster only (all finance_year 2026-27, 18 of the
-- 87 unresolved invoice rows) — sequential-numbered gaps sitting directly next
-- to real, active, currently-billed cost centres for the same
-- branch/process/company (e.g. BSS/IB/NOIDA-DD/1028 through 1033 already
-- exist and are active; 1034-1040 do not). The other 67 unresolved rows (from
-- 2015-16/2016-17, predating the current cost-centre numbering scheme
-- entirely) are NOT created here — no reliable current equivalent exists for
-- those, and this migration does not attempt to guess one.
--
-- Each of these 8 codes references a genuinely distinct real client on the
-- legacy invoice itself (RARE BASICS PRIVATE LIMITED, TIC BEVERAGES PRIVATE
-- LIMITED, AYURVEDA HOUSE PRIVATE LIMITED, SISHA GREEN TECH PRIVATE LIMITED,
-- Draco Brands Private Limited, INTERNETWALE ONLINE SERVICES (OPC) PRIVATE
-- LIMITED, Ride Zipo, ONROADS INDIA ASSISTANCE SERVICES PRIVATE LIMITED, each
-- with its own distinct GSTIN except "Ride Zipo" whose legacy GSTIN is the
-- literal placeholder "0000000000000" — not a real number, so vendor_gst_no
-- is left NULL for that one row rather than storing a fabricated-looking
-- value) — a strong signal these are 8 real, distinct billing relationships
-- that were simply never onboarded into cost_centre_master, not duplicates
-- or test data.
--
-- company_name / branch_id / process_type / stream / cc_category / cc_type
-- are copied from each new row's real, active sibling in the same
-- branch+process family (BSS/IB/NOIDA-DD/1028 for the 7 IDC/NOIDA-DIALDESK
-- codes, BSS/BO/CORP/1032 for the 1 Mas Callnet/HEAD OFFICE code) — read live
-- off cost_centre_master at authoring time, not guessed. billing_client_name/
-- vendor_gst_no/vendor_gst_state come from each code's own legacy invoice
-- data (client_invoice_migration_staging.src_cost_client/
-- src_cost_vendorgstno/src_cost_vendorgststate), not copied from the sibling.
--
-- Idempotent: cost_centre_code has no unique constraint in this schema
-- (confirmed live before writing this file), so this uses an explicit
-- existence check per row rather than ON DUPLICATE KEY UPDATE.
--
-- Rollback: DELETE FROM cost_centre_master WHERE cost_centre_code IN (
--   'BSS/BO/CORP/1033','BSS/IB/NOIDA-DD/1034','BSS/IB/NOIDA-DD/1035',
--   'BSS/IB/NOIDA-DD/1036','BSS/IB/NOIDA-DD/1038','BSS/IB/NOIDA-DD/1039',
--   'BSS/IB/NOIDA-DD/1040','BSS/OB/NOIDA-DD/1037'
-- ) AND created_at >= '2026-08-19' AND active_status = 1
-- AND revenue_flag = 1 AND billing_flag = 0; -- (the exact literal set this
-- migration inserts, safe as long as no later manual edit changed these rows)

INSERT INTO cost_centre_master (
  id, cost_centre_code, company_name, cost_centre_name, branch_id,
  active_status, stream, process_type, cc_category, cc_type, status,
  billing_client_name, vendor_gst_no, vendor_gst_state,
  revenue_flag, billing_flag
)
SELECT
  UUID(), 'BSS/BO/CORP/1033', 'Mas Callnet India Pvt Ltd', 'BSS/BO/CORP/1033',
  'fea9fdc3-6583-11f1-adb1-00155d0ab410',
  1, '28', 'BACK OFFICE', 'BackOffice', 'BACK OFFICE', 'active',
  'ONROADS INDIA ASSISTANCE SERVICES PRIVATE LIMITED', '07AADCO5195L1ZY', 'Uttar Pradesh',
  1, 0
WHERE NOT EXISTS (SELECT 1 FROM cost_centre_master WHERE cost_centre_code = 'BSS/BO/CORP/1033');

INSERT INTO cost_centre_master (
  id, cost_centre_code, company_name, cost_centre_name, branch_id,
  active_status, stream, process_type, cc_category, cc_type, status,
  billing_client_name, vendor_gst_no, vendor_gst_state,
  revenue_flag, billing_flag
)
SELECT
  UUID(), 'BSS/IB/NOIDA-DD/1034', 'IDC', 'BSS/IB/NOIDA-DD/1034',
  'febeee54-6583-11f1-adb1-00155d0ab410',
  1, '37', 'DIALDESK', 'Voice', 'Inbound', 'active',
  'RARE BASICS PRIVATE LIMITED', '06AAPCR5432B1ZI', 'HARYANA',
  1, 0
WHERE NOT EXISTS (SELECT 1 FROM cost_centre_master WHERE cost_centre_code = 'BSS/IB/NOIDA-DD/1034');

INSERT INTO cost_centre_master (
  id, cost_centre_code, company_name, cost_centre_name, branch_id,
  active_status, stream, process_type, cc_category, cc_type, status,
  billing_client_name, vendor_gst_no, vendor_gst_state,
  revenue_flag, billing_flag
)
SELECT
  UUID(), 'BSS/IB/NOIDA-DD/1035', 'IDC', 'BSS/IB/NOIDA-DD/1035',
  'febeee54-6583-11f1-adb1-00155d0ab410',
  1, '37', 'DIALDESK', 'Voice', 'Inbound', 'active',
  'Ride Zipo', NULL, NULL,
  1, 0
WHERE NOT EXISTS (SELECT 1 FROM cost_centre_master WHERE cost_centre_code = 'BSS/IB/NOIDA-DD/1035');

INSERT INTO cost_centre_master (
  id, cost_centre_code, company_name, cost_centre_name, branch_id,
  active_status, stream, process_type, cc_category, cc_type, status,
  billing_client_name, vendor_gst_no, vendor_gst_state,
  revenue_flag, billing_flag
)
SELECT
  UUID(), 'BSS/IB/NOIDA-DD/1036', 'IDC', 'BSS/IB/NOIDA-DD/1036',
  'febeee54-6583-11f1-adb1-00155d0ab410',
  1, '37', 'DIALDESK', 'Voice', 'Inbound', 'active',
  'TIC BEVERAGES PRIVATE LIMITED', '06AAKCT0878N1ZO', 'HARYANA',
  1, 0
WHERE NOT EXISTS (SELECT 1 FROM cost_centre_master WHERE cost_centre_code = 'BSS/IB/NOIDA-DD/1036');

INSERT INTO cost_centre_master (
  id, cost_centre_code, company_name, cost_centre_name, branch_id,
  active_status, stream, process_type, cc_category, cc_type, status,
  billing_client_name, vendor_gst_no, vendor_gst_state,
  revenue_flag, billing_flag
)
SELECT
  UUID(), 'BSS/OB/NOIDA-DD/1037', 'IDC', 'BSS/OB/NOIDA-DD/1037',
  'febeee54-6583-11f1-adb1-00155d0ab410',
  1, '37', 'DIALDESK', 'Voice', 'Inbound', 'active',
  'Draco Brands Private Limited', '06AAJCD0713B1ZC', 'HARYANA',
  1, 0
WHERE NOT EXISTS (SELECT 1 FROM cost_centre_master WHERE cost_centre_code = 'BSS/OB/NOIDA-DD/1037');

INSERT INTO cost_centre_master (
  id, cost_centre_code, company_name, cost_centre_name, branch_id,
  active_status, stream, process_type, cc_category, cc_type, status,
  billing_client_name, vendor_gst_no, vendor_gst_state,
  revenue_flag, billing_flag
)
SELECT
  UUID(), 'BSS/IB/NOIDA-DD/1038', 'IDC', 'BSS/IB/NOIDA-DD/1038',
  'febeee54-6583-11f1-adb1-00155d0ab410',
  1, '37', 'DIALDESK', 'Voice', 'Inbound', 'active',
  'INTERNETWALE ONLINE SERVICES (OPC) PRIVATE LIMITED', '06AAICI5112N1ZG', 'HARYANA',
  1, 0
WHERE NOT EXISTS (SELECT 1 FROM cost_centre_master WHERE cost_centre_code = 'BSS/IB/NOIDA-DD/1038');

INSERT INTO cost_centre_master (
  id, cost_centre_code, company_name, cost_centre_name, branch_id,
  active_status, stream, process_type, cc_category, cc_type, status,
  billing_client_name, vendor_gst_no, vendor_gst_state,
  revenue_flag, billing_flag
)
SELECT
  UUID(), 'BSS/IB/NOIDA-DD/1039', 'IDC', 'BSS/IB/NOIDA-DD/1039',
  'febeee54-6583-11f1-adb1-00155d0ab410',
  1, '37', 'DIALDESK', 'Voice', 'Inbound', 'active',
  'AYURVEDA HOUSE PRIVATE LIMITED', '07AAXCA1053H1ZK', 'DELHI',
  1, 0
WHERE NOT EXISTS (SELECT 1 FROM cost_centre_master WHERE cost_centre_code = 'BSS/IB/NOIDA-DD/1039');

INSERT INTO cost_centre_master (
  id, cost_centre_code, company_name, cost_centre_name, branch_id,
  active_status, stream, process_type, cc_category, cc_type, status,
  billing_client_name, vendor_gst_no, vendor_gst_state,
  revenue_flag, billing_flag
)
SELECT
  UUID(), 'BSS/IB/NOIDA-DD/1040', 'IDC', 'BSS/IB/NOIDA-DD/1040',
  'febeee54-6583-11f1-adb1-00155d0ab410',
  1, '37', 'DIALDESK', 'Voice', 'Inbound', 'active',
  'SISHA GREEN TECH PRIVATE LIMITED', '09ABLCS1527K1ZY', 'UTTAR PRADESH',
  1, 0
WHERE NOT EXISTS (SELECT 1 FROM cost_centre_master WHERE cost_centre_code = 'BSS/IB/NOIDA-DD/1040');