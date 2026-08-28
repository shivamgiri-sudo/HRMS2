import { describe, expect, it } from "vitest";
import { resolveRevenueAtRisk } from "../canonical-pnl.service.js";

/**
 * "Revenue Gap MTD" on the CEO dashboard reads `pnl.kpis.revenueAtRisk`, which sums
 * `revenueAtRisk` across the P&L process rows. That value traces to
 * `process_revenue_daily.revenue_at_risk` (getRevenueDailyMap in process-pnl.service.ts).
 *
 * `process_revenue_daily` holds ZERO rows in production (verified 2026-08-28), and its
 * only writer is a manual POST /api/business-command/revenue-risk/generate-daily — no
 * scheduler calls it. sum() over an empty set is 0, so the tile rendered a confident
 * "₹0" revenue gap: an executive reading it concluded there was no revenue at risk, when
 * in fact nothing had ever been measured.
 *
 * This is the same judgement already recorded for the TAT Breached / Name Mismatch tiles
 * removed from this dashboard on 31-Jul-2026: a false zero on an executive dashboard is
 * worse than a blank one. A zero must only be shown when the source actually produced
 * rows saying zero.
 */
describe("resolveRevenueAtRisk", () => {
  it("returns null when the revenue-risk source produced no rows at all", () => {
    const result = resolveRevenueAtRisk(0, 0);

    expect(result.revenueAtRisk).toBeNull();
    expect(result.revenueAtRiskUnavailable).toContain("process_revenue_daily");
  });

  it("explains that the feed is generated on demand, not on a schedule", () => {
    const result = resolveRevenueAtRisk(0, 0);

    expect(result.revenueAtRiskUnavailable).toMatch(/not been generated/i);
  });

  it("reports a genuine zero when the source did produce rows", () => {
    const result = resolveRevenueAtRisk(0, 42);

    expect(result.revenueAtRisk).toBe(0);
    expect(result.revenueAtRiskUnavailable).toBeNull();
  });

  it("passes a real figure through untouched", () => {
    const result = resolveRevenueAtRisk(1_250_000, 42);

    expect(result.revenueAtRisk).toBe(1_250_000);
    expect(result.revenueAtRiskUnavailable).toBeNull();
  });

  it("treats a negative row count as no source, not as coverage", () => {
    expect(resolveRevenueAtRisk(0, -1).revenueAtRisk).toBeNull();
  });
});
