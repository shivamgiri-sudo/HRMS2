-- 1960_tally_voucher_export.sql
--
-- Tally Prime voucher XML export (Invoicing / Receivables / Tally plan, wave 2 task E-part1).
--
-- WHY
-- ---
-- The existing GST/Tally export (1520) hands Finance a CSV. Tally Prime itself imports vouchers as
-- XML, and re-importing the same voucher must UPDATE it, not create a duplicate. That needs three
-- things the CSV path never had:
--   1. Ledger names that are configurable (party/sales/tax/round-off ledgers differ per company in
--      Tally and are not derivable from invoice data).
--   2. A per-voucher stable GUID and an "already exported" memory, so a second export emits
--      ACTION="Alter" with the SAME GUID instead of a second Create.
--   3. A batch record with its exception worklist, like gst_export_batch.
--
-- TABLES (all NEW; nothing existing is altered, so the db_bill sync worker that writes
-- client_invoice is unaffected)
--   tally_export_config       scope ('*' default, or one company GSTIN) + key -> ledger / voucher type name
--   tally_voucher_batch       one row per generation run
--   tally_voucher_batch_line  one row per voucher in a batch (frozen model JSON + exception list)
--   tally_voucher_export      one row per source document that has EVER been exported: stable GUID,
--                             first/last export time, count, last content hash
--
-- Natural keys everywhere; no surrogate AUTO_INCREMENT. Voucher kinds are 'sales', 'credit_note'
-- and (added by a later task, once the receipts tables exist) 'receipt' - source_type is a plain
-- VARCHAR rather than an ENUM so that later task needs no ALTER.
--
-- SAFE TO APPLY: CREATE TABLE IF NOT EXISTS + INSERT IGNORE seeds. Re-running changes nothing.
-- Rollback: DROP TABLE tally_voucher_batch_line, tally_voucher_batch, tally_voucher_export,
--           tally_export_config;

CREATE TABLE IF NOT EXISTS tally_export_config (
  config_scope  VARCHAR(15)  NOT NULL DEFAULT '*',      -- '*' = default for every company, else a company GSTIN
  config_key    VARCHAR(40)  NOT NULL,
  config_value  VARCHAR(255) NOT NULL,
  updated_by    CHAR(36)     NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (config_scope, config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO tally_export_config (config_scope, config_key, config_value) VALUES
  ('*', 'sales_ledger',             'Sales'),
  ('*', 'credit_note_sales_ledger', 'Sales Returns'),
  ('*', 'igst_ledger',              'Output IGST'),
  ('*', 'cgst_ledger',              'Output CGST'),
  ('*', 'sgst_ledger',              'Output SGST'),
  ('*', 'round_off_ledger',         'Round Off'),
  ('*', 'tds_receivable_ledger',    'TDS Receivable'),
  ('*', 'sales_voucher_type',       'Sales'),
  ('*', 'credit_note_voucher_type', 'Credit Note'),
  ('*', 'receipt_voucher_type',     'Receipt');

CREATE TABLE IF NOT EXISTS tally_voucher_batch (
  id                CHAR(36)      NOT NULL PRIMARY KEY,
  company_gstin     VARCHAR(15)   NOT NULL,
  period_month      CHAR(7)       NOT NULL,                 -- YYYY-MM
  voucher_kinds     VARCHAR(80)   NOT NULL,                 -- comma list: sales,credit_note
  company_name      VARCHAR(255)  NULL,                     -- Tally company the XML targets (SVCURRENTCOMPANY)
  status            ENUM('draft','validated','exported','superseded') NOT NULL DEFAULT 'draft',
  total_vouchers    INT           NOT NULL DEFAULT 0,
  clean_vouchers    INT           NOT NULL DEFAULT 0,
  exception_vouchers INT          NOT NULL DEFAULT 0,
  total_debit       DECIMAL(16,2) NOT NULL DEFAULT 0,
  total_credit      DECIMAL(16,2) NOT NULL DEFAULT 0,
  generated_by      CHAR(36)      NULL,
  generated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  downloaded_by     CHAR(36)      NULL,
  downloaded_at     DATETIME      NULL,
  superseded_by_id  CHAR(36)      NULL,
  notes             VARCHAR(500)  NULL,
  KEY idx_tvb_period (company_gstin, period_month, status),
  KEY idx_tvb_generated (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tally_voucher_batch_line (
  batch_id           CHAR(36)      NOT NULL,
  source_type        VARCHAR(20)   NOT NULL,                -- invoice | credit_note | receipt
  source_id          CHAR(36)      NOT NULL,
  sequence_no        INT           NOT NULL,
  voucher_kind       VARCHAR(20)   NOT NULL,
  voucher_number     VARCHAR(60)   NULL,
  voucher_date       DATE          NULL,
  party_ledger       VARCHAR(255)  NULL,
  amount             DECIMAL(16,2) NOT NULL DEFAULT 0,
  guid               CHAR(36)      NOT NULL,
  content_hash       CHAR(64)      NOT NULL,
  validation_status  ENUM('valid','exception') NOT NULL DEFAULT 'valid',
  validation_errors  JSON          NULL,
  model_json         LONGTEXT      NOT NULL,                -- frozen voucher model; XML is rendered from it
  PRIMARY KEY (batch_id, source_type, source_id),
  KEY idx_tvbl_source (source_type, source_id),
  CONSTRAINT fk_tvbl_batch FOREIGN KEY (batch_id) REFERENCES tally_voucher_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tally_voucher_export (
  source_type        VARCHAR(20)  NOT NULL,
  source_id          CHAR(36)     NOT NULL,
  guid               CHAR(36)     NOT NULL,                 -- stable for the life of the document
  voucher_number     VARCHAR(60)  NULL,
  content_hash       CHAR(64)     NOT NULL,                 -- hash of the content last handed to Tally
  first_exported_at  DATETIME     NOT NULL,
  last_exported_at   DATETIME     NOT NULL,
  export_count       INT          NOT NULL DEFAULT 1,
  last_batch_id      CHAR(36)     NULL,
  PRIMARY KEY (source_type, source_id),
  UNIQUE KEY uq_tve_guid (guid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
