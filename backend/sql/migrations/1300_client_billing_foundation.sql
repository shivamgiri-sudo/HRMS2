-- 1300_client_billing_foundation.sql
--
-- Foundation schema for the client-billing replica (docs/superpowers/specs/2026-08-18-client-billing-replica-design.md).
-- Creates three new tables only. Does not touch cost_centre_master, branch_master, billing_invoice,
-- or any billing_*_snapshot table.
--
-- ── Why ─────────────────────────────────────────────────────────────────────────────────
-- Replaces the legacy db_bill/InitialInvoicesController.php proforma-invoice engine with a
-- modern equivalent that keeps the same business rules but fixes the confirmed numbering race
-- condition (legacy used `LOCK TABLES tbl_invoice READ`, which locks the wrong table in the
-- wrong mode and provides no real serialization). This migration lays down:
--   - client_invoice_number_sequence: one row per (kind, scope_key) atomic counter, minted via
--     MySQL's `INSERT ... ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1)`
--     idiom, which is safe under concurrent writers without any explicit locking.
--   - client_invoice / client_invoice_line: the live proforma invoice and its line items.
--
-- Approval-stage fields (bill_no, rejected_*) are included now even though this plan's
-- services only ever write proforma_no — adding them in a later migration would mean a second
-- ALTER TABLE on a table that may already have production rows by then.
--
-- ── Safety ──────────────────────────────────────────────────────────────────────────────
-- Pure CREATE TABLE — no ALTER of any existing table, no data migration. Server is MySQL 8,
-- so this is safe to run at any time; there is nothing to lock because the tables do not exist
-- yet. Rollback is three DROP TABLEs (line first, for the FK):
--   DROP TABLE client_invoice_line;
--   DROP TABLE client_invoice;
--   DROP TABLE client_invoice_number_sequence;
--
-- ── Deployment ──────────────────────────────────────────────────────────────
-- Verify against an isolated local/staging schema first (see plan Step 3). Registering this
-- file in sql/MIGRATION_MANIFEST.lock.json applies it at the next pm2 restart — do that only
-- with explicit user sign-off, per CLAUDE.md's migration-approval rule.

CREATE TABLE IF NOT EXISTS client_invoice_number_sequence (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  kind         VARCHAR(20)  NOT NULL,           -- 'proforma' | 'bill'
  scope_key    VARCHAR(191) NOT NULL,            -- 'GLOBAL' for proforma; '<stateCode>|<companyName>|<financeYear>' for bill
  last_value   INT          NOT NULL DEFAULT 0,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kind_scope (kind, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_invoice (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  cost_centre_id   CHAR(36)     NOT NULL,
  invoice_status   ENUM('proforma','approved','rejected') NOT NULL DEFAULT 'proforma',
  category         VARCHAR(50)  NOT NULL,
  finance_year     VARCHAR(10)  NOT NULL,
  month_label      VARCHAR(10)  NOT NULL,
  invoice_date     DATE         NOT NULL,
  description      VARCHAR(255) NULL,
  proforma_no      VARCHAR(40)  NULL,
  bill_no          VARCHAR(40)  NULL,
  gst_type         VARCHAR(20)  NOT NULL,       -- 'Integrated' | 'Intrastate'
  apply_gst        TINYINT(1)   NOT NULL DEFAULT 1,
  total_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  igst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  cgst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  sgst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  grand_total      DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by       CHAR(36)     NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  rejected_reason  TEXT         NULL,
  rejected_by      CHAR(36)     NULL,
  rejected_at      DATETIME     NULL,
  KEY idx_ci_cost_centre (cost_centre_id),
  KEY idx_ci_proforma_no (proforma_no),
  KEY idx_ci_bill_no (bill_no),
  CONSTRAINT fk_ci_cost_centre FOREIGN KEY (cost_centre_id)
    REFERENCES cost_centre_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_invoice_line (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id   CHAR(36)      NOT NULL,
  line_type    ENUM('charge','deduction') NOT NULL DEFAULT 'charge',
  particulars  VARCHAR(255)  NOT NULL,
  qty          DECIMAL(10,2) NOT NULL DEFAULT 1,
  rate         DECIMAL(14,2) NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cil_invoice (invoice_id),
  CONSTRAINT fk_cil_invoice FOREIGN KEY (invoice_id)
    REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
