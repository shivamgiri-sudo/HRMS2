-- Mirror the LINE level of db_bill's budget and GRN.
--
-- WHY THIS EXISTS SEPARATELY FROM 1069
-- ------------------------------------
-- 1069 mirrored expense_master (budget) and expense_entry_master (GRN). Both are HEADERS.
-- Each has a larger companion table holding the lines, and the lines carry the one thing the
-- headers do not: the COST CENTRE.
--
--   expense_master        18,433 header   ->  expense_particular        121,635 lines
--   expense_entry_master  85,463 header   ->  expense_entry_particular  127,489 lines
--
-- Without these, cost can only be reported per branch. With them it can be reported per cost
-- centre, which is what a per-process P&L needs. For FY2026-27 every one of the 1,563 GRN
-- lines carries a CostCenterId, none is blank, and all 1,563 resolve to db_bill.cost_master.
--
-- THE DOUBLE-COUNT TRAP ON BUDGET LINES
-- -------------------------------------
-- expense_particular holds each budget amount TWICE, under two different ExpenseType values:
--
--   ExpenseType='CostCenter'  491 lines  Rs 375.75 lakh   which cost centre the money is for
--   ExpenseType='Particular'  489 lines  Rs 374.54 lakh   the same money, itemised manually
--   summing both              980 lines  Rs 750.29 lakh   <-- WRONG, it is double
--
-- The budget header total for the same period is Rs 375.14 lakh, i.e. ONE of the halves.
-- Anything aggregating this table must filter on expense_type or it reports twice the budget.
-- The column is mirrored verbatim so the filter is possible; nothing here pre-aggregates.
--
-- GRN lines have no equivalent trap: their total for FY2026-27 is Rs 308.33 lakh, matching
-- the GRN header total to the rupee.
--
-- SAFE TO APPLY
-- -------------
-- Additive: two new tables, nothing existing touched.

-- ---------------------------------------------------------------------------
-- 1. Budget lines  <- db_bill.expense_particular
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_budget_line_snapshot (
  bill_source_id    INT           NOT NULL,        -- expense_particular.Id
  budget_source_id  INT           NULL,            -- -> finance_budget_snapshot.bill_source_id
  branch_source_id  INT           NULL,
  finance_year      VARCHAR(20)   NULL,
  finance_month     VARCHAR(20)   NULL,
  period_code       CHAR(7)       NULL,
  head_id           VARCHAR(50)   NULL,            -- exact source string, never cast to INT
  sub_head_id       VARCHAR(50)   NULL,
  -- 'CostCenter' or 'Particular'. MUST be filtered on when aggregating: the two together
  -- are the same money counted twice. See the note above.
  expense_type      VARCHAR(50)   NULL,
  -- For ExpenseType='CostCenter' this holds the cost centre CODE, which is how a budget line
  -- is attributed below branch. For 'Particular' it is a manual label such as 'mannual'.
  expense_type_name VARCHAR(255)  NULL,
  amount            DECIMAL(18,2) NOT NULL DEFAULT 0,
  amount_percent    VARCHAR(20)   NULL,
  source_created_at DATETIME      NULL,
  synced_at         DATETIME      NOT NULL,
  PRIMARY KEY (bill_source_id),
  KEY idx_fbls_budget (budget_source_id),
  KEY idx_fbls_period (period_code, expense_type),
  KEY idx_fbls_cc     (expense_type_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. GRN lines  <- db_bill.expense_entry_particular   ** carries the cost centre **
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grn_entry_line_snapshot (
  bill_source_id        INT           NOT NULL,    -- expense_entry_particular.Id
  grn_source_id         INT           NULL,        -- ExpenseEntry -> grn_entry_snapshot.bill_source_id
  branch_source_id      INT           NULL,
  cost_centre_source_id INT           NULL,        -- CostCenterId -> db_bill.cost_master.id
  cost_centre_code      VARCHAR(100)  NULL,        -- resolved on the way in, for joining
  entry_type            VARCHAR(50)   NULL,        -- Vendor / Imprest / ...
  particular            TEXT          NULL,
  amount                DECIMAL(18,2) NOT NULL DEFAULT 0,   -- net
  tax_rate              DECIMAL(10,4) NOT NULL DEFAULT 0,   -- source calls this Rate; it is a %
  tax                   DECIMAL(18,2) NOT NULL DEFAULT 0,
  total                 DECIMAL(18,2) NOT NULL DEFAULT 0,   -- amount + tax
  source_created_at     DATETIME      NULL,
  synced_at             DATETIME      NOT NULL,
  PRIMARY KEY (bill_source_id),
  KEY idx_gels_grn    (grn_source_id),
  KEY idx_gels_cc     (cost_centre_source_id),
  KEY idx_gels_cccode (cost_centre_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
