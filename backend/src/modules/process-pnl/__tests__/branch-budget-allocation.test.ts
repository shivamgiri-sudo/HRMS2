import { describe, expect, it } from "vitest";
import { computeLineAllocations } from "../branch-budget-allocation.service.js";

interface FakeCostCentre {
  id: string;
  cost_centre_code: string;
  cost_centre_name: string;
}

interface FakeDriver {
  cost_centre_id: string;
  planned_headcount: number;
  revenue_rate_per_head: number;
  remarks: string | null;
  status: string;
  updated_by: string | null;
  updated_at: string | null;
}

function fakeExecutor(costCentres: FakeCostCentre[], drivers: FakeDriver[] = []) {
  return {
    async execute(sql: string, _params?: unknown[]) {
      if (sql.includes("FROM cost_centre_master")) {
        return [costCentres, []];
      }
      if (sql.includes("FROM finance_cost_centre_monthly_driver")) {
        return [drivers, []];
      }
      throw new Error(`fakeExecutor: unexpected query — ${sql}`);
    },
  } as any;
}

const THREE_COST_CENTRES: FakeCostCentre[] = [
  { id: "cc1", cost_centre_code: "CC1", cost_centre_name: "Back Office" },
  { id: "cc2", cost_centre_code: "CC2", cost_centre_name: "Collections" },
  { id: "cc3", cost_centre_code: "CC3", cost_centre_name: "Customer Support" },
];

const AMOUNTS = { baseAmount: 72500, taxAmount: 0, grossAmount: 72500, pnlCostAmount: 72500 };

function sumOf(rows: Awaited<ReturnType<typeof computeLineAllocations>>, key: "grossAmount" | "pnlCostAmount") {
  return rows.reduce((total, row) => total + row[key], 0);
}

describe("computeLineAllocations — branch-first sharing methods", () => {
  it("splits by total_manpower proportional to planned headcount, reconciling exactly", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 10, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
      { cost_centre_id: "cc2", planned_headcount: 5, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
      { cost_centre_id: "cc3", planned_headcount: 5, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "total_manpower", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(36250); // 10/20 * 72500
    expect(byId.cc2.grossAmount).toBe(18125); // 5/20 * 72500
    expect(byId.cc3.grossAmount).toBe(18125);
    expect(sumOf(rows, "grossAmount")).toBe(72500);
    expect(sumOf(rows, "pnlCostAmount")).toBe(72500);
  });

  it("splits by revenue_share using headcount x rate as the driver value", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 10, revenue_rate_per_head: 50000, remarks: null, status: "draft", updated_by: null, updated_at: null },
      { cost_centre_id: "cc2", planned_headcount: 10, revenue_rate_per_head: 30000, remarks: null, status: "draft", updated_by: null, updated_at: null },
      { cost_centre_id: "cc3", planned_headcount: 10, revenue_rate_per_head: 20000, remarks: null, status: "draft", updated_by: null, updated_at: null },
    ];
    // revenue: cc1=500000, cc2=300000, cc3=200000, total=1000000
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "revenue_share", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.driverValue).toBe(500000);
    expect(byId.cc1.grossAmount).toBe(36250); // 50% of 72500
    expect(byId.cc2.grossAmount).toBe(21750); // 30%
    expect(byId.cc3.grossAmount).toBe(14500); // 20%
    expect(sumOf(rows, "grossAmount")).toBe(72500);
  });

  it("splits equally across all active cost centres regardless of driver data", async () => {
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "equal_split", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES)
    );
    expect(sumOf(rows, "grossAmount")).toBe(72500);
    // 72500 / 3 = 24166.66... — largest-remainder method must still reconcile exactly.
    for (const row of rows) {
      expect(Math.abs(row.grossAmount - 72500 / 3)).toBeLessThan(0.01);
    }
  });

  it("applies manual percentages as configured and reconciles exactly when they sum to 100", async () => {
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "manual", AMOUNTS,
      [
        { costCentreId: "cc1", percentage: 50 },
        { costCentreId: "cc2", percentage: 30 },
        { costCentreId: "cc3", percentage: 20 },
      ],
      fakeExecutor(THREE_COST_CENTRES)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(36250);
    expect(byId.cc2.grossAmount).toBe(21750);
    expect(byId.cc3.grossAmount).toBe(14500);
    expect(sumOf(rows, "grossAmount")).toBe(72500);
  });

  it("rejects a manual split that omits an active cost centre", async () => {
    await expect(
      computeLineAllocations(
        "branch-1", "2026-08", "manual", AMOUNTS,
        [{ costCentreId: "cc1", percentage: 100 }],
        fakeExecutor(THREE_COST_CENTRES)
      )
    ).rejects.toThrow(/Missing: Collections, Customer Support|Missing:.*Collections/);
  });

  it("rejects total_manpower/revenue_share when a cost centre has no monthly driver row", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 10, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
      // cc2, cc3 missing entirely
    ];
    await expect(
      computeLineAllocations("branch-1", "2026-08", "total_manpower", AMOUNTS, undefined, fakeExecutor(THREE_COST_CENTRES, drivers))
    ).rejects.toThrow(/planned headcount is missing/i);
  });

  it("rejects an unsupported sharing method (e.g. floor_area) with a clear error, not a silent default", async () => {
    await expect(
      computeLineAllocations("branch-1", "2026-08", "floor_area", AMOUNTS, undefined, fakeExecutor(THREE_COST_CENTRES))
    ).rejects.toThrow(/not yet supported/i);
  });

  it("rejects allocation when the branch has no active cost centres", async () => {
    await expect(
      computeLineAllocations("branch-1", "2026-08", "equal_split", AMOUNTS, undefined, fakeExecutor([]))
    ).rejects.toThrow(/no active cost centres/i);
  });

  it("mandatory meter-style example reconciles to exactly INR 165,000 across three cost centres", async () => {
    // Reuses the mandatory spec example via the manpower driver (7,500/5,000/4,000 "units").
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 7500, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
      { cost_centre_id: "cc2", planned_headcount: 5000, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
      { cost_centre_id: "cc3", planned_headcount: 4000, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "total_manpower",
      { baseAmount: 165000, taxAmount: 0, grossAmount: 165000, pnlCostAmount: 165000 },
      undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(75000);
    expect(byId.cc2.grossAmount).toBe(50000);
    expect(byId.cc3.grossAmount).toBe(40000);
    expect(sumOf(rows, "grossAmount")).toBe(165000);
  });
});
