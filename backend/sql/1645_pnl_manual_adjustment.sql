-- Migration 1645: Manual P&L Adjustments (Projected Revenue / Penalty / Reward)
-- Applied: 2026-09-01
--
-- A SEPARATE adjustment line, never blended into system-calculated actuals. The existing
-- Revenue/Profit figures on the P&L Statement and Process Detail sub-tab stay exactly as
-- computed by canonicalPnlService/bpoPnlAllocationOverlayService. This table holds manually
-- entered Projected Revenue, Penalty and Reward entries that, once APPROVED, feed a separate
-- "Adjusted Total" field shown alongside — never in place of — the system figure.
--
-- Deliberately a NEW, SEPARATE table from `cost_centre_reward_penalty` (reward-penalty.service.ts),
-- which already exists and is BLENDED directly into recognizedRevenue/EBITDA per approved cost
-- centre entry. That is a different, already-shipped feature; this one is process-scoped, never
-- blended, and exists purely as a visible adjustment layer. See pnl-manual-adjustment.service.ts.
--
-- Scope pattern matches process_pnl_cost_component (migration ~1070s): process_id primary scope,
-- branch_id carried for filtering. Collation matches every sibling finance table in this schema
-- (utf8mb4_unicode_ci) — this schema has a documented systemic collation-drift trap, so every
-- column below states its collation explicitly rather than relying on a server default.
--
-- Rollback: DROP TABLE IF EXISTS pnl_manual_adjustment;

CREATE TABLE IF NOT EXISTS pnl_manual_adjustment (
  id                 CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  process_id         CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  branch_id          CHAR(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  period_code        CHAR(7)       COLLATE utf8mb4_unicode_ci NOT NULL,
  adjustment_type    ENUM('projected_revenue','penalty','reward')
                                    COLLATE utf8mb4_unicode_ci NOT NULL,
  amount             DECIMAL(18,2) NOT NULL,
  reason             VARCHAR(500)  COLLATE utf8mb4_unicode_ci NOT NULL,
  status             ENUM('pending','approved','rejected')
                                    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  created_by         CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by        CHAR(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  approved_at        DATETIME      DEFAULT NULL,
  rejection_reason   VARCHAR(500)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pnl_manual_adjustment_period_process (period_code, process_id, status),
  KEY idx_pnl_manual_adjustment_branch (branch_id, period_code, status),
  KEY idx_pnl_manual_adjustment_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
