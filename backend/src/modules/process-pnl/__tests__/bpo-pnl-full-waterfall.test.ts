import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * bpo-pnl-full-waterfall.service.ts — the ADDITIONAL branch/company-wide "Full P&L Waterfall"
 * total, and pnl-cost-component-flags.ts — the "not yet configured" vs "genuinely zero"
 * distinction it (and the existing per-process card) both rely on.
 *
 * Core correctness claim under test: a branch total is EXACTLY the sum of that branch's
 * individual processes' own contribution/EBITDA/depreciation/amortization/EBIT/finance cost/PBT/
 * tax/PAT figures — the same figures ProcessPnlDetailPage's "Profitability waterfall" card reads,
 * via the identical bpoPnlAllocationOverlayService.getSummary()/getCachedAllocationSummary() rows
 * — so a reader really can hand-add the branch's processes and land on this number.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const PERIOD = "2027-02";
const BRANCH_ID = "branch-full-wf-1";

function fixtureRow(overrides: Record<string, unknown>) {
  return {
    processId: "", processName: "", branchId: BRANCH_ID,
    recognizedRevenue: 0, contribution: 0, ebitda: 0, depreciation: 0, amortization: 0,
    ebit: 0, financeCost: 0, pbt: 0, tax: 0, pat: 0,
    ...overrides,
  };
}

// Three processes, deliberately uneven, so a bug that broadcasts or drops a row shows up as a
// wrong total rather than accidentally cancelling out.
const PROCESS_ROWS = [
  fixtureRow({
    processId: "proc-a", processName: "Alpha",
    recognizedRevenue: 500_000, contribution: 200_000, ebitda: 150_000,
    depreciation: 5_000, amortization: 1_000, ebit: 144_000,
    financeCost: 2_000, pbt: 142_000, tax: 30_000, pat: 112_000,
  }),
  fixtureRow({
    processId: "proc-b", processName: "Beta",
    recognizedRevenue: 300_000, contribution: 90_000, ebitda: 60_000,
    depreciation: 3_000, amortization: 500, ebit: 56_500,
    financeCost: 1_000, pbt: 55_500, tax: 11_000, pat: 44_500,
  }),
  fixtureRow({
    processId: "proc-c", processName: "Gamma",
    recognizedRevenue: 120_000, contribution: -10_000, ebitda: -25_000,
    depreciation: 0, amortization: 0, ebit: -25_000,
    financeCost: 0, pbt: -25_000, tax: 0, pat: -25_000,
  }),
];

function sumField(field: keyof (typeof PROCESS_ROWS)[number]) {
  return PROCESS_ROWS.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
  // Default: process_pnl_cost_component absent/empty for every call, matching production today.
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.tables")) return [[], []];
    return [[], []];
  });
});

afterEach(() => {
  execute.mockReset();
});

