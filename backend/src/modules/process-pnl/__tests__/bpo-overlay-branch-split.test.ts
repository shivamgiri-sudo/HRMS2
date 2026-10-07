import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Head Office GRN split across branches in the Process Matrix / BPO engine (2026-10-07).
 *
 * The engine counts a GRN header at the header's branch (Head Office: Rs 1,000 in the HO process's
 * overhead). The allocation overlay then subtracts that header and adds each consumed allocation row
 * where it belongs. For a branch split the rows sit on two other branches, so afterwards Head Office
 * must carry 0 and each branch its own share. This holds only because the split GRN header is classed
 * 'indirect' (a 'direct' header with no process is the one case the subtraction skips).
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

const PERIOD = "2026-08";
beforeEach(() => { vi.resetModules(); execute.mockReset(); });

const base = (processId: string, branchId: string, bmcNonPeople: number) => ({
  processId, processName: processId, branchId, branchName: branchId, activeHc: 1,
  dscPeople: 0, dscNonPeople: 0, dsc: 0, bmcPeople: 0, bmcNonPeople, bmc: bmcNonPeople,
  agentSalary: 0, recognizedRevenue: 0, grnVendorActual: bmcNonPeople, depreciation: 0,
  amortization: 0, financeCost: 0, tax: 0, pbt: 0, ebit: 0, ebitda: 0,
  totalOperatingCost: bmcNonPeople, contribution: 0, billableHc: 0, ebitdaBudget: null,
  revenueAtRisk: 0, deliveryAttainmentPct: null, operatingProfit: 0, totalPeopleCost: 0,
});

async function overlay(opts: { headerClass: "indirect" | "direct" }) {
  vi.doMock("../bpo-pnl.service.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../bpo-pnl.service.js")>();
    return {
      ...actual,
      bpoPnlService: {
        ...actual.bpoPnlService,
        getSummary: vi.fn(async (filters: unknown) => ({
          period: PERIOD, filters, kpis: {}, costMix: {}, revenueMix: {}, alerts: [],
          // The whole Rs 1,000 bill, counted once, on the Head Office process row.
          rows: [base("p-ho", "ho", 1000), base("p-A", "br-A", 0), base("p-B", "br-B", 0)],
          generatedAt: new Date().toISOString(),
        })),
      },
    };
  });
  execute.mockImplementation(async (sql: string, params?: unknown[]) => {
    const q = String(sql);
    const p = (params ?? []) as unknown[];
    if (q.includes("information_schema.tables")) return [p[0] === "grn_cost_allocation" ? [{ 1: 1 }] : [], []];
    if (q.includes("information_schema.columns") && q.includes("ex_gst_amount")) return [[{ 1: 1 }], []];
    // The payable-row leg of the same subtraction: none in this fixture (the header leg carries it).
    if (q.includes("FROM vendor_payment_tracking vpt") && q.includes("allocated")) return [[], []];
    // Legacy header subtraction: the GRN header as the base engine counted it, at Head Office.
    // Matched BEFORE the view: its SQL comment names vw_process_pnl_grn_allocation.
    if (q.includes("FROM grn_request g") && q.includes("JOIN (") && q.includes("allocated")) {
      return [[{ process_id: null, branch_id: "ho", cost_class: opts.headerClass, amount: 1000 }], []];
    }
    if (q.includes("vw_process_pnl_grn_allocation")) {
      return [[
        { process_id: null, branch_id: "br-A", period_code: PERIOD, pnl_bucket: "bmc_non_people", amount: 600, allocation_count: 1, freshness: null },
        { process_id: null, branch_id: "br-B", period_code: PERIOD, pnl_bucket: "bmc_non_people", amount: 400, allocation_count: 1, freshness: null },
      ], []];
    }
    return [[], []];
  });
  return (await import("../bpo-pnl-allocation-overlay.service.js")).bpoPnlAllocationOverlayService;
}

describe("Process Matrix: Head Office GRN split across branches", () => {
  it("Head Office ends at 0 and each branch carries its own share; the company total is the bill, once", async () => {
    const svc = await overlay({ headerClass: "indirect" });
    const summary = await svc.getSummary({ period: PERIOD });
    const bmc = (p: string) => summary.rows.find((r: any) => r.processId === p)!.bmcNonPeople;
    expect(bmc("p-ho")).toBe(0);
    expect(bmc("p-A")).toBe(600);
    expect(bmc("p-B")).toBe(400);
    expect(summary.rows.reduce((t: number, r: any) => t + r.bmcNonPeople, 0)).toBe(1000);
  });

  it("control: a header left 'direct' with no process would NOT be subtracted — Head Office would keep the whole bill on top of the branches' shares (why the split header is classed indirect)", async () => {
    const svc = await overlay({ headerClass: "direct" });
    const summary = await svc.getSummary({ period: PERIOD });
    const bmc = (p: string) => summary.rows.find((r: any) => r.processId === p)!.bmcNonPeople;
    expect(bmc("p-ho")).toBe(1000);
    expect(summary.rows.reduce((t: number, r: any) => t + r.bmcNonPeople, 0)).toBe(2000);
  });
});
