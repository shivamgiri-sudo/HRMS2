import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OWNER RULE 2026-09-24: "Reserved + Consumed should be there in P&L".
 *
 * The canonical (process / bpo) engine's allocation overlay — which the Process P&L header's
 * process basis and the Full P&L Waterfall both read — used to fold in CONSUMED GRN allocations only
 * (vw_process_pnl_grn_allocation). It now also folds in RESERVED allocations (ex-GST), for any
 * month, and publishes that part as grnCommitted. 'draft' allocations never count.
 *
 * Fixture: one process, consumed 100 and reserved 40 in a closed month, both bmc_non_people.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

const PERIOD = "2026-03";
const BRANCH_ID = "branch-1";
const PROC = "proc-1";

beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
});

function summaryRow() {
  return {
    processId: PROC, processName: "Proc", branchId: BRANCH_ID, branchName: "B", activeHc: 1,
    dscPeople: 0, dscNonPeople: 0, dsc: 0, bmcPeople: 0, bmcNonPeople: 0, bmc: 0,
    agentSalary: 0, recognizedRevenue: 1000, grnVendorActual: 0, depreciation: 0,
    amortization: 0, financeCost: 0, tax: 0, pbt: 0, ebit: 0, ebitda: 0,
    totalOperatingCost: 0, contribution: 0, billableHc: 0, ebitdaBudget: null,
    revenueAtRisk: 0, deliveryAttainmentPct: null, operatingProfit: 0, totalPeopleCost: 0,
  };
}

async function loadOverlay() {
  vi.doMock("../bpo-pnl.service.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../bpo-pnl.service.js")>();
    return {
      ...actual,
      bpoPnlService: {
        ...actual.bpoPnlService,
        getSummary: vi.fn(async (filters: unknown) => ({
          period: PERIOD, filters, kpis: {}, costMix: {}, revenueMix: {},
          alerts: [], rows: [summaryRow()], generatedAt: new Date().toISOString(),
        })),
      },
    };
  });
  execute.mockImplementation(async (sql: string, params?: unknown[]) => {
    const q = String(sql);
    const p = (params ?? []) as unknown[];
    if (q.includes("information_schema.tables")) return [p[0] === "grn_cost_allocation" ? [{ 1: 1 }] : [], []];
    if (q.includes("information_schema.columns") && q.includes("ex_gst_amount")) return [[{ 1: 1 }], []];
    if (q.includes("vw_process_pnl_grn_allocation")) {
      return [[{ process_id: PROC, branch_id: BRANCH_ID, period_code: PERIOD, pnl_bucket: "bmc_non_people", amount: 100, allocation_count: 1, freshness: null }], []];
    }
    if (q.includes("FROM grn_cost_allocation a") && q.includes("lifecycle_status = 'reserved'")) {
      return [[{ process_id: PROC, branch_id: BRANCH_ID, period_code: PERIOD, pnl_bucket: "bmc_non_people", amount: 40, allocation_count: 1, freshness: null }], []];
    }
    return [[], []];
  });
  return (await import("../bpo-pnl-allocation-overlay.service.js")).bpoPnlAllocationOverlayService;
}

describe("bpo allocation overlay — GRN Committed (reserved) folded in for every month", () => {
  it("consumed 100 + reserved 40 = 140 indirect; EBITDA / Operating Profit subtract both", async () => {
    const overlay = await loadOverlay();
    const summary = await overlay.getSummary({ period: PERIOD });
    const row = summary.rows[0];
    expect(row.grnVendorActual).toBe(140);
    expect(row.grnCommitted).toBe(40);
    expect(row.bmcNonPeople).toBe(140);
    expect(row.ebitda).toBe(1000 - 140);
    expect(row.operatingProfit).toBe(1000 - 140);
    expect((summary.kpis as { grnCommitted?: number }).grnCommitted).toBe(40);
    expect(summary.kpis.grnVendorActual).toBe(140);
  });

  it("reads 'reserved' only — draft allocations are never committed cost", async () => {
    const overlay = await loadOverlay();
    await overlay.getSummary({ period: PERIOD });
    const reservedSql = execute.mock.calls.map((c) => String(c[0]))
      .find((q) => q.includes("FROM grn_cost_allocation a") && q.includes("'reserved'"))!;
    expect(reservedSql).toContain("a.lifecycle_status = 'reserved'");
    expect(reservedSql).not.toContain("'draft'");
    expect(reservedSql, "ex-GST, same guard as the shared reader").toContain("amount_without_tax");
  });
});
