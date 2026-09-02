import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the branch-pool broadcast bug (fixed 2026-09-01).
 *
 * Root cause: a `processId` filter reached `processPnlService.listProcesses()` /
 * `bpoPnlService.getSummary()` BEFORE the branch-pool allocators ran
 * (allocateBranchPools in bpo-pnl.service.ts, allocateBranchPool in
 * bpo-pnl-allocation-overlay.service.ts). Pruning a branch's rows down to exactly the
 * one requested process made every allocator treat that single row as 100% of the
 * branch, so it received the ENTIRE branch pool instead of its proportional share.
 *
 * Live-proven on NOIDA-2 (period 2026-07, 6 processes): every process's detail page
 * showed the identical 807,669.06 branch pool instead of its real split
 * (Onfido=599,238.33, BTM Ventures=104,215.36, GS1=22,797.10, MNP REJECTION=0,
 * Finnable=29,310.58, Captureatrip=52,107.68) — swept across NOIDA (18/18) and
 * AHMEDABAD-JALDARSHAN (9/9) too, ~₹4.33 crore overstatement.
 *
 * Two independent instances of the same broadcast, fixed separately because each runs
 * its own allocation pass:
 *   (a) bpo-pnl.service.ts — buildRows()/computeBranchRows() feeding
 *       getPeopleCosts/getCostComponents/getBudgets/getGrnVendorActuals's
 *       allocateBranchPools calls.
 *   (b) bpo-pnl-allocation-overlay.service.ts — getSummary()'s own buildAllocationMaps/
 *       allocateBranchPool pass over the GRN-allocation-view and legacy vendor pools.
 *
 * Both tests below plant a branch with 2 processes (weight 3:1 on activeHc, the default
 * allocation driver) and a single shared pool, and assert the pool splits 75/25 instead
 * of broadcasting 100% to whichever process was asked for. Verified to FAIL without the
 * fix (see verification notes in the accompanying commit) and PASS with it.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const PERIOD = "2027-01";
const BRANCH_ID = "branch-bcast-1";
const PROC_HEAVY = "proc-heavy"; // activeHc 3 -> should draw 75% of the shared pool
const PROC_LIGHT = "proc-light"; // activeHc 1 -> should draw 25% of the shared pool
const SHARED_POOL_AMOUNT = 100_000;

function baseProcessRecord(overrides: Record<string, unknown>) {
  return {
    processId: "", processName: "", clientId: null, clientName: null,
    branchId: BRANCH_ID, branchName: "Branch B1", billingModel: null, resolvedRate: null,
    rateSource: "missing", rateType: null, billingUnit: null, rateEffectiveFrom: null,
    approvalReference: null, configurationStatus: "missing",
    contractedSeats: 0, billableHc: 0, requiredProductiveHc: 0, requiredRosterHc: 0,
    activeHc: 0, deployedHc: 0, bufferTargetPct: null, actualBufferPct: null,
    revenueMtd: 0, revenueForecast: 0, invoicedRevenueMtd: 0, collectedRevenueMtd: 0,
    outstandingReceivable: 0, receivableRisk: 0, totalCommercialExposure: 0,
    salaryMtd: 0, directPeopleCost: 0, directNonPeopleCost: 0, directCost: 0,
    indirectCost: 0, totalCost: 0, contributionMargin: 0, operatingProfit: 0,
    operatingMarginPct: null, revenueBudget: null, directCostBudget: null,
    indirectCostBudget: null, profitBudget: null, revenueVariance: null,
    directCostVariance: null, indirectCostVariance: null, operatingProfitVariance: null,
    operatingMarginVariance: null, headcountVariance: null, bufferVariance: null,
    budgetVariance: null, revenueLeakage: 0, revenueAtRisk: 0, monthEndProjectedProfit: 0,
    reconciliationStatus: "matched", financialStatus: "actual", processStatus: "profitable",
    freshness: null,
    ...overrides,
  };
}

const ALL_ROWS = [
  baseProcessRecord({ processId: PROC_HEAVY, processName: "Heavy", activeHc: 3 }),
  baseProcessRecord({ processId: PROC_LIGHT, processName: "Light", activeHc: 1 }),
];

/** Every SQL statement gets an empty result unless matched below — mirrors the blanket
 *  mock in pnl-multi-branch-scope.test.ts. tableExists()/listColumns() interpret an
 *  empty row set as "false"/"no columns", which short-circuits every other query path
 *  in buildRows() harmlessly (0 cost, 0 revenue) so only the one pool under test is
 *  non-zero. */
