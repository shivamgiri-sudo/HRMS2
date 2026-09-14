-- 1305_client_billing_cutover_staging_fix.sql
--
-- Client Billing Historical Cutover — Task 2 (extraction script) prerequisite fix.
-- (docs/superpowers/plans/2026-08-19-client-billing-cutover.md Task 2,
--  docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md §6)
--
-- ── What went wrong in 1304 ─────────────────────────────────────────────────
-- 1304_client_billing_cutover_schema.sql's two ALTER TABLEs (client_invoice /
-- client_credit_note .is_migrated + .legacy_id) applied cleanly at boot
-- (2026-08-19 09:38, executor Work:25124, confirmed live via information_schema
-- before this file was written: both columns exist on both tables). Its THIRD
-- statement — CREATE TABLE client_invoice_migration_staging — failed on the same
-- run with a real InnoDB error, not a syntax error:
--   "Row size too large. The maximum row size for the used table type, not
--    counting BLOBs, is 65535."
-- schema_migrations recorded this as success=0 (error_message column holds the
-- exact text above), which per runPendingMigrations.ts's own governance
-- (buildSchemaMigrationsAppliedRowsQuery filters `success = 1 OR success IS
-- NULL`) means 1304 is NOT in the applied set and WILL be retried at every
-- future boot — its two ALTERs will no-op (information_schema-guarded) but its
-- CREATE TABLE will keep failing with the identical error forever, because nothing
-- in 1304's own file text changes between retries. That is a real, live defect,
-- not a hypothetical: independently confirmed by reproducing the identical error
-- against a throwaway table (x_cims_rowfmt_test_20260819, dropped immediately
-- after) carrying 1304's exact column list, before this file was written.
--
-- Root cause, computed: 105 src_ columns (all copied verbatim off db_bill's own
-- live information_schema — same source 1304 used) plus 7 target/validation
-- columns, almost entirely utf8mb4 VARCHAR, sum to ~68,900 bytes of worst-case
-- inline row storage under InnoDB's row-size accounting — about 3,300 bytes over
-- the 65,535 ceiling. ROW_FORMAT=DYNAMIC alone does NOT fix this (also
-- independently reproduced against the same throwaway table: identical error) —
-- empirically, DYNAMIC's off-page eligibility does not exempt plain VARCHAR
-- columns from the static CREATE-TIME row-size check the way TEXT/BLOB columns
-- are exempted (the error message's own "not counting BLOBs" is the actual
-- escape hatch). Fix applied: the four widest legacy columns that already read
-- as free-text remarks/paths rather than structured fields — filepath,
-- eptp_act_remarks, his_eptp_act_date, his_eptp_act_remarks, all originally
-- VARCHAR(1000) — are TEXT here instead, removing ~16,000 bytes of inline
-- accounting (comfortably above the ~3,300-byte overage) with the row's actual
-- semantics unchanged: these were never used as filter/sort/index targets in
-- 1304's own design (no index touches any of them), so nothing downstream reads
-- them differently as TEXT vs VARCHAR(1000). Verified live before this file was
-- written: the corrected DDL (identical to below) created successfully against
-- the same throwaway table name, then dropped.
--
-- ── Why a new file, not editing 1304 ────────────────────────────────────────
-- Per this plan's own explicit instruction (Task 2, "don't hand-edit 1304 —
-- another concurrent session may already be building on it") and this repo's
-- long-standing precedent for exactly this situation (1116/1128/1211/1217/1218,
-- each re-running DDL an earlier migration should have applied but didn't,
-- in a NEW numbered file, never editing the original): 1304's own text is left
-- untouched. This file's CREATE TABLE IF NOT EXISTS is naturally idempotent
-- against 1304's retry — once this file creates the table for real, 1304's own
-- (unchanged, still-buggy) CREATE TABLE IF NOT EXISTS statement will see the
-- table already exists and silently no-op on its next retry, which flips 1304's
-- own schema_migrations row to success=1 with no further action needed.
--
-- ── client_credit_note_migration_staging — new, not in 1304 at all ─────────
-- Task 2 (this plan) also extracts db_bill.tbl_credit_note. 1304's design left
-- the credit-note staging shape as this task's own judgment call (plan Task 2
-- Step 2: "extend Task 1's staging table with a kind discriminator column, or
-- add a second staging table — implementer's judgment, note which and why").
-- Decision: a SECOND staging table, not a shared one with a discriminator.
-- tbl_credit_note has 39 columns total (verified live off db_bill's own
-- information_schema, same as tbl_invoice's 106) and only a handful map
-- 1:1 by name to tbl_invoice's columns (total/tax/igst/sgst/cgst/grnd/username/
-- status/createdate/category/branch_name/cost_center/finance_year/month/
-- app_tax_cal/GSTType/bill_finance_year/BillNoChange/state_code/PaymentStatus/
-- subs_start_date/subs_end_date/plan_id/krishi_tax/apply_krishi_tax/
-- apply_service_tax/apply_gst/ReceiptStatus) — the rest (creditDate vs
-- invoiceDate, creditDescription vs invoiceDescription, credit_no vs bill_no,
-- credit_approve/credit_approved_by/credit_approved_date, which have no invoice
-- analog at all, and the complete absence of the ~70 cost_*/eptp_*/InvoiceType*
-- columns tbl_invoice carries) do not share tbl_invoice's shape closely enough
-- for a single wide table with a `kind` flag to avoid being mostly-NULL noise
-- in whichever direction it's read. A second, purpose-shaped table each row
-- naturally belongs to is the more honest raw-copy of what db_bill actually
-- has. Column set below is read directly off db_bill.tbl_credit_note's live
-- information_schema.COLUMNS, src_-prefixed, same as 1304's own tbl_invoice
-- table — not hand-transcribed.
--
-- ── Safety ──────────────────────────────────────────────────────────────────
-- Two CREATE TABLE IF NOT EXISTS statements only — no ALTER of client_invoice/
-- client_credit_note (already done by 1304, untouched here), no DROP, no DELETE,
-- no FK to any table outside this plan's own scope. Both tables start empty and
-- are the same throwaway/dropped-after-cutover staging scope 1304's own header
-- already describes. Every statement in this file was verified live (created
-- successfully, then dropped) against the real mas_hrms connection before this
-- file was committed — see this task's own report for the exact command/output.
--
-- Rollback:
--   DROP TABLE IF EXISTS client_credit_note_migration_staging;
--   DROP TABLE IF EXISTS client_invoice_migration_staging;
--
-- ── Deployment ──────────────────────────────────────────────────────────────
-- Registered in runPendingMigrations.ts's MIGRATION_MANIFEST (and the
-- regenerated lock file) so it applies at the next pm2 restart in the normal
-- way. Given the shared-dev-server auto-apply quirk already documented on 1304
-- itself, this task also created both tables directly via the same DDL below
-- (not INSERTing any data through this file — extraction is a separate script)
-- so Task 2's own extraction script has a real table to write into without
-- waiting on the next restart; see this task's own report for that command's
-- real output.

