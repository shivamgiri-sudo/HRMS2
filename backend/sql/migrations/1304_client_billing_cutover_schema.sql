-- 1304_client_billing_cutover_schema.sql
--
-- Client Billing Historical Cutover — Task 1: schema only.
-- (docs/superpowers/plans/2026-08-19-client-billing-cutover.md,
--  docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md §3, §6)
--
-- Adds is_migrated/legacy_id to client_invoice and client_credit_note (design §3),
-- and creates the throwaway client_invoice_migration_staging table (design §6) that
-- a later task in this plan populates from db_bill.tbl_invoice.
--
-- ── What this migration does NOT do ────────────────────────────────────────
-- Writes zero historical business data. It adds two nullable/defaulted columns to
-- two existing (currently 0-row, per this session's own prior verification) tables,
-- plus one new, empty, throwaway staging table. The actual historical load (writing
-- ~11,469 rows into client_invoice/client_credit_note) is explicitly out of scope
-- for this migration and forbidden elsewhere in this plan without a separate,
-- explicit human sign-off (design §9).
--
-- ── Why is_migrated/legacy_id, not a partial unique index ──────────────────
-- MySQL 8 has no partial/filtered index. legacy_id is a plain nullable column with
-- a plain UNIQUE index; every newly-created (non-migrated) row inserts
-- legacy_id=NULL. MySQL treats NULL as distinct per occurrence in a UNIQUE index
-- (ordinary ANSI SQL NULL-distinctness, not a MySQL-specific quirk) — independently
-- proven live against this session's own mas_hrms connection before this file was
-- written (throwaway table x_nullable_unique_test_<timestamp>, two rows with the
-- unique column NULL, both inserts succeeded, table dropped after) — see this
-- task's own report for the real command/output. This makes the later load step
-- idempotent (INSERT ... ON DUPLICATE KEY UPDATE keyed on legacy_id) without ever
-- blocking an ordinary new-invoice insert, which never populates legacy_id at all.
--
-- ── Why the information_schema-guarded PREPARE/EXECUTE idiom ───────────────
-- MySQL 8 does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` as a single
-- clause the way this session first assumed — that spelling has separately been
-- observed in this codebase's history to fail while the migration still gets
-- recorded as applied (the exact trap this repo's own migration-safety notes warn
-- about). Following the precedent already fixed here: same guarded idiom as
-- 431_benefit_claim_payment_columns.sql, 1241_minimum_wage_gate_columns.sql and
-- 1242_employee_loans_approval_gate.sql — information_schema.COLUMNS /
-- information_schema.STATISTICS checked first, the real ALTER built as a string
-- only when the column/index does not already exist, then
-- PREPARE/EXECUTE/DEALLOCATE. Naturally idempotent; safe to re-run.
--
-- ── Staging table shape (design §6) ─────────────────────────────────────────
-- client_invoice_migration_staging holds every db_bill.tbl_invoice column verbatim,
-- `src_`-prefixed (all 106 columns below, read directly off db_bill's live
-- information_schema.COLUMNS — never hand-transcribed or guessed, see this task's
-- own report), plus the computed target columns design §6 specifies (target_id,
-- target_gst_type, target_apply_gst, target_is_migrated) and the
-- validation_error/validation_status pair a later task fills in. Every src_ column
-- is deliberately NULLable regardless of the legacy source's own nullability (e.g.
-- db_bill.tbl_invoice.bill_no is NOT NULL) — this is a raw inspection copy for
-- validation, not an enforcement layer, and a malformed/partial extracted row must
-- still be able to land here for review rather than abort the whole extraction.
-- A later task in this plan decides how tbl_credit_note's shape is represented
-- (extending this table with a `kind` discriminator, or a second staging table) —
-- explicitly not this migration's concern.
--
-- ── Safety ──────────────────────────────────────────────────────────────────
-- ALTER TABLE adds two nullable/defaulted columns to client_invoice/
-- client_credit_note — both tables hold 0 rows as of this commit (this session's
-- own prior verification), so there is no default-backfill cost regardless of row
-- count. CREATE TABLE IF NOT EXISTS for the staging table — pure additive DDL, no
-- data migration, no FK to any table outside this plan's own scope (deliberately —
-- a staging table has no referential integrity need and must never block on or be
-- blocked by client_invoice). Every statement in this file was PREPARE-verified
-- (compiled, not executed) against the real mas_hrms connection before being
-- committed — see this task's own report.
--
-- Rollback:
--   DROP TABLE client_invoice_migration_staging;
--   ALTER TABLE client_credit_note DROP INDEX uq_ccn_legacy_id, DROP COLUMN legacy_id, DROP COLUMN is_migrated;
--   ALTER TABLE client_invoice DROP INDEX uq_ci_legacy_id, DROP COLUMN legacy_id, DROP COLUMN is_migrated;
--
-- ── Deployment ──────────────────────────────────────────────────────────────
-- Registering this file in runPendingMigrations.ts's MIGRATION_MANIFEST array (and
-- regenerating the lock file) applies it at the next pm2 restart — do that only
-- with explicit user sign-off, per CLAUDE.md's migration-approval rule. As of this
-- commit it is registered but has NOT been applied to production (though note: in
-- this shared multi-session environment, a registered-but-unapplied migration has
-- been observed to get auto-applied by some OTHER concurrent session's dev server
-- restart within minutes — a known, already-documented quirk of this environment,
-- not something this task caused or can prevent).

-- ── client_invoice: is_migrated / legacy_id ─────────────────────────────────
SET @add_ci_is_migrated = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN is_migrated TINYINT(1) NOT NULL DEFAULT 0 AFTER rejected_at',
    'SELECT 1 -- client_invoice.is_migrated already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'is_migrated'
);
PREPARE _stmt FROM @add_ci_is_migrated;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_ci_legacy_id = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN legacy_id INT NULL AFTER is_migrated',
    'SELECT 1 -- client_invoice.legacy_id already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'legacy_id'
);
PREPARE _stmt FROM @add_ci_legacy_id;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_ci_legacy_id_uq = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD UNIQUE INDEX uq_ci_legacy_id (legacy_id)',
    'SELECT 1 -- uq_ci_legacy_id already exists'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND INDEX_NAME = 'uq_ci_legacy_id'
);
PREPARE _stmt FROM @add_ci_legacy_id_uq;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ── client_credit_note: is_migrated / legacy_id ─────────────────────────────
SET @add_ccn_is_migrated = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_credit_note ADD COLUMN is_migrated TINYINT(1) NOT NULL DEFAULT 0 AFTER created_at',
    'SELECT 1 -- client_credit_note.is_migrated already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note' AND COLUMN_NAME = 'is_migrated'
);
PREPARE _stmt FROM @add_ccn_is_migrated;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_ccn_legacy_id = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_credit_note ADD COLUMN legacy_id INT NULL AFTER is_migrated',
    'SELECT 1 -- client_credit_note.legacy_id already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note' AND COLUMN_NAME = 'legacy_id'
);
PREPARE _stmt FROM @add_ccn_legacy_id;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_ccn_legacy_id_uq = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_credit_note ADD UNIQUE INDEX uq_ccn_legacy_id (legacy_id)',
    'SELECT 1 -- uq_ccn_legacy_id already exists'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note' AND INDEX_NAME = 'uq_ccn_legacy_id'
);
PREPARE _stmt FROM @add_ccn_legacy_id_uq;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ── client_invoice_migration_staging ────────────────────────────────────────
-- Throwaway working table for the cutover — no financially-authoritative data,
-- intended to be dropped once cutover is confirmed stable (design §6).
CREATE TABLE IF NOT EXISTS client_invoice_migration_staging (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,

  -- ── every db_bill.tbl_invoice column verbatim, src_-prefixed (106 columns,
  --    read from db_bill's live information_schema.COLUMNS, not hand-transcribed)
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
  src_filepath VARCHAR(1000) NULL,
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
  src_eptp_act_remarks VARCHAR(1000) NULL,
  src_his_eptp_act_date VARCHAR(1000) NULL,
  src_his_eptp_act_remarks VARCHAR(1000) NULL,
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

  -- ── computed target columns (design §6) ───────────────────────────────────
  target_id          CHAR(36)     NULL,
  target_gst_type    VARCHAR(20)  NULL,
  target_apply_gst   TINYINT(1)   NULL,
  target_is_migrated TINYINT(1)   NOT NULL DEFAULT 1,

  -- ── validation (a later task in this plan fills these in) ─────────────────
  validation_error  VARCHAR(500) NULL,
  validation_status ENUM('pending','valid','error') NOT NULL DEFAULT 'pending',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_cims_src_id (src_id),
  KEY idx_cims_validation_status (validation_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;