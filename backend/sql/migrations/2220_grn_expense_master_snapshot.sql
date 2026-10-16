-- Migration 2220: grn_expense_master_snapshot
-- Registered 2026-10-16. Additive: new table grn_expense_master_snapshot holds a
-- full sync of db_bill.expense_master rows for the five mapped branches (IDs 3,9,18,19,24).
-- Parallel to grn_entry_snapshot (which mirrors expense_entry_master).
-- Filled by scripts/sync-grn-expense-master.mjs. Revert: DROP TABLE.

CREATE TABLE IF NOT EXISTS grn_expense_master_snapshot (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  bill_source_id   INT           NOT NULL,
  branch_source_id CHAR(36)      NOT NULL,
  branch_name      VARCHAR(100)  NOT NULL,
  finance_year     VARCHAR(10)   NOT NULL,
  finance_month    VARCHAR(10)   NOT NULL,
  period_code      VARCHAR(7)    NULL COMMENT 'YYYY-MM derived from FinanceYear+FinanceMonth',
  head_id          VARCHAR(20)   NULL,
  sub_head_id      VARCHAR(20)   NULL,
  amount           DECIMAL(12,2) NOT NULL DEFAULT 0,
  expense_status   VARCHAR(20)   NULL,
  entry_status     TINYINT       NULL,
  methodology      TEXT          NULL COMMENT 'Free-text business-case / validation narrative from db_bill',
  is_rejected      TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '1 = excluded from P&L (HeadId=19 or rejected status)',
  synced_at        DATETIME      NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bill_source (bill_source_id),
  KEY idx_period   (period_code),
  KEY idx_branch   (branch_name),
  KEY idx_head     (head_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
