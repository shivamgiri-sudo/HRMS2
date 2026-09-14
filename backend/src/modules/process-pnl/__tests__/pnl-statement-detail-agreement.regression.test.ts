import { describe, expect, it } from "vitest";
import { getStatement } from "../pnl-statement.service.js";

/**
 * Regression test for the P&L Statement / Process Detail sign-flip bug (fixed 2026-09-01).
 *
 * Two UI surfaces both called "P&L Statement" disagreed in SIGN for the same process/period:
 *   - PnlStatementView.tsx (this file's getStatement()) showed MNP REJECTION at +Rs 79,85,596.94
 *     for 2026-07, branch febd8777-6583-11f1-adb1-00155d0ab410.
 *   - ProcessPnlDetailPage.tsx's sub-tab (bpoPnlAllocationOverlayService.getProcessDetail(), which
 *     reads the row's own `ebit`) showed the SAME process/period at -Rs 8,91,003.06.
 *
 * Root causes, both reproduced here against a single mocked canonical row so the test fails
 * without the fix and passes with it:
 *
 *   A2 — enrichColumn() overwrote the canonical row's `ebit` with a LOCAL
 *        `recognizedRevenue - totalCost` recompute for Operating Profit, using cost/revenue
 *        sources (running-salary snapshot, actuals maps) that can differ from what the canonical
 *        engine used to compute that same row's own ebit.
 *   A3 — enrichColumn()'s `pick()` fell back to `source.byBranch.get(branchId)` — the WHOLE
 *        branch's invoiced/planned revenue — whenever a process had no per-process entry in the
 *        revenue actuals maps, silently broadcasting 100% of branch revenue onto an unconfigured
 *        process. Confirmed live: MNP REJECTION, Finnable and Captureatrip — three different
 *        processes on branch febd8777-6583-11f1-adb1-00155d0ab410 — all showed the identical
 *        Rs 1,17,81,253 branch-wide invoiced figure for 2026-07.
 *
 * This test models exactly that shape: a process with NO per-process revenue (accounting_fallback,
 * matching REVENUE_RULE_MISSING) sitting on a branch whose invoiced actuals ARE large — the
 * scenario that used to broadcast the branch total and invert the sign.
 */

const PROCESS_ID = "proc-mnp";
const BRANCH_ID = "branch-1";
// A canonical row's own ebit — negative, matching the real MNP REJECTION detail figure's sign.
const CANONICAL_EBIT = -891_003.06;
// The whole branch's invoiced revenue — large and positive, must NOT leak onto this process.
const BRANCH_WIDE_INVOICED_REVENUE = 11_781_253;

/** A period unambiguously closed right now, whenever "now" is — same technique as
 *  pnl-revenue-basis.test.ts, so this test does not silently change meaning once a month closes. */
function closedPeriod(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 2);
  return d.toISOString().slice(0, 7);
}

const emptyActuals = () => ({
  byBranch: new Map<string, number>(),
  byProcess: new Map<string, number>(),
  byCostCentre: new Map<string, number>(),
});

/** Actuals map shaped exactly like the live bug: nothing at process grain, a real figure at
 *  branch grain only. */
const branchOnlyActuals = (branchAmount: number) => ({
  byBranch: new Map([[BRANCH_ID, branchAmount]]),
  byProcess: new Map<string, number>(),
  byCostCentre: new Map<string, number>(),
});

function component(key: string, field: string, order: number) {
  return {
    component_key: key, display_name: key, section_key: "profitability",
    parent_component_key: null, display_order: order, component_type: "SOURCE_ACTUAL",
    source_field: field, format_type: "CURRENCY", sign_convention: "+",
    is_subtotal: 0, active_status: 1,
  };
}

async function buildStatement() {
  const period = closedPeriod();
  return getStatement({ period, branchId: BRANCH_ID } as never, "process", {
    getComponents: async () => [
      component("recognized_revenue", "recognizedRevenue", 1),
      component("operating_profit", "operatingProfit", 2),
    ],
    getSummary: async () => ({
      rows: [{
        processId: PROCESS_ID, processName: "MNP REJECTION", branchId: BRANCH_ID, branchName: "B1",
        processStatus: "at-risk",
        // Canonical revenue: genuinely zero — no rule, no invoice attributable to THIS process.
        recognizedRevenue: 0,
        revenueDataStatus: "accounting_fallback",
        // Canonical cost/profit — the sub-tab's own numbers.
        agentSalary: 300_000, dscSalary: 0, bmcSalary: 0,
        dscPeople: 0, bmcPeople: 0, dscNonPeople: 0, bmcNonPeople: 0,
        ebit: CANONICAL_EBIT,
        activeHc: 5,
      }],
      generatedAt: new Date().toISOString(),
    }),
    getIndirectCost: async () => emptyActuals(),
    // The live bug: nothing at process grain, the whole branch's total at branch grain.
    getDriverRevenue: async () => emptyActuals(),
    getInvoicedRevenue: async () => branchOnlyActuals(BRANCH_WIDE_INVOICED_REVENUE),
    getSeatRevenue: async () => ({ ...emptyActuals(), billableEmployees: 0, rateMissingEmployees: 0, unresolvedEmployees: 0, notSeatBilledEmployees: 0, rateMissingByKey: emptyActuals() }),
    getPeopleCost: async () => ({ byBranch: new Map(), byProcess: new Map(), coverageByBranch: new Map(), coverageByProcess: new Map(), asOfDate: null }) as never,
    getProcessSummary: async () => ({ rows: [] }),
  } as never);
}

describe("P&L Statement / Process Detail agreement (regression, 2026-09-01 sign-flip fix)", () => {
  it("does not broadcast the whole branch's invoiced revenue onto a process with no revenue rule (A3)", async () => {
    const statement = await buildStatement();
    const revenue = statement.rows.find((r) => r.componentKey === "recognized_revenue")?.values[PROCESS_ID];
    expect(
      revenue,
      "a process with no per-process revenue rule/invoice must show its OWN revenue (0), never the whole branch's total",
    ).toBe(0);
    expect(revenue).not.toBe(BRANCH_WIDE_INVOICED_REVENUE);
  });

  it("reads Operating Profit from the canonical ebit instead of a local recompute that can flip sign (A2)", async () => {
    const statement = await buildStatement();
    const operatingProfit = statement.rows.find((r) => r.componentKey === "operating_profit")?.values[PROCESS_ID];
    expect(
      operatingProfit,
      "Operating Profit must equal the canonical row's own ebit for a process column",
    ).toBe(CANONICAL_EBIT);
    expect(Number(operatingProfit)).toBeLessThan(0);
  });

  it("agrees in sign with what the process detail sub-tab reports for the same process/period", async () => {
    // bpoPnlAllocationOverlayService.getProcessDetail's row.operatingProfit IS row.ebit
    // (bpo-pnl-allocation-overlay.service.ts's adjustedRow: `operatingProfit: ebit`). This asserts
    // the statement's Operating Profit row matches that sign — the two surfaces must never disagree.
    const detailOperatingProfit = CANONICAL_EBIT; // what ProcessPnlDetailPage's sub-tab shows
    const statement = await buildStatement();
    const statementOperatingProfit = Number(
      statement.rows.find((r) => r.componentKey === "operating_profit")?.values[PROCESS_ID]
    );
    expect(Math.sign(statementOperatingProfit)).toBe(Math.sign(detailOperatingProfit));
  });
});
