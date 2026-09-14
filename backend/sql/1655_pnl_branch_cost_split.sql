-- Migration 1655: Branch Cost Split (Additional Cost Allocation)
-- Applied: NOT YET EXECUTED — awaiting owner approval
--
-- Lets Finance Head / Payroll Head enter an ad-hoc cost that is NOT tied to a GRN and NOT tied to
-- a single employee, and split it ACROSS BRANCHES. This is the one gap left after a full survey of
-- what already exists:
--   * within-branch split across that branch's own processes  -> pnl_allocation_policy
--                                                                (bpo-pnl-allocation-overlay.service.ts)
--   * one employee's salary split across cost centres (incl.
--     across branches, e.g. a Head Office resource)           -> employee_cost_centre_allocation
--                                                                (migration 1065, billability.service.ts)
--   * per-GRN document split across cost centres              -> grn_cost_allocation (migration 416)
-- None of those can express "here is a lump cost for the month, spread it over the branches."
--
-- The arithmetic is NOT reimplemented here. branch-cost-split.service.ts calls the same shared
-- primitive every other allocation path already uses — allocatePoolAmount() in
-- bpo-pnl.calculation.ts — so weighted/equal splits stay paisa-exact via its largest-remainder
-- method, and manual-percentage mode keeps its deliberate no-renormalisation behaviour (an 80%
-- policy allocates 80%, and reports itself unbalanced, rather than being silently scaled to 100%).
--
-- Header + line, NOT a reuse of pnl_manual_adjustment (migration 1645). That table is
-- process-scoped with a fixed projected_revenue/penalty/reward type set and one row per entry;
-- this one is period-scoped and fans a single entry out to N branch rows. The maker-checker SHAPE
-- is copied from it deliberately (pending -> approved/rejected, creator cannot review their own —
-- see branch-cost-split.service.ts::reviewBranchCostSplit, which mirrors
-- pnl-manual-adjustment.service.ts::reviewManualAdjustment line for line).
--
-- Per-branch shares are computed and FROZEN into pnl_branch_cost_split_line at CREATE time, and
-- are NOT re-derived at approval or on any later read. The checker therefore approves exactly the
-- numbers they were shown, and an approved split cannot silently drift when next month's headcount
-- or revenue moves underneath it. (Contrast employee_cost_centre_allocation, which stores a
-- PERCENTAGE and re-derives the rupee amount live — a deliberate difference, not an oversight:
-- that one tracks a standing arrangement, this one records a one-off decision about a fixed sum.)
--
-- Collation stated explicitly on every string column — this schema has a documented systemic
-- collation-drift trap, so nothing here relies on a server default.
--
-- Purely additive: two CREATE TABLE IF NOT EXISTS, no ALTER of any existing table, no DROP, and no
-- FOREIGN KEY (repo convention — FK churn on this schema has been a recurring deploy blocker).
--
-- Rollback: DROP TABLE IF EXISTS pnl_branch_cost_split_line; DROP TABLE IF EXISTS pnl_branch_cost_split;

CREATE TABLE IF NOT EXISTS pnl_branch_cost_split (
  id                 CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  period_code        CHAR(7)       COLLATE utf8mb4_unicode_ci NOT NULL,
  title              VARCHAR(200)  COLLATE utf8mb4_unicode_ci NOT NULL,
  total_amount       DECIMAL(18,2) NOT NULL,
  allocation_driver  ENUM('active_hc','billable_hc','revenue','equal','manual')
                                    COLLATE utf8mb4_unicode_ci NOT NULL,
  reason             VARCHAR(500)  COLLATE utf8mb4_unicode_ci NOT NULL,
  status             ENUM('pending','approved','rejected')
                                    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  -- allocatePoolAmount()'s own `balanced` / `percentTotal` outputs, frozen at creation. Only
  -- meaningful for allocation_driver='manual'; weighted/equal modes always reconcile exactly and
  -- report balanced=1, percent_total=NULL.
  balanced           TINYINT(1)    NOT NULL DEFAULT 1,
  percent_total      DECIMAL(7,4)  DEFAULT NULL,
  created_by         CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by        CHAR(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  approved_at        DATETIME      DEFAULT NULL,
  rejection_reason   VARCHAR(500)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pnl_branch_cost_split_period_status (period_code, status),
  KEY idx_pnl_branch_cost_split_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_branch_cost_split_line (
  id                 CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  split_id           CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  branch_id          CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  -- The raw driver weight this branch was allocated on (summed activeHc / billableHc /
  -- recognizedRevenue across the branch's processes for the period). 0 for equal and manual modes,
  -- where the weight does not come from live data. Stored so a reader can see WHY a branch got the
  -- share it got, months later, without re-deriving a figure that has since changed.
  driver_value       DECIMAL(18,4) NOT NULL DEFAULT 0,
  manual_pct         DECIMAL(7,4)  DEFAULT NULL,
  allocated_amount   DECIMAL(18,2) NOT NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pnl_branch_cost_split_line_split (split_id),
  KEY idx_pnl_branch_cost_split_line_branch (branch_id, split_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
