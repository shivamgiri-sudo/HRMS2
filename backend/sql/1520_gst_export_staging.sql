-- 1520_gst_export_staging.sql
--
-- WHY
-- ---
-- GST returns and the Tally hand-off are prepared by hand today. The only thing resembling an
-- export anywhere in the estate is db_bill.tbl_tally_row_invoice_data: 34 columns, every one
-- varchar(100), whose FIRST ROW is literally the spreadsheet header (" Bill No ", " Company GST
-- No ", ...) because it was populated by an Excel import. 35 rows total, a single
-- `downloadstatus` char(1) flag, no period scoping, no validation, no audit of who generated
-- what. It cannot be the basis of a filed return.
--
-- This replaces it with a two-table staging model in HRMS:
--
--   gst_export_batch  — one row per generation run, scoped to (export type, OUR GSTIN, period).
--                       Carries the control totals a preparer signs off against, and the
--                       download/supersede audit trail.
--   gst_export_row    — one materialised row per source document in that batch.
--
-- WHY MATERIALISE INSTEAD OF QUERYING LIVE
-- A filed return must be reproducible. Once GSTR-1 for a period is filed, re-deriving it from
-- live tables would silently drift as invoices are edited, cost centres are renamed or GSTINs
-- are corrected. Rows are frozen at generation time, so what was filed can always be shown
-- again byte-for-byte. Regeneration creates a NEW batch and marks the old one 'superseded'
-- rather than mutating it.
--
-- WHY TYPED COLUMNS, NOT varchar(100)
-- The legacy table stored amounts as strings, which is how "8800\r0" reached production in the
-- client-billing cutover. Money is DECIMAL(16,2) here; dates are DATE; flags are real ENUMs.
--
-- WHY validation_status / validation_errors PER ROW
-- The point of this table is that Finance stops reconciling by hand. A row that cannot legally
-- be filed (no recipient GSTIN on a B2B supply, GSTIN failing its checksum, state code
-- disagreeing with the CGST/SGST-vs-IGST split) is still WRITTEN, flagged 'exception', with a
-- machine-readable reason. The preparer gets a worklist, not a silently short return. A batch
-- with exception_rows > 0 must never be treated as filing-ready.
--
-- SAFE TO APPLY: purely additive. Two NEW tables, no existing table, column, row or query is
-- touched. CREATE TABLE IF NOT EXISTS, so re-running changes nothing.
--
-- COLLATION IS DECLARED EXPLICITLY on every char(36) that references an existing table.
-- client_invoice.id, client_credit_note.id, branch_master.id and auth_user.id are all
-- char(36) utf8mb4_unicode_ci (verified live before writing this). A new table created under a
-- different server/database default collation cannot form a foreign key to them, and the error
-- MySQL gives ("Referencing column and referenced column are incompatible") does not mention
-- collation at all.

CREATE TABLE IF NOT EXISTS gst_export_batch (
  id                  CHAR(36)      NOT NULL COLLATE utf8mb4_unicode_ci,
  export_type         ENUM('GSTR1','GSTR3B_OUTWARD','TALLY_SALES') NOT NULL,
  -- OUR GSTIN. A return is filed per registration, never per company: two branches in
  -- different states file separate returns even though they are one legal entity.
  company_gstin       VARCHAR(15)   NOT NULL COLLATE utf8mb4_unicode_ci,
  gst_state_code      VARCHAR(2)    NOT NULL COLLATE utf8mb4_unicode_ci,
  period_month        VARCHAR(7)    NOT NULL COLLATE utf8mb4_unicode_ci
                        COMMENT 'YYYY-MM. VARCHAR not DATE: a GST period is a month, not a day, and comparing a DATE literal against a month string matches zero rows via a warning.',
  financial_year      VARCHAR(10)   NOT NULL COLLATE utf8mb4_unicode_ci,
  status              ENUM('draft','validated','exported','superseded') NOT NULL DEFAULT 'draft',
  total_rows          INT           NOT NULL DEFAULT 0,
  valid_rows          INT           NOT NULL DEFAULT 0,
  exception_rows      INT           NOT NULL DEFAULT 0,
  total_taxable_value DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  total_igst          DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  total_cgst          DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  total_sgst          DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  total_cess          DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  total_invoice_value DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  generated_by        CHAR(36)      NULL COLLATE utf8mb4_unicode_ci,
  generated_at        DATETIME      NULL,
  downloaded_by       CHAR(36)      NULL COLLATE utf8mb4_unicode_ci,
  downloaded_at       DATETIME      NULL,
  superseded_by_id    CHAR(36)      NULL COLLATE utf8mb4_unicode_ci
                        COMMENT 'The batch that replaced this one. Set when a period is regenerated.',
  notes               TEXT          NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gst_batch_period (export_type, company_gstin, period_month, status),
  KEY idx_gst_batch_status (status, period_month),
  CONSTRAINT fk_gst_batch_generated_by FOREIGN KEY (generated_by) REFERENCES auth_user (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gst_export_row (
  id                  CHAR(36)      NOT NULL COLLATE utf8mb4_unicode_ci,
  batch_id            CHAR(36)      NOT NULL COLLATE utf8mb4_unicode_ci,
  sequence_no         INT           NOT NULL,

  -- Provenance. source_id is deliberately NOT a foreign key: a filed batch must survive the
  -- deletion of its source document, and pointing at two different parent tables rules out a
  -- single FK anyway.
  source_type         ENUM('invoice','credit_note') NOT NULL,
  source_id           CHAR(36)      NOT NULL COLLATE utf8mb4_unicode_ci,

  -- Document identity (GSTR-1 Table 13 / document series)
  bill_no             VARCHAR(40)   NULL COLLATE utf8mb4_unicode_ci,
  invoice_date        DATE          NULL,
  financial_year      VARCHAR(10)   NULL COLLATE utf8mb4_unicode_ci,
  month_label         VARCHAR(10)   NULL COLLATE utf8mb4_unicode_ci,

  -- Supplier = us
  company_name        VARCHAR(255)  NULL COLLATE utf8mb4_unicode_ci,
  company_gstin       VARCHAR(15)   NULL COLLATE utf8mb4_unicode_ci,
  branch_name         VARCHAR(255)  NULL COLLATE utf8mb4_unicode_ci,
  branch_state_code   VARCHAR(2)    NULL COLLATE utf8mb4_unicode_ci,

  -- Recipient = the client
  client_name         VARCHAR(255)  NULL COLLATE utf8mb4_unicode_ci,
  client_gstin        VARCHAR(15)   NULL COLLATE utf8mb4_unicode_ci,
  client_state_code   VARCHAR(2)    NULL COLLATE utf8mb4_unicode_ci,
  place_of_supply     VARCHAR(64)   NULL COLLATE utf8mb4_unicode_ci,

  -- Commercial references carried over from the legacy Tally sheet
  process_code        VARCHAR(64)   NULL COLLATE utf8mb4_unicode_ci,
  po_no               VARCHAR(64)   NULL COLLATE utf8mb4_unicode_ci,
  grn_no              VARCHAR(64)   NULL COLLATE utf8mb4_unicode_ci,
  hsn_sac_code        VARCHAR(10)   NULL COLLATE utf8mb4_unicode_ci,

  -- Tax
  supply_type         ENUM('B2B','B2CL','B2CS','EXPORT','EXEMPT','NIL_RATED','NON_GST') NULL,
  gst_type            VARCHAR(20)   NULL COLLATE utf8mb4_unicode_ci,
  gst_rate            DECIMAL(5,2)  NULL,
  reverse_charge      TINYINT(1)    NOT NULL DEFAULT 0,
  taxable_value       DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  igst_amount         DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  cgst_amount         DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  sgst_amount         DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  cess_amount         DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  other_charges       DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  round_off_amount    DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  invoice_value       DECIMAL(16,2) NOT NULL DEFAULT 0.00,

  -- Receipt / deduction tracking, mirroring the legacy sheet's right-hand columns
  tds_amount          DECIMAL(16,2) NULL,
  other_deduction     DECIMAL(16,2) NULL,
  payment_received    DECIMAL(16,2) NULL,
  received_on         DATE          NULL,
  cheque_no           VARCHAR(64)   NULL COLLATE utf8mb4_unicode_ci,

  -- Accounting hand-off
  tally_head          VARCHAR(255)  NULL COLLATE utf8mb4_unicode_ci,
  tally_bill_no       VARCHAR(64)   NULL COLLATE utf8mb4_unicode_ci,

  -- Filing readiness
  validation_status   ENUM('valid','exception') NOT NULL DEFAULT 'valid',
  validation_errors   JSON          NULL
                        COMMENT 'Array of {code,severity,message}. Populated only when validation_status = exception.',
  remarks             VARCHAR(255)  NULL COLLATE utf8mb4_unicode_ci,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_gst_row_batch (batch_id, sequence_no),
  KEY idx_gst_row_status (batch_id, validation_status),
  KEY idx_gst_row_source (source_type, source_id),
  CONSTRAINT fk_gst_row_batch FOREIGN KEY (batch_id) REFERENCES gst_export_batch (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
