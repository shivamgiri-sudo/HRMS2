-- 1650_backfill_active_branch_gstin.sql
--
-- WHY
-- ---
-- branch_master.gstin has been NULL on every branch since the column was added (migration 1087)
-- — gst_state_code was backfilled (1243) but gstin itself never was. This is the join key
-- gst-export.service.ts's collectRows() filters on (`WHERE bm.gstin = ?`), so the GST/Tally
-- export (export_type TALLY_SALES/GSTR1/GSTR3B_OUTWARD) has generated ZERO rows since it
-- shipped (migration 1520) — confirmed live: gst_export_batch has never held a single row, and
-- the daily gst-export-auto worker logs "no branch carries a GSTIN" every cycle it has ever run.
--
-- THE FOUR GSTINs come from db_bill.tbl_tally_row_invoice_data.CompanyGSTNo (recovered
-- 2026-08-20, each independently verified against the statutory modulus-36 check digit — see
-- isValidGstin() in gst-export.service.ts, the same algorithm). This migration maps each one to
-- the branch(es) it actually belongs to via branch_master.company_name, which already carries
-- the correct legal-entity name per branch and was NOT invented for this migration:
--
--   09AAACM5866H1Z6  Mas Callnet India Pvt Ltd / MAS Call Net India Pvt Ltd,  UP (09)
--   24AAACM5866H1ZE  Mas Callnet India Pvt Ltd,                              Gujarat (24)
--   09AAFCM4591G1Z7  Ispark Dataconnect Pvt Ltd (IDC, a related party),      UP (09)
--
-- Confirmed live against actual current-year invoicing before writing this: every branch that
-- has raised a client_invoice in FY2026-27 (since 2026-04-01) is one of these five, and the sum
-- (269 + 93 + 32 + 26 + 7 = 427) matches the independently-documented FY2026-27 invoice count in
-- gst-return-readiness notes exactly. No other currently-active branch invoices in this FY.
--
-- WHAT THIS DELIBERATELY DOES NOT COVER
-- The "DELHI" and "VDF MANPOWER" legacy branches carry ~1,132 historical invoices under Delhi's
-- GST state (07) — last dated 2026-03-31, none in the current FY. No GSTIN for state 07 exists
-- anywhere in db_bill (checked tbl_tally_row_invoice_data and every invoice's own ser_tax_no —
-- all blank). That is a real, human-only gap: someone has to supply the actual Delhi GST
-- certificate. Left NULL on purpose, not missed.
--
-- SAFE TO APPLY: five single-row UPDATEs, each guarded on the branch's own id AND
-- `gstin IS NULL`, so it can never overwrite a value entered by hand in the meantime and is a
-- no-op on re-run. No new column, no new table, no row deleted.

UPDATE branch_master SET gstin = '09AAACM5866H1Z6'
 WHERE id = '77769026-5e88-11f1-adb1-00155d0ab410' AND gstin IS NULL; -- NOIDA

UPDATE branch_master SET gstin = '09AAACM5866H1Z6'
 WHERE id = 'febd8777-6583-11f1-adb1-00155d0ab410' AND gstin IS NULL; -- NOIDA-2

UPDATE branch_master SET gstin = '09AAACM5866H1Z6'
 WHERE id = 'fea9fdc3-6583-11f1-adb1-00155d0ab410' AND gstin IS NULL; -- HEAD OFFICE

UPDATE branch_master SET gstin = '24AAACM5866H1ZE'
 WHERE id = 'fea10538-6583-11f1-adb1-00155d0ab410' AND gstin IS NULL; -- AHMEDABAD-JALDARSHAN

UPDATE branch_master SET gstin = '09AAFCM4591G1Z7'
 WHERE id = 'febeee54-6583-11f1-adb1-00155d0ab410' AND gstin IS NULL; -- NOIDA-DIALDESK (IDC)