-- ── client_invoice_migration_staging (corrected) ────────────────────────────
CREATE TABLE IF NOT EXISTS client_invoice_migration_staging (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,

  -- every db_bill.tbl_invoice column verbatim, src_-prefixed (106 columns,
  -- read from db_bill's live information_schema.COLUMNS — identical list to
  -- 1304's own, four widest free-text columns changed VARCHAR(1000) -> TEXT,
  -- see header)
  src_id INT(11) NULL,
  src_invoicetype VARCHAR(50) NULL,
  src_category VARCHAR(100) NULL,
  src_branch_name VARCHAR(50) NULL,
  src_cost_center VARCHAR(50) NULL,
  src_finance_year VARCHAR(50) NULL,
  src_month VARCHAR(50) NULL,
  src_invoicedate VARCHAR(50) NULL,
  src_app_tax_cal VARCHAR(50) NULL,
  src_invoicedescription VARCHAR(200) NULL,
  src_jcc_no VARCHAR(200) NULL,
  src_proforma_bill_no VARCHAR(50) NULL,
  src_proforma_approve INT(1) NULL,
  src_bill_no VARCHAR(200) NULL,
  src_po_no VARCHAR(200) NULL,
  src_po_createdate DATETIME NULL,
  src_ser_tax_no VARCHAR(200) NULL,
  src_ser_tax_category VARCHAR(200) NULL,
  src_pan_no VARCHAR(200) NULL,
  src_grn VARCHAR(200) NULL,
  src_grn_createdate DATETIME NULL,
  src_total VARCHAR(200) NULL,
  src_tax VARCHAR(200) NULL,
  src_igst VARCHAR(50) NULL,
  src_sgst VARCHAR(50) NULL,
  src_cgst VARCHAR(50) NULL,
  src_grnd VARCHAR(200) NULL,
  src_approve_po VARCHAR(50) NULL,
  src_approve_grn VARCHAR(50) NULL,
  src_username VARCHAR(100) NULL,
  src_view_ahmedabad VARCHAR(200) NULL,
  src_filepath TEXT NULL,
  src_status INT(1) NULL,
  src_createdate DATETIME NULL,
  src_sbctax VARCHAR(200) NULL,
  src_krishi_tax INT(10) NULL,
  src_apply_krishi_tax INT(1) NULL,
  src_apply_service_tax INT(1) NULL,
  src_apply_gst INT(1) NULL,
  src_receiptstatus INT(5) NULL,
  src_po_date DATETIME NULL,
  src_po_remarks VARCHAR(100) NULL,
  src_grn_date DATETIME NULL,
  src_grn_remarks VARCHAR(100) NULL,
  src_gsttype VARCHAR(50) NULL,
  src_bill_finance_year VARCHAR(20) NULL,
  src_billnochange INT(1) NULL,
  src_state_code VARCHAR(2) NULL,
  src_paymentstatus VARCHAR(1) NULL,
  src_requestinvoicetype VARCHAR(100) NULL,
  src_currentinvoicetype VARCHAR(100) NULL,
  src_invoicetypeapproval VARCHAR(50) NULL,
  src_invoicetypeapproveby INT(11) NULL,
  src_invoicetypeapprovedate DATETIME NULL,
  src_invoicetyperemarks VARCHAR(500) NULL,
  src_invoicerejectrequest VARCHAR(20) NULL,
  src_invoicedeleteremarks VARCHAR(500) NULL,
  src_invoicerejectby INT(11) NULL,
  src_invoicerejectdate DATETIME NULL,
  src_eptp_act_date VARCHAR(100) NULL,
  src_eptp_act_remarks TEXT NULL,
  src_his_eptp_act_date TEXT NULL,
  src_his_eptp_act_remarks TEXT NULL,
  src_due_date VARCHAR(100) NULL,
  src_subs_start_date VARCHAR(20) NULL,
  src_subs_end_date VARCHAR(20) NULL,
  src_plan_id VARCHAR(20) NULL,
  src_cost_company_name VARCHAR(200) NULL,
  src_cost_branch VARCHAR(200) NULL,
  src_cost_opbranch VARCHAR(200) NULL,
  src_cost_stream VARCHAR(200) NULL,
  src_cost_process VARCHAR(200) NULL,
  src_cost_process_name VARCHAR(200) NULL,
  src_cost_tallyhead VARCHAR(200) NULL,
  src_cost_client VARCHAR(200) NULL,
  src_cost_bill_to VARCHAR(200) NULL,
  src_cost_as_client VARCHAR(200) NULL,
  src_cost_b_address1 VARCHAR(200) NULL,
  src_cost_b_address2 VARCHAR(200) NULL,
  src_cost_b_address3 VARCHAR(200) NULL,
  src_cost_b_address4 VARCHAR(200) NULL,
  src_cost_b_address5 VARCHAR(200) NULL,
  src_cost_ship_to VARCHAR(200) NULL,
  src_cost_as_bill_to VARCHAR(200) NULL,
  src_cost_a_address1 VARCHAR(200) NULL,
  src_cost_a_address2 VARCHAR(200) NULL,
  src_cost_a_address3 VARCHAR(200) NULL,
  src_cost_a_address4 VARCHAR(200) NULL,
  src_cost_a_address5 VARCHAR(200) NULL,
  src_cost_gsttype VARCHAR(50) NULL,
  src_cost_servicetaxno VARCHAR(50) NULL,
  src_cost_vendorgstno VARCHAR(50) NULL,
  src_cost_hsncode VARCHAR(50) NULL,
  src_cost_saccode VARCHAR(50) NULL,
  src_cost_vendorhsncode VARCHAR(100) NULL,
  src_cost_vendorsaccode VARCHAR(100) NULL,
  src_cost_vendorgststate VARCHAR(100) NULL,
  src_cost_vendorstatecode VARCHAR(100) NULL,
  src_cost_ownername VARCHAR(500) NULL,
  src_cost_statecodecost VARCHAR(100) NULL,
  src_cost_statenamecost VARCHAR(100) NULL,
  src_cost_client_tally_name VARCHAR(500) NULL,
  src_cost_group_cost_center VARCHAR(500) NULL,
  src_cost_cost_center_type VARCHAR(500) NULL,
  src_carry_forward INT(1) NULL,
  src_finance_monthyear VARCHAR(100) NULL,

  -- computed target columns (design §6)
  target_id          CHAR(36)     NULL,
  target_gst_type    VARCHAR(20)  NULL,
  target_apply_gst   TINYINT(1)   NULL,
  target_is_migrated TINYINT(1)   NOT NULL DEFAULT 1,

  -- validation (Task 3 fills these in)
  validation_error  VARCHAR(500) NULL,
  validation_status ENUM('pending','valid','error') NOT NULL DEFAULT 'pending',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_cims_src_id (src_id),
  KEY idx_cims_validation_status (validation_status)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── client_credit_note_migration_staging (new) ──────────────────────────────
CREATE TABLE IF NOT EXISTS client_credit_note_migration_staging (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,

  -- every db_bill.tbl_credit_note column verbatim, src_-prefixed (39 columns,
  -- read from db_bill's live information_schema.COLUMNS)
  src_id INT(11) NULL,
  src_category VARCHAR(100) NULL,
  src_branch_name VARCHAR(50) NULL,
  src_cost_center VARCHAR(50) NULL,
  src_finance_year VARCHAR(50) NULL,
  src_month VARCHAR(50) NULL,
  src_creditdate VARCHAR(50) NULL,
  src_app_tax_cal VARCHAR(50) NULL,
  src_creditdescription VARCHAR(200) NULL,
  src_credit_no VARCHAR(50) NULL,
  src_proforma_bill_no VARCHAR(50) NULL,
  src_credit_approve INT(11) NULL,
  src_credit_approved_by INT(11) NULL,
  src_credit_approved_date DATETIME NULL,
  src_total VARCHAR(200) NULL,
  src_tax VARCHAR(200) NULL,
  src_igst VARCHAR(50) NULL,
  src_sgst VARCHAR(50) NULL,
  src_cgst VARCHAR(50) NULL,
  src_grnd VARCHAR(200) NULL,
  src_username VARCHAR(100) NULL,
  src_status INT(11) NULL,
  src_createdate DATETIME NULL,
  src_sbctax VARCHAR(200) NULL,
  src_krishi_tax INT(11) NULL,
  src_apply_krishi_tax INT(11) NULL,
  src_apply_service_tax INT(11) NULL,
  src_apply_gst INT(11) NULL,
  src_receiptstatus INT(11) NULL,
  src_gsttype VARCHAR(50) NULL,
  src_bill_finance_year VARCHAR(20) NULL,
  src_billnochange INT(11) NULL,
  src_state_code VARCHAR(2) NULL,
  src_paymentstatus VARCHAR(1) NULL,
  src_subs_start_date VARCHAR(20) NULL,
  src_subs_end_date VARCHAR(20) NULL,
  src_plan_id VARCHAR(20) NULL,
  src_updated_at DATETIME NULL,
  src_updated_by INT(11) NULL,

  -- computed target columns (design §6, mirroring the invoice staging table)
  target_id          CHAR(36)     NULL,
  target_gst_type    VARCHAR(20)  NULL,
  target_apply_gst   TINYINT(1)   NULL,
  target_is_migrated TINYINT(1)   NOT NULL DEFAULT 1,

  -- validation (Task 3 fills these in)
  validation_error  VARCHAR(500) NULL,
  validation_status ENUM('pending','valid','error') NOT NULL DEFAULT 'pending',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_ccnms_src_id (src_id),
  KEY idx_ccnms_validation_status (validation_status)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;