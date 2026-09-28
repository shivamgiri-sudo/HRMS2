-- 1836_journal_voucher.sql
--
-- Manual Journal Voucher: the accountant-authored entry (provision, reclassification,
-- depreciation, prepaid write-off, correction, opening balance) that the double-entry ledger
-- (1789 journal_entry / journal_entry_line) declared as source_type='manual' but had no screen
-- or API to create. Every other ledger source (GRN, payment voucher, payroll, bank
-- reconciliation) posts automatically from a business event; this is the one path a person
-- writes by hand, so it is maker-checker: the maker drafts and submits, a DIFFERENT approver
-- posts it. Nothing reaches journal_entry until approval — journal-voucher.service.ts approve()
-- calls journalService.post() (the ledger's only writer) inside the approval transaction.
--
-- journal_voucher            one row per voucher (header + workflow state)
-- journal_voucher_line       the DRAFT lines the maker keyed. Distinct from journal_entry_line:
--                            those are the immutable posted lines; these are editable until
--                            submit. On approval the same lines are copied into the ledger.
-- Workflow history reuses finance_approval_event (1089, entity_type='journal_voucher') and the
-- audit trail reuses finance_action_audit_log — no new history table.
--
-- No FK to employees/auth_user (actors are plain CHAR(36), same as payment_voucher); explicit
-- utf8mb4_unicode_ci because the schema default collation is not the bare-charset default on
-- MySQL 8 (see the 1028/1032 collation incidents).
--
-- Additive only: two new tables + page registration. No existing table is altered.

CREATE TABLE IF NOT EXISTS journal_voucher (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  voucher_number        VARCHAR(64)   NULL COMMENT 'JV/<branch_code|HQ>/<YYYYMM of voucher_date>/<seq>, assigned at first submit so drafts never burn a number.',
  voucher_date          DATE          NOT NULL COMMENT 'Accounting date the entry is posted under (journal_entry.entry_date). Not in the future.',
  jv_type               ENUM('reclassification','provision','accrual_reversal','prepaid_amortisation','depreciation','correction','opening_balance','other')
                                      NOT NULL DEFAULT 'other',
  narration             TEXT          NOT NULL,
  reference_no          VARCHAR(100)  NULL COMMENT 'External document the entry is based on (invoice no, audit note, bank advice).',
  branch_id             CHAR(36)      NULL,
  cost_centre_id        CHAR(36)      NULL,
  process_id            CHAR(36)      NULL,
  total_amount          DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'Sum of debit lines at last save.',
  line_count            SMALLINT      NOT NULL DEFAULT 0,
  status                ENUM('draft','pending_approval','posted','rejected','withdrawn','reversed') NOT NULL DEFAULT 'draft',
  created_by            CHAR(36)      NOT NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  submitted_by          CHAR(36)      NULL,
  submitted_at          DATETIME      NULL,
  approved_by           CHAR(36)      NULL,
  approved_at           DATETIME      NULL,
  approval_note         TEXT          NULL,
  rejected_by           CHAR(36)      NULL,
  rejected_at           DATETIME      NULL,
  rejection_reason      TEXT          NULL,
  withdrawn_by          CHAR(36)      NULL,
  withdrawn_at          DATETIME      NULL,
  withdrawal_reason     TEXT          NULL,
  journal_entry_id      CHAR(36)      NULL COMMENT 'The journal_entry this voucher posted, set at approval.',
  reversal_entry_id     CHAR(36)      NULL COMMENT 'The contra journal_entry, set when a posted voucher is reversed.',
  reversed_by           CHAR(36)      NULL,
  reversed_at           DATETIME      NULL,
  reversal_reason       TEXT          NULL,
  UNIQUE KEY uq_jv_voucher_number (voucher_number),
  INDEX idx_jv_status_date (status, voucher_date),
  INDEX idx_jv_date (voucher_date),
  INDEX idx_jv_created_by (created_by, status),
  INDEX idx_jv_branch (branch_id),
  INDEX idx_jv_cost_centre (cost_centre_id),
  INDEX idx_jv_process (process_id),
  INDEX idx_jv_type (jv_type),
  INDEX idx_jv_journal_entry (journal_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journal_voucher_line (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  journal_voucher_id  CHAR(36)      NOT NULL,
  line_order          SMALLINT      NOT NULL DEFAULT 0,
  account_type        ENUM('expense_sub_head','payable_account') NOT NULL COMMENT 'Manual entries never touch bank_account or vendor: those carry their own sub-ledgers (bank reconciliation, vendor dues) that only Payment Vouchers / GRNs may move.',
  account_id          CHAR(36)      NOT NULL,
  debit_amount        DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit_amount       DECIMAL(18,2) NOT NULL DEFAULT 0,
  narration           VARCHAR(500)  NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_jvl_one_side CHECK (
    (debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)
  ),
  INDEX idx_jvl_voucher (journal_voucher_id, line_order),
  INDEX idx_jvl_account (account_type, account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Page registration. Roles mirror journal-voucher.routes.ts exactly: read = finance_head,
-- accounts_head, finance, ceo, admin, super_admin; can_create/can_edit = the maker roles;
-- can_delete unused (a draft delete is a maker action gated by can_create).
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_JOURNAL_VOUCHERS', 'Journal Vouchers', '/finance/journal-vouchers', 'finance',
   'Manual double-entry journal vouchers (provision, reclassification, depreciation, correction) — maker drafts, a different approver posts to the general ledger.', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name), page_path = VALUES(page_path), module = VALUES(module),
  description = VALUES(description), active_status = VALUES(active_status);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'FINANCE_JOURNAL_VOUCHERS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head',  'FINANCE_JOURNAL_VOUCHERS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'accounts_head', 'FINANCE_JOURNAL_VOUCHERS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance',       'FINANCE_JOURNAL_VOUCHERS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'ceo',           'FINANCE_JOURNAL_VOUCHERS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',         'FINANCE_JOURNAL_VOUCHERS', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view), can_create = VALUES(can_create), can_edit = VALUES(can_edit),
  can_export = VALUES(can_export), active_status = VALUES(active_status);

SELECT '1836_journal_voucher.sql applied' AS migration_status;

-- Rollback (only if no voucher has been posted; a posted voucher's journal_entry stays):
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_JOURNAL_VOUCHERS';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_JOURNAL_VOUCHERS';
--   DROP TABLE journal_voucher_line; DROP TABLE journal_voucher;
