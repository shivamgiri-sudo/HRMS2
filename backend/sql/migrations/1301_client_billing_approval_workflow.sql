-- 1301_client_billing_approval_workflow.sql
--
-- Approval-workflow schema for the client-billing replica (docs/superpowers/specs/2026-08-19-client-billing-approval-workflow-design.md).
-- Five new tables: provision tracking, PO tracking, and an append-only audit log for the
-- proforma -> approved/rejected transition. Does not touch client_invoice, client_invoice_line,
-- client_invoice_number_sequence, cost_centre_master, or any db_bill/billing_invoice/
-- billing_*_snapshot table.
--
-- ── Why ─────────────────────────────────────────────────────────────────────────────────
-- client_provision / client_provision_deduction replace legacy's provision_master /
-- provision_master_month_deductions with atomic SQL balance mutations (`balance = balance -
-- ?` / `balance = balance + ?`), fixing two confirmed legacy bugs: an undefined-PHP-variable
-- corruption on invoice edit, and a reject-refund that overwrote the balance with just the
-- total instead of adding it back (PHP string-coercion bug: `'provision_balance' =>
-- 'provision_balance' + $total` is evaluated by PHP before ever reaching MySQL).
--
-- client_po_number / client_po_particular replace legacy's po_number / po_number_particulars,
-- same 4-PO-per-invoice cap as legacy (a real business rule, not a bug).
--
-- client_invoice_audit_log replaces legacy's four inconsistent reject mechanisms (soft-delete
-- via update_proforma, hard-delete via update_bill, soft-delete via reject_invoice, and a
-- fourth dead endpoint) with one auditable, append-only path: every create/edit/approve/reject
-- writes exactly one row here.
--
-- ── Safety ──────────────────────────────────────────────────────────────────────────────
-- Pure CREATE TABLE — no ALTER of any existing table, no data migration. Learned from the
-- foundation phase's production incident (a MySQL 8 reserved-word column name shipped
-- unquoted, and a surrogate AUTO_INCREMENT id silently broke an atomic-counter idiom): every
-- statement in this file was verified against a live MySQL 8 connection (PREPARE for DDL,
-- a throwaway-table INSERT/UPDATE cycle for the balance-mutation SQL used by Tasks 2-3)
-- before this file was committed — see those tasks' own verification steps.
--
-- Rollback is five DROP TABLEs (particulars/deductions/audit first, for the FKs):
--   DROP TABLE client_provision_deduction;
--   DROP TABLE client_po_particular;
--   DROP TABLE client_invoice_audit_log;
--   DROP TABLE client_provision;
--   DROP TABLE client_po_number;
--
-- ── Deployment ──────────────────────────────────────────────────────────────
-- Registering this file in runPendingMigrations.ts's MIGRATION_MANIFEST array (and
-- regenerating the lock file from it) applies it at the next pm2 restart — do that only with
-- explicit user sign-off, per CLAUDE.md's migration-approval rule.

CREATE TABLE IF NOT EXISTS client_provision (
  id                 CHAR(36)      NOT NULL PRIMARY KEY,
  cost_centre_id     CHAR(36)      NOT NULL,
  finance_year       VARCHAR(10)   NOT NULL,
  month_label        VARCHAR(10)   NOT NULL,
  provision_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  provision_balance  DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cp_cost_centre (cost_centre_id),
  KEY idx_cp_scope (cost_centre_id, finance_year, month_label),
  CONSTRAINT fk_cp_cost_centre FOREIGN KEY (cost_centre_id)
    REFERENCES cost_centre_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_provision_deduction (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  provision_id  CHAR(36)      NOT NULL,
  invoice_id    CHAR(36)      NOT NULL,
  amount_used   DECIMAL(14,2) NOT NULL,
  deducted_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cpd_provision (provision_id),
  KEY idx_cpd_invoice (invoice_id),
  CONSTRAINT fk_cpd_provision FOREIGN KEY (provision_id)
    REFERENCES client_provision(id),
  CONSTRAINT fk_cpd_invoice FOREIGN KEY (invoice_id)
    REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_po_number (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  cost_centre_id  CHAR(36)      NOT NULL,
  po_number       VARCHAR(60)   NOT NULL,
  period_from     DATE          NOT NULL,
  period_to       DATE          NOT NULL,
  total_amount    DECIMAL(14,2) NOT NULL,
  balance_amount  DECIMAL(14,2) NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cpn_cost_centre (cost_centre_id),
  KEY idx_cpn_po_number (po_number),
  CONSTRAINT fk_cpn_cost_centre FOREIGN KEY (cost_centre_id)
    REFERENCES cost_centre_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_po_particular (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  po_id            CHAR(36)      NOT NULL,
  invoice_id       CHAR(36)      NOT NULL,
  amount_consumed  DECIMAL(14,2) NOT NULL,
  consumed_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cpp_po (po_id),
  KEY idx_cpp_invoice (invoice_id),
  CONSTRAINT fk_cpp_po FOREIGN KEY (po_id)
    REFERENCES client_po_number(id),
  CONSTRAINT fk_cpp_invoice FOREIGN KEY (invoice_id)
    REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_invoice_audit_log (
  id          CHAR(36)   NOT NULL PRIMARY KEY,
  invoice_id  CHAR(36)   NOT NULL,
  action      ENUM('created','edited','approved','rejected') NOT NULL,
  actor_id    CHAR(36)   NOT NULL,
  reason      TEXT       NULL,
  created_at  DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cial_invoice (invoice_id),
  CONSTRAINT fk_cial_invoice FOREIGN KEY (invoice_id)
    REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