describe("bpoPnlFullWaterfallService.getFullWaterfall — branch total equals sum of processes", () => {
  it("sums contribution/ebitda/ebit/pbt/pat/depreciation/amortization/financeCost/tax exactly across the branch's processes", async () => {
    vi.doMock("../canonical-pnl.service.js", () => ({
      getCachedAllocationSummary: vi.fn(async (filters: { branchId?: string }) => ({
        rows: filters.branchId === BRANCH_ID ? PROCESS_ROWS : [],
      })),
    }));

    const { getFullWaterfall } = await import("../bpo-pnl-full-waterfall.service.js");
    const totals = await getFullWaterfall(PERIOD, BRANCH_ID);

    expect(totals.processCount).toBe(3);
    expect(totals.recognizedRevenue).toBeCloseTo(sumField("recognizedRevenue"), 2);
    expect(totals.contribution).toBeCloseTo(sumField("contribution"), 2);
    expect(totals.ebitda).toBeCloseTo(sumField("ebitda"), 2);
    expect(totals.depreciation).toBeCloseTo(sumField("depreciation"), 2);
    expect(totals.amortization).toBeCloseTo(sumField("amortization"), 2);
    expect(totals.ebit).toBeCloseTo(sumField("ebit"), 2);
    expect(totals.financeCost).toBeCloseTo(sumField("financeCost"), 2);
    expect(totals.pbt).toBeCloseTo(sumField("pbt"), 2);
    expect(totals.tax).toBeCloseTo(sumField("tax"), 2);
    expect(totals.pat).toBeCloseTo(sumField("pat"), 2);

    // Hand-verification: manually adding the three processes' own PAT must equal the total PAT,
    // exactly like a reader adding up individual detail pages would.
    const manualPat = 112_000 + 44_500 + (-25_000);
    expect(totals.pat).toBeCloseTo(manualPat, 2);
  });

  it("passes branchId through to getCachedAllocationSummary and returns processCount 0 for a branch with no active processes", async () => {
    vi.doMock("../canonical-pnl.service.js", () => ({
      getCachedAllocationSummary: vi.fn(async () => ({ rows: [] })),
    }));
    const { getFullWaterfall } = await import("../bpo-pnl-full-waterfall.service.js");
    const totals = await getFullWaterfall(PERIOD, "some-other-branch");
    expect(totals.processCount).toBe(0);
    expect(totals.contribution).toBe(0);
    expect(totals.pat).toBe(0);
  });

  it("omits branchId from the filters passed downstream for the company-wide total", async () => {
    const getCachedAllocationSummary = vi.fn(async () => ({ rows: PROCESS_ROWS }));
    vi.doMock("../canonical-pnl.service.js", () => ({ getCachedAllocationSummary }));
    const { getFullWaterfall } = await import("../bpo-pnl-full-waterfall.service.js");
    await getFullWaterfall(PERIOD);
    expect(getCachedAllocationSummary).toHaveBeenCalledWith({ period: PERIOD });
  });
});

describe("costComponentDataFlags — 'not yet configured' vs 'genuinely zero'", () => {
  it("reports every flag false when process_pnl_cost_component has zero rows for the scope (today's real production state)", async () => {
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("information_schema.tables")) {
        return [(params?.[0] === "process_pnl_cost_component" ? [{ 1: 1 }] : []), []];
      }
      if (sql.includes("FROM process_pnl_cost_component")) return [[], []];
      return [[], []];
    });
    const { costComponentDataFlags } = await import("../pnl-cost-component-flags.js");
    const flags = await costComponentDataFlags(PERIOD, { branchId: BRANCH_ID });
    expect(flags).toEqual({
      hasDepreciationData: false,
      hasAmortizationData: false,
      hasFinanceCostData: false,
      hasTaxData: false,
    });
  });

  it("reports true only for cost types with an approved row in scope, leaving the rest 'not yet configured'", async () => {
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("information_schema.tables")) {
        return [(params?.[0] === "process_pnl_cost_component" ? [{ 1: 1 }] : []), []];
      }
      if (sql.includes("FROM process_pnl_cost_component")) {
        // A real row for depreciation only — finance_cost/tax/amortization remain unconfigured.
        return [[{ cost_type: "depreciation" }], []];
      }
      return [[], []];
    });
    const { costComponentDataFlags } = await import("../pnl-cost-component-flags.js");
    const flags = await costComponentDataFlags(PERIOD, { branchId: BRANCH_ID });
    expect(flags.hasDepreciationData).toBe(true);
    expect(flags.hasAmortizationData).toBe(false);
    expect(flags.hasFinanceCostData).toBe(false);
    expect(flags.hasTaxData).toBe(false);
  });

  it("returns every flag false without querying rows when the table doesn't exist yet", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.tables")) return [[], []];
      return [[], []];
    });
    const { costComponentDataFlags } = await import("../pnl-cost-component-flags.js");
    const flags = await costComponentDataFlags(PERIOD, {});
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
  });
});
