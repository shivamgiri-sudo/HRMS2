import { describe, expect, it } from "vitest";
import { getStatement } from "../pnl-statement.service.js";

/**
 * OWNER RULE 2026-10-06: a budget line still OPEN is blocked at its full amount, so its unspent
 * headroom is cost on top of consumed + reserved; closing the line releases it. The Statement must
 * carry the same reserve Live P&L, CEO Overview and the Branch Review subtract.
 * (Copy of the fixture in pnl-statement-grn-committed.test.ts.)
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

describe("P&L Statement — open budget headroom is cost until the line is closed", () => {
  for (const viewBy of ["process", "branch"] as const) {
    const column = viewBy === "process" ? PROC : BRANCH_ID;

    it(`${viewBy} view: consumed 100 + reserved 40 + unspent 60 = Indirect 200; OP = Revenue − Total Cost`, async () => {
      const statement = await getStatement({ period: closedMonthOutsideWindow() } as never, viewBy,
        deps({ getOpenBudgetReserve: async () => actuals(60) }));
      expect(value(statement, "total_idc", column)).toBe(200);
      expect(value(statement, "grn_consumed", column)).toBe(100);
      expect(value(statement, "grn_committed", column)).toBe(40);
      expect(value(statement, "grn_open_budget", column)).toBe(60);
      expect(value(statement, "total_cost", column)).toBe(700);
      expect(value(statement, "operating_profit", column)).toBe(1000 - 700);
    });

    it(`${viewBy} view: a closed budget line adds nothing (cost falls back to actual)`, async () => {
      const statement = await getStatement({ period: closedMonthOutsideWindow() } as never, viewBy,
        deps({ getOpenBudgetReserve: async () => empty() }));
      expect(value(statement, "total_idc", column)).toBe(140);
      expect(value(statement, "grn_open_budget", column)).toBe(0);
      expect(value(statement, "operating_profit", column)).toBe(1000 - 640);
    });
  }

  it("the production default dependencies carry the open-budget and reconciled-branch-revenue readers (an injected getIndirectCost / getInvoicedRevenue would otherwise read as a test double)", async () => {
    const { defaultDependencies } = await import("../pnl-statement.service.js");
    expect(typeof defaultDependencies.getOpenBudgetReserve).toBe("function");
    expect(typeof defaultDependencies.getBranchRevenue).toBe("function");
  });

  it("a caller that injects only the consumed reader gets no open-budget reserve (never the live reader)", async () => {
    const statement = await getStatement({ period: closedMonthOutsideWindow() } as never, "process", deps());
    expect(value(statement, "grn_open_budget", PROC)).toBe(0);
    expect(value(statement, "total_idc", PROC)).toBe(140);
  });
});

describe("P&L Statement — payroll not attendance-prorated is flagged on the branch column", () => {
  it("attaches payrollNotProrated to the branch column and leaves the figures unchanged", async () => {
    const statement = await getStatement({ period: closedMonthOutsideWindow() } as never, "branch",
      deps({ getUnproratedPayroll: async () => new Map([[BRANCH_ID, { staff: 1009, amount: 20446751 }]]) }));
    const column = statement.columns.find((c) => c.id === BRANCH_ID) as unknown as { payrollNotProrated?: { staff: number; amount: number } };
    expect(column.payrollNotProrated).toEqual({ staff: 1009, amount: 20446751 });
    expect(value(statement, "operating_profit", BRANCH_ID)).toBe(1000 - 640);
  });

  it("no flag when the run is prorated, and none in the process view", async () => {
    const withMap = deps({ getUnproratedPayroll: async () => new Map([[BRANCH_ID, { staff: 1, amount: 1 }]]) });
    const branch = await getStatement({ period: closedMonthOutsideWindow() } as never, "branch", deps());
    expect((branch.columns[0] as unknown as { payrollNotProrated?: unknown }).payrollNotProrated).toBeUndefined();
    const process = await getStatement({ period: closedMonthOutsideWindow() } as never, "process", withMap);
    expect((process.columns[0] as unknown as { payrollNotProrated?: unknown }).payrollNotProrated).toBeUndefined();
  });

  it("is listed in the production default dependencies", async () => {
    const { defaultDependencies } = await import("../pnl-statement.service.js");
    expect(typeof defaultDependencies.getUnproratedPayroll).toBe("function");
  });
});

describe("P&L Statement — statement-level payroll warning is scoped to the branches shown", () => {
  it("process view carries the total for the shown branch and never another branch's staff", async () => {
    const statement = await getStatement({ period: closedMonthOutsideWindow() } as never, "process",
      deps({ getUnproratedPayroll: async () => new Map([[BRANCH_ID, { staff: 10, amount: 500 }], ["other-branch", { staff: 999, amount: 99999 }]]) }));
    expect((statement as unknown as { payrollNotProrated?: unknown }).payrollNotProrated).toEqual({ staff: 10, amount: 500 });
  });

  it("branch view carries it too, and nothing when no shown branch is flagged", async () => {
    const flagged = await getStatement({ period: closedMonthOutsideWindow() } as never, "branch",
      deps({ getUnproratedPayroll: async () => new Map([[BRANCH_ID, { staff: 3, amount: 30 }]]) }));
    expect((flagged as unknown as { payrollNotProrated?: unknown }).payrollNotProrated).toEqual({ staff: 3, amount: 30 });
    const none = await getStatement({ period: closedMonthOutsideWindow() } as never, "branch",
      deps({ getUnproratedPayroll: async () => new Map([["other-branch", { staff: 5, amount: 5 }]]) }));
    expect((none as unknown as { payrollNotProrated?: unknown }).payrollNotProrated).toBeUndefined();
  });
});