function installDbMock(overrides: (sql: string, params: unknown[]) => unknown[] | null) {
  execute.mockReset();
  execute.mockImplementation(async (sql: string, params?: unknown[]) => {
    const matched = overrides(sql, (params ?? []) as unknown[]);
    return [matched ?? [], []];
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  execute.mockReset();
});

describe("bpoPnlService.getSummary — branch pool no longer broadcasts to a processId filter (fix a)", () => {
  it("splits a shared otherOperatingCost pool 75/25 by activeHc instead of handing it 100% to the requested process", async () => {
    vi.doMock("../process-pnl.service.js", () => ({
      processPnlService: {
        // The bug, reproduced exactly: a caller that still threads processId through to
        // listProcesses() only ever sees that one process, before any pool splits.
        listProcesses: vi.fn(async (filters: { processId?: string }) =>
          filters.processId ? ALL_ROWS.filter((r) => r.processId === filters.processId) : ALL_ROWS
        ),
        invalidateCaches: vi.fn(),
      },
    }));
    installDbMock((sql, params) => {
      if (sql.includes("information_schema.tables")) {
        return params[0] === "process_pnl_cost_component" ? [{ 1: 1 }] : [];
      }
      if (sql.includes("FROM process_pnl_cost_component")) {
        // One branch-level (process_id NULL) shared pool row — the live shape for an
        // un-split "otherOperatingCost" the branch has not attributed to any one process.
        return [{
          process_id: null, branch_id: BRANCH_ID, cost_type: "other_operating_cost",
          amount_inr: SHARED_POOL_AMOUNT, allocation_driver: null, manual_allocation_pct: null,
        }];
      }
      return [];
    });

    const { bpoPnlService } = await import("../bpo-pnl.service.js");
    // Optional: only present on the fixed module (a fresh module instance from
    // vi.resetModules() above has no cache to clear anyway, but calling it if present
    // keeps this test correct even if that changes).
    bpoPnlService.invalidateCaches?.();

    const heavy = await bpoPnlService.getSummary({ period: PERIOD, branchId: BRANCH_ID, processId: PROC_HEAVY });
    const light = await bpoPnlService.getSummary({ period: PERIOD, branchId: BRANCH_ID, processId: PROC_LIGHT });

    const heavyCost = heavy.rows.find((r) => r.processId === PROC_HEAVY)!.totalOperatingCost;
    const lightCost = light.rows.find((r) => r.processId === PROC_LIGHT)!.totalOperatingCost;

    expect(heavyCost, "the heavier process (3/4 of branch activeHc) must draw 75% of the pool, not all of it")
      .toBeCloseTo(75_000, 2);
    expect(lightCost, "the lighter process (1/4 of branch activeHc) must draw 25% of the pool, not all of it")
      .toBeCloseTo(25_000, 2);
    expect(heavyCost + lightCost, "the pool must be conserved across the branch, never duplicated")
      .toBeCloseTo(SHARED_POOL_AMOUNT, 2);
  });
});

describe("bpoPnlAllocationOverlayService.getSummary — GRN/legacy pool no longer broadcasts to a processId filter (fix b)", () => {
  it("splits a shared GRN-allocation-view bmc_non_people pool 75/25 by activeHc instead of handing it 100% to the requested process", async () => {
    const summaryRows = ALL_ROWS.map((row) => ({
      ...row,
      dscPeople: 0, dscNonPeople: 0, dsc: 0, bmcPeople: 0, bmcNonPeople: 0, bmc: 0,
      agentSalary: 0, recognizedRevenue: 0, grnVendorActual: 0, depreciation: 0,
      amortization: 0, financeCost: 0, tax: 0, pbt: 0, ebit: 0, ebitda: 0,
      totalOperatingCost: 0, contribution: 0, billableHc: 0, ebitdaBudget: null,
      revenueAtRisk: 0, deliveryAttainmentPct: null, operatingProfit: 0,
    }));
    vi.doMock("../bpo-pnl.service.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../bpo-pnl.service.js")>();
      return {
        ...actual,
        bpoPnlService: {
          ...actual.bpoPnlService,
          getSummary: vi.fn(async (filters: { processId?: string }) => {
            const rows = filters.processId
              ? summaryRows.filter((r) => r.processId === filters.processId)
              : summaryRows;
            return {
              period: PERIOD, filters, kpis: {}, costMix: {}, revenueMix: {},
              alerts: [], rows, generatedAt: new Date().toISOString(),
            };
          }),
        },
      };
    });
    installDbMock((sql, params) => {
      if (sql.includes("information_schema.tables")) {
        return params[0] === "grn_cost_allocation" ? [{ 1: 1 }] : [];
      }
      if (sql.includes("vw_process_pnl_grn_allocation")) {
        // One branch-level (process_id NULL) GRN-allocation-view pool row.
        return [{
          process_id: null, branch_id: BRANCH_ID, period_code: PERIOD,
          pnl_bucket: "bmc_non_people", pnl_cost_amount: SHARED_POOL_AMOUNT,
          allocation_count: 1, freshness: null,
        }];
      }
      return [];
    });

    const { bpoPnlAllocationOverlayService } = await import("../bpo-pnl-allocation-overlay.service.js");

    const heavy = await bpoPnlAllocationOverlayService.getSummary({ period: PERIOD, branchId: BRANCH_ID, processId: PROC_HEAVY });
    const light = await bpoPnlAllocationOverlayService.getSummary({ period: PERIOD, branchId: BRANCH_ID, processId: PROC_LIGHT });

    const heavyBmc = heavy.rows.find((r) => r.processId === PROC_HEAVY)!.bmcNonPeople;
    const lightBmc = light.rows.find((r) => r.processId === PROC_LIGHT)!.bmcNonPeople;

    expect(heavyBmc, "the heavier process (3/4 of branch activeHc) must draw 75% of the GRN pool, not all of it")
      .toBeCloseTo(75_000, 2);
    expect(lightBmc, "the lighter process (1/4 of branch activeHc) must draw 25% of the GRN pool, not all of it")
      .toBeCloseTo(25_000, 2);
    expect(heavyBmc + lightBmc, "the pool must be conserved across the branch, never duplicated")
      .toBeCloseTo(SHARED_POOL_AMOUNT, 2);
  });
});
