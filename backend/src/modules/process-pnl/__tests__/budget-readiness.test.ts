import { describe, expect, it } from "vitest";
import { checkBudgetExceptions, checkSharingMethodReadiness } from "../budget-readiness.service.js";

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

interface FakeMeter {
  id: string;
  cost_centre_id: string;
}

interface FakeReading {
  meter_id: string;
  reading_type: "actual" | "estimated";
  consumption: number;
  amount: number;
}

interface FakeGradeDriver {
  cost_centre_id: string;
  planned_headcount: number;
  min_ctc: number;
  max_ctc: number;
}

interface FakeBudget {
  id: string;
  branch_id: string;
  period_code: string;
}

interface FakeLine {
  id: string;
  item_name: string;
  allocation_driver: string | null;
}

function fakeExecutor(options: {
  costCentres?: FakeCostCentre[];
  drivers?: FakeDriver[];
  meters?: FakeMeter[];
  readings?: FakeReading[];
  gradeDrivers?: FakeGradeDriver[];
  budgets?: FakeBudget[];
  lines?: FakeLine[];
  manualTotals?: Record<string, number>;
}) {
  const {
    costCentres = [],
    drivers = [],
    meters = [],
    readings = [],
    gradeDrivers = [],
    budgets = [],
    lines = [],
    manualTotals = {},
  } = options;

  return {
    async execute(sql: string, params?: unknown[]) {
      if (sql.includes("FROM cost_centre_master")) return [costCentres, []];
      if (sql.includes("FROM finance_cost_centre_monthly_driver")) return [drivers, []];
      if (sql.includes("FROM finance_meter_master")) {
        const [costCentreId] = params ?? [];
        return [meters.filter((m) => m.cost_centre_id === costCentreId), []];
      }
      if (sql.includes("FROM finance_meter_reading")) {
        const [meterId, , readingType] = params ?? [];
        const row = readings.find((r) => r.meter_id === meterId && r.reading_type === readingType);
        return [row ? [row] : [], []];
      }
      if (sql.includes("FROM finance_cost_centre_grade_driver")) {
        const [costCentreId] = params as [string];
        return [gradeDrivers.filter((g) => g.cost_centre_id === costCentreId && g.planned_headcount > 0), []];
      }
      if (sql.includes("FROM finance_budget_header")) {
        const [id] = params as [string];
        const budget = budgets.find((b) => b.id === id);
        return [budget ? [budget] : [], []];
      }
      if (sql.startsWith("SELECT id, item_name, allocation_driver")) {
        return [lines, []];
      }
      if (sql.includes("FROM finance_budget_line_allocation")) {
        const [lineId] = params as [string];
        return [[{ total: manualTotals[lineId] ?? 0 }], []];
      }
      throw new Error(`fakeExecutor: unexpected query — ${sql}`);
    },
  } as any;
}

const THREE_COST_CENTRES: FakeCostCentre[] = [
  { id: "cc1", cost_centre_code: "CC1", cost_centre_name: "Back Office" },
  { id: "cc2", cost_centre_code: "CC2", cost_centre_name: "Collections" },
  { id: "cc3", cost_centre_code: "CC3", cost_centre_name: "Support" },
];

