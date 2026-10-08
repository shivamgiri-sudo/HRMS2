import { describe, expect, it } from "vitest";
import { getStatement } from "../pnl-statement.service.js";

/**
 * OWNER RULE 2026-09-24: "Reserved + Consumed should be there in P&L".
 *
 * The P&L Statement's Indirect Cost = GRN Consumed + GRN Committed (reserved), both ex-GST, for
 * EVERY month — including a closed month well outside the seat-rate estimate window. Each part is
 * shown as its own breakdown line under Total Indirect Cost, and Total Cost / Operating Profit /
 * margins include the reserved part, so Operating Profit = Revenue − Total Cost with reserved inside.
 *
 * Fixture: one process, consumed GRN 100, reserved GRN 40, revenue 1000, agent salary 500, in a
 * month six months back (never inside the estimate window).
 */

const BRANCH_ID = "branch-grn";
const PROC = "proc-grn";

function closedMonthOutsideWindow(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 6);
  return d.toISOString().slice(0, 7);
}

const actuals = (amount: number) => ({
  byBranch: new Map([[BRANCH_ID, amount]]),
  byProcess: new Map([[PROC, amount]]),
  byCostCentre: new Map([["cc-1", amount]]),
});
const empty = () => ({ byBranch: new Map(), byProcess: new Map(), byCostCentre: new Map() });

function component(key: string, field: string, order: number, subtotal = 0) {
  return {
    component_key: key, display_name: key, section_key: key.startsWith("operating") ? "profitability" : "cost",
    parent_component_key: null, display_order: order, component_type: subtotal ? "SUBTOTAL" : "SOURCE_ACTUAL",
    source_field: field, format_type: field.endsWith("Pct") ? "PERCENTAGE" : "CURRENCY", sign_convention: "+",
    is_subtotal: subtotal, active_status: 1,
  };
}

const COMPONENTS = [
  component("recognized_revenue", "recognizedRevenue", 100),
  component("agent_salary", "agentSalary", 200),
  component("dc_total", "directCostTotal", 240, 1),
  component("total_idc", "indirectCostTotal", 250, 1),
  component("idc_pct", "indirectCostPct", 255),
  component("total_cost", "totalCost", 260, 1),
  component("operating_profit", "operatingProfit", 270, 1),
  component("operating_profit_pct", "operatingProfitPct", 275),
];

function deps(overrides: Record<string, unknown> = {}) {
  return {
    getComponents: async () => COMPONENTS,
    getSummary: async () => ({
      rows: [{
        processId: PROC, processName: "Proc", branchId: BRANCH_ID, branchName: "Branch",
        processStatus: "active", recognizedRevenue: 1000, agentSalary: 500,
        dscSalary: 0, bmcSalary: 0, dscPeople: 0, bmcPeople: 0, dscNonPeople: 0, bmcNonPeople: 0,
      }],
      generatedAt: new Date().toISOString(),
    }),
    getProcessSummary: async () => ({ rows: [] }),
    getIndirectCost: async () => actuals(100),
    getCommittedIndirectCost: async () => actuals(40),
    getDriverRevenue: async () => empty(),
    getInvoicedRevenue: async () => actuals(1000),
    getSeatRevenue: async () => ({ ...empty(), rateMissingByKey: empty() }),
    getPeopleCost: async () => ({
      byBranch: new Map(), byProcess: new Map(), coverageByBranch: new Map(), coverageByProcess: new Map(), asOfDate: null,
    }),
    getManualAdjustments: async () => new Map(),
    getRevenueEstimate: async () => empty(),
    ...overrides,
  } as never;
}

const value = (statement: Awaited<ReturnType<typeof getStatement>>, key: string, column: string) =>
  statement.rows.find((r) => r.componentKey === key)?.values[column];

describe("P&L Statement — GRN Committed (reserved) inside Indirect Cost, every month", () => {
  for (const viewBy of ["process", "branch"] as const) {
    const column = viewBy === "process" ? PROC : BRANCH_ID;

    it(`${viewBy} view: Total Indirect Cost = consumed 100 + reserved 40 = 140 for a closed month outside the window`, async () => {
      const statement = await getStatement({ period: closedMonthOutsideWindow() } as never, viewBy, deps());
      expect(value(statement, "total_idc", column)).toBe(140);
      expect(value(statement, "grn_consumed", column)).toBe(100);
      expect(value(statement, "grn_committed", column)).toBe(40);
      expect(value(statement, "total_cost", column)).toBe(640);
      // Operating Profit = Revenue − Total Cost, reserved inside Total Cost.
      expect(value(statement, "operating_profit", column)).toBe(1000 - 640);
      expect(value(statement, "operating_profit_pct", column)).toBeCloseTo(36, 5);
      expect(value(statement, "idc_pct", column)).toBeCloseTo(14, 5);
    });
  }

  it("shows GRN Consumed and GRN Committed (reserved) as breakdown lines directly under Total Indirect Cost", async () => {
    const statement = await getStatement({ period: closedMonthOutsideWindow() } as never, "process", deps());
    const keys = statement.rows.map((r) => r.componentKey);
    const idc = keys.indexOf("total_idc");
    expect(keys.slice(idc, idc + 3)).toEqual(["total_idc", "grn_consumed", "grn_committed"]);
    const consumed = statement.rows[idc + 1];
    const committed = statement.rows[idc + 2];
    expect(consumed.displayName).toBe("GRN Consumed");
    expect(committed.displayName).toBe("GRN Committed (reserved)");
    // Children of Total Indirect Cost: an "of which" line, never extra cost.
    expect(consumed.parentComponentKey).toBe("total_idc");
    expect(committed.parentComponentKey).toBe("total_idc");
    expect(committed.isSubtotal).toBe(false);
  });

  it("does not insert the breakdown twice once the component master carries these keys", async () => {
    const statement = await getStatement({ period: closedMonthOutsideWindow() } as never, "process", deps({
      getComponents: async () => [
        ...COMPONENTS,
        { ...component("grn_committed", "grnCommitted", 252), parent_component_key: "total_idc" },
      ],
    }));
    expect(statement.rows.filter((r) => r.componentKey === "grn_committed")).toHaveLength(1);
    expect(statement.rows.filter((r) => r.componentKey === "grn_consumed")).toHaveLength(1);
  });

  it("a caller that injects only the consumed reader gets no reserved (never the live reader)", async () => {
    const statement = await getStatement({ period: closedMonthOutsideWindow() } as never, "process", deps({
      getCommittedIndirectCost: undefined,
    }));
    expect(value(statement, "total_idc", PROC)).toBe(100);
    expect(value(statement, "grn_committed", PROC)).toBe(0);
  });
});
