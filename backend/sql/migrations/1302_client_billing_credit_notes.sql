-- 1302_client_billing_credit_notes.sql
--
-- Credit-note schema for the client-billing replica (docs/superpowers/specs/2026-08-19-client-billing-credit-notes-design.md).
-- Two new tables. Does not touch client_invoice, client_invoice_line, client_invoice_number_sequence,
-- cost_centre_master, or any db_bill/billing_invoice/billing_*_snapshot table.
--
-- ── Why ─────────────────────────────────────────────────────────────────────────────────
-- Legacy's tbl_credit_note.credit_no is a DD-MM/FY-FY date stamp, not a sequence — confirmed
-- live to collide: db_bill ids 163 and 164, both created 2026-08-18, both carry
-- credit_no='18-08/26-27'. client_credit_note.credit_no is minted via the numbering service's
-- atomic counter (same fix already applied twice this session for invoice numbering), format
-- CN-<stateCode>-<NN>/<FYshort>, scoped per (stateCode, companyName, financeYear).
--
-- invoice_id is a real FK to client_invoice, replacing legacy's proforma_bill_no column, which
-- despite its name actually stores the referenced invoice's real bill number (confirmed live:
-- values like "09-155/26-27", "09-213/26-27" — bill-number shaped, not proforma-number shaped).
--
-- ── Safety ──────────────────────────────────────────────────────────────────────────────
-- Pure CREATE TABLE. Table-level COLLATE=utf8mb4_unicode_ci throughout (the foundation phase's
-- collation incident), no surrogate AUTO_INCREMENT id on either table (neither needs upsert
-- semantics — the numbering-service incident), IF NOT EXISTS on both (the reserved-word/
-- idempotency incident). Every statement in this file was verified against a live MySQL 8
-- connection before this file was committed — see this task's own verification step.
--
-- Rollback: DROP TABLE client_credit_note_line; DROP TABLE client_credit_note;
--
-- ── Deployment ──────────────────────────────────────────────────────────────────────────
-- Registering this file in runPendingMigrations.ts's MIGRATION_MANIFEST array (and
-- regenerating the lock file) applies it at the next pm2 restart — do that only with explicit
-- user sign-off, per CLAUDE.md's migration-approval rule.

CREATE TABLE IF NOT EXISTS client_credit_note (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id       CHAR(36)      NOT NULL,
  cost_centre_id   CHAR(36)      NOT NULL,
  category         VARCHAR(50)   NOT NULL,
  finance_year     VARCHAR(10)   NOT NULL,
  month_label      VARCHAR(10)   NOT NULL,
  credit_date      DATE          NOT NULL,
  description      VARCHAR(255)  NULL,
  credit_no        VARCHAR(40)   NULL,
  credit_status    ENUM('draft','approved') NOT NULL DEFAULT 'draft',
  gst_type         VARCHAR(20)   NOT NULL,
  apply_gst        TINYINT(1)    NOT NULL DEFAULT 1,
  total_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  igst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  cgst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  sgst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  grand_total      DECIMAL(14,2) NOT NULL DEFAULT 0,
  approved_by      CHAR(36)      NULL,
  approved_at      DATETIME      NULL,
  created_by       CHAR(36)      NOT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ccn_invoice (invoice_id),
  KEY idx_ccn_cost_centre (cost_centre_id),
  KEY idx_ccn_credit_no (credit_no),
  CONSTRAINT fk_ccn_invoice FOREIGN KEY (invoice_id) REFERENCES client_invoice(id),
  CONSTRAINT fk_ccn_cost_centre FOREIGN KEY (cost_centre_id) REFERENCES cost_centre_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_credit_note_line (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  credit_note_id  CHAR(36)      NOT NULL,
  particulars     VARCHAR(255)  NOT NULL,
  qty             DECIMAL(10,2) NOT NULL DEFAULT 1,
  rate            DECIMAL(14,2) NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  KEY idx_ccnl_credit_note (credit_note_id),
  CONSTRAINT fk_ccnl_credit_note FOREIGN KEY (credit_note_id) REFERENCES client_credit_note(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