describe("checkSharingMethodReadiness", () => {
  it("marks all four methods ready when every cost centre has complete data", async () => {
    const drivers: FakeDriver[] = THREE_COST_CENTRES.map((cc) => ({
      cost_centre_id: cc.id, planned_headcount: 5, revenue_rate_per_head: 50000,
      remarks: null, status: "draft", updated_by: null, updated_at: null,
    }));
    const meters: FakeMeter[] = THREE_COST_CENTRES.map((cc, i) => ({ id: `m${i}`, cost_centre_id: cc.id }));
    const readings: FakeReading[] = meters.map((m) => ({ meter_id: m.id, reading_type: "actual", consumption: 100, amount: 1000 }));
    const gradeDrivers: FakeGradeDriver[] = THREE_COST_CENTRES.map((cc) => ({ cost_centre_id: cc.id, planned_headcount: 2, min_ctc: 120000, max_ctc: 120000 }));

    const result = await checkSharingMethodReadiness(
      "branch-1", "2026-08",
      fakeExecutor({ costCentres: THREE_COST_CENTRES, drivers, meters, readings, gradeDrivers })
    );
    expect(result.every((r) => r.ready)).toBe(true);
    expect(result.map((r) => r.method).sort()).toEqual(
      ["grade_weighted_headcount", "meter_wise", "revenue_share", "total_manpower"].sort()
    );
  });

  it("flags total_manpower and revenue_share not ready when a cost centre has no monthly driver", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 5, revenue_rate_per_head: 50000, remarks: null, status: "draft", updated_by: null, updated_at: null },
      // cc2, cc3 missing
    ];
    const result = await checkSharingMethodReadiness("branch-1", "2026-08", fakeExecutor({ costCentres: THREE_COST_CENTRES, drivers }));
    const manpower = result.find((r) => r.method === "total_manpower")!;
    const revenue = result.find((r) => r.method === "revenue_share")!;
    expect(manpower.ready).toBe(false);
    expect(manpower.missingCostCentres.map((c) => c.name).sort()).toEqual(["Collections", "Support"]);
    expect(revenue.ready).toBe(false);
  });

  it("flags meter_wise not ready when a cost centre has no meter reading", async () => {
    const meters: FakeMeter[] = [{ id: "m1", cost_centre_id: "cc1" }];
    const readings: FakeReading[] = [{ meter_id: "m1", reading_type: "actual", consumption: 100, amount: 1000 }];
    const result = await checkSharingMethodReadiness("branch-1", "2026-08", fakeExecutor({ costCentres: THREE_COST_CENTRES, meters, readings }));
    const meterReadiness = result.find((r) => r.method === "meter_wise")!;
    expect(meterReadiness.ready).toBe(false);
    expect(meterReadiness.missingCostCentres).toHaveLength(2);
  });

  it("flags grade_weighted_headcount not ready when a cost centre has no grade drivers", async () => {
    const gradeDrivers: FakeGradeDriver[] = [{ cost_centre_id: "cc1", planned_headcount: 2, min_ctc: 120000, max_ctc: 120000 }];
    const result = await checkSharingMethodReadiness("branch-1", "2026-08", fakeExecutor({ costCentres: THREE_COST_CENTRES, gradeDrivers }));
    const gradeReadiness = result.find((r) => r.method === "grade_weighted_headcount")!;
    expect(gradeReadiness.ready).toBe(false);
    expect(gradeReadiness.missingCostCentres.map((c) => c.id).sort()).toEqual(["cc2", "cc3"]);
  });

  it("marks every method not ready when the branch has no active cost centres", async () => {
    const result = await checkSharingMethodReadiness("branch-1", "2026-08", fakeExecutor({ costCentres: [] }));
    expect(result.every((r) => !r.ready)).toBe(true);
  });
});

describe("checkBudgetExceptions", () => {
  const budgets: FakeBudget[] = [{ id: "budget-1", branch_id: "branch-1", period_code: "2026-08" }];

  it("returns no exceptions for a manual-split line that totals exactly 100%", async () => {
    const lines: FakeLine[] = [{ id: "line-1", item_name: "Rent", allocation_driver: "manual" }];
    const result = await checkBudgetExceptions("budget-1", fakeExecutor({ budgets, lines, manualTotals: { "line-1": 100 } }));
    expect(result).toEqual([]);
  });

  it("flags a manual-split line whose recorded percentages no longer sum to 100%", async () => {
    const lines: FakeLine[] = [{ id: "line-1", item_name: "Rent", allocation_driver: "manual" }];
    const result = await checkBudgetExceptions("budget-1", fakeExecutor({ budgets, lines, manualTotals: { "line-1": 90 } }));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("manual_split_imbalance");
    expect(result[0].message).toMatch(/90\.00%/);
  });

  it("flags a total_manpower line when driver data is now missing for a cost centre", async () => {
    const lines: FakeLine[] = [{ id: "line-1", item_name: "Salaries", allocation_driver: "total_manpower" }];
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 5, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
    ];
    const result = await checkBudgetExceptions(
      "budget-1",
      fakeExecutor({ budgets, lines, costCentres: THREE_COST_CENTRES, drivers })
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("missing_driver_data");
    expect(result[0].message).toMatch(/Collections/);
  });

  it("returns no exceptions for a cost-centre-direct line (no allocation_driver relevance)", async () => {
    const lines: FakeLine[] = [{ id: "line-1", item_name: "Direct item", allocation_driver: null }];
    const result = await checkBudgetExceptions("budget-1", fakeExecutor({ budgets, lines }));
    expect(result).toEqual([]);
  });

  it("returns an empty array when the budget has no branch-common lines", async () => {
    const result = await checkBudgetExceptions("budget-1", fakeExecutor({ budgets, lines: [] }));
    expect(result).toEqual([]);
  });

  it("returns an empty array when the budget does not exist", async () => {
    const result = await checkBudgetExceptions("nonexistent", fakeExecutor({ budgets: [] }));
    expect(result).toEqual([]);
  });
});
