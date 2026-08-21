-- 1534_budget_subhead_business_case_closure.sql
--
-- WHY
-- ---
-- Owner requirement, 2026-08-21 ("business case close/reopen"): every month's budget has to be
-- closed, head/sub-head by head/sub-head, by the 7th of the following month. Branch Admin and
-- Finance Head may close directly (no approval needed to close). If an invoice arrives later for
-- a closed month, Branch Admin can request the specific (branch, month, head, sub-head) be
-- reopened; Finance Head must approve the reopen before any further GRN can be raised against it.
--
-- This is a DIFFERENT, finer-grained concept than finance-period-lock.ts's isPeriodLocked(), which
-- locks an entire period company-wide for P&L close (no branch/head/sub-head granularity), and a
-- DIFFERENT concept than finance_budget_subhead_status (the Coverage tab's "did we plan to spend
-- here" marker, set once at budgeting time, advisory-only, never a spend gate). Closure is a
-- post-spend, monthly, re-toggleable, approval-gated state — deliberately a new table rather than
-- overloading either of those two.
--
-- WHAT CHANGES
-- ------------
-- 1. finance_budget_subhead_closure — one row per (budget_id, head, sub_head), i.e. per
--    (branch, month, head, sub_head) since finance_budget_header is already one row per
--    branch+period. sub_head is NOT NULL DEFAULT '' rather than nullable, because MySQL treats
--    every NULL as distinct in a UNIQUE index — two rows for the same head with a NULL sub_head
--    would both be allowed, which is exactly the ambiguity this table exists to prevent. '' for
--    "no sub-head" matches the COALESCE(l.sub_head,'') convention budget-coverage.service.ts
--    already uses when joining budget lines by name.
-- 2. finance_budget_closure_reopen_request — one row per reopen request against a closure row.
--    Single-stage (Finance Head approves/rejects), unlike the 2-stage top-up chain, because only
--    REOPEN needs approval here — closing itself does not.
--
-- Both purely additive new tables. No existing table touched.

CREATE TABLE IF NOT EXISTS finance_budget_subhead_closure (
  id CHAR(36) PRIMARY KEY,
  budget_id CHAR(36) NOT NULL,
  head VARCHAR(255) NOT NULL,
  sub_head VARCHAR(255) NOT NULL DEFAULT '',
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  closed_by CHAR(36) NULL,
  closed_at DATETIME NULL,
  closed_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_budget_subhead_closure_header
    FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  UNIQUE KEY uq_closure_budget_head (budget_id, head, sub_head),
  INDEX idx_closure_budget_status (budget_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_budget_closure_reopen_request (
  id CHAR(36) PRIMARY KEY,
  closure_id CHAR(36) NOT NULL,
  budget_id CHAR(36) NOT NULL,
  head VARCHAR(255) NOT NULL,
  sub_head VARCHAR(255) NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by CHAR(36) NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  review_notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_budget_reopen_closure
    FOREIGN KEY (closure_id) REFERENCES finance_budget_subhead_closure(id) ON DELETE CASCADE,
  CONSTRAINT fk_budget_reopen_header
    FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  INDEX idx_reopen_closure_status (closure_id, status),
  INDEX idx_reopen_budget_status (budget_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1534_budget_subhead_business_case_closure.sql applied' AS migration_status;
