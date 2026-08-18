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
-- ── PRODUCTION INCIDENT, fixed in this version ─────────────────────────────────────────────
-- Two real bugs shipped in the version of this migration first registered on 2026-08-18 and
-- attempted (and failed) twice against production before either was caught:
--
-- 1. `last_value` is a MySQL 8.0 RESERVED WORD (added for window functions, alongside RANK,
--    LEAD, LAG, GROUPS). The unquoted column name was a hard syntax error —
--    schema_migrations recorded `success=0` both times, "Production startup blocked because
--    migrations failed" fired on every boot attempt, and the table was never created. Fixed
--    by backticking the identifier everywhere it's referenced (this file and
--    client-billing-numbering.service.ts).
--
-- 2. client_invoice_number_sequence originally had its own `id BIGINT AUTO_INCREMENT PRIMARY
--    KEY` surrogate, with (kind, scope_key) as a separate UNIQUE KEY. That breaks the atomic-
--    counter idiom's first-mint case: `INSERT ... VALUES (?, ?, LAST_INSERT_ID(1), ...)` is
--    supposed to make `result.insertId` return 1 on a fresh row, but when the table ALSO has
--    its own genuine AUTO_INCREMENT column, MySQL returns that column's real generated id
--    (2, 3, 47, whatever the table's current auto-increment counter is) instead of the
--    LAST_INSERT_ID(expr) value — even though the wrapped value (1) IS correctly stored in
--    last_value itself. Proved live: a throwaway table with a surrogate id returned the row's
--    real id on first insert; the identical statement against a table with NO surrogate id
--    (composite PRIMARY KEY only) returned the wrapped value correctly, matching this
--    migration's own precedent (ai_rate_limit_bucket, PRIMARY KEY (user_id, window_start),
--    no surrogate id column at all). Fixed by dropping the surrogate id and making
--    (kind, scope_key) the table's actual PRIMARY KEY — do not reintroduce a separate
--    AUTO_INCREMENT id column here; nothing needs it, and its presence is exactly what breaks
--    the counter.
--
-- Neither bug was caught by two rounds of code review because review — like the module's own
-- test suite — checked the SQL's text and mocked db.execute's return value, never executed
-- the statement against a real MySQL server. Caught only when this migration's fix was
-- independently verified against a live database before being reported as fixed.
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
  kind         VARCHAR(20)  NOT NULL,           -- 'proforma' | 'bill'
  scope_key    VARCHAR(191) NOT NULL,            -- 'GLOBAL' for proforma; '<stateCode>|<companyName>|<financeYear>' for bill
  `last_value` INT          NOT NULL DEFAULT 0,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, scope_key)
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
