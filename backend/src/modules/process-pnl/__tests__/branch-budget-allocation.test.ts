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
  /** Migration 434 columns, optional so existing fixtures stay untouched. */
  seat_count?: number;
  floor_area_sqft?: number;
  device_count?: number;
  hiring_volume?: number;
  remarks?: string | null;
  status?: string;
  updated_by?: string | null;
  updated_at?: string | null;
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

function fakeExecutor(
  costCentres: FakeCostCentre[],
  drivers: FakeDriver[] = [],
  meters: FakeMeter[] = [],
  readings: FakeReading[] = [],
  gradeDrivers: FakeGradeDriver[] = [],
  /** Live staff per cost centre, from `employees`. planned_headcount falls back to this when
   *  Finance has not typed one — see getMonthlyDrivers. Empty by default, so every existing
   *  fixture keeps behaving as though only the typed drivers exist. */
  liveHeadcount: Array<{ cost_centre_id: string; live_headcount: number }> = []
) {
  return {
    async execute(sql: string, params?: unknown[]) {
      if (sql.includes("FROM cost_centre_master")) {
        return [costCentres, []];
      }
      if (sql.includes("FROM finance_cost_centre_monthly_driver")) {
        return [drivers, []];
      }
      if (sql.includes("AS live_headcount")) {
        return [liveHeadcount, []];
      }
      if (sql.includes("FROM finance_meter_master")) {
        // Since migration 434 meters are resolved for the whole branch in one query, because a
        // shared meter belongs to no single cost centre. Fixtures here are all dedicated
        // electricity meters, which is how the live table defaults pre-434 rows.
        return [meters.map((m) => ({
          ...m,
          branch_id: params?.[0] ?? "branch-1",
          meter_type: "dedicated",
          utility_type: "electricity",
          parent_meter_id: null,
          share_rule: null,
        })), []];
      }
      if (sql.includes("FROM finance_meter_reading")) {
        const [meterId, , readingType] = params ?? [];
        const row = readings.find((r) => r.meter_id === meterId && r.reading_type === readingType);
        return [row ? [row] : [], []];
      }
      if (sql.includes("FROM finance_cost_centre_grade_driver")) {
        const [costCentreId] = params ?? [];
        return [gradeDrivers.filter((g) => g.cost_centre_id === costCentreId && g.planned_headcount > 0), []];
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
    // 72500 / 3 = 24166.66..., which cannot be paid in whole rupees. Budget allocation runs at
    // rupee granularity so the grid's visible column adds up, so largest remainder hands out the
    // odd rupees: 24167 + 24167 + 24166. Every share is a whole rupee, none is more than a rupee
    // from the ideal, and the three still reconcile to the line exactly.
    expect(rows.every((row) => Number.isInteger(row.grossAmount))).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.grossAmount, 0)).toBe(72500);
    for (const row of rows) {
      expect(Math.abs(row.grossAmount - 72500 / 3)).toBeLessThan(1);
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

  it("rejects a manual split covering every cost centre but not summing to 100% (backend-authoritative block)", async () => {
    await expect(
      computeLineAllocations(
        "branch-1", "2026-08", "manual", AMOUNTS,
        [
          { costCentreId: "cc1", percentage: 40 },
          { costCentreId: "cc2", percentage: 30 },
          { costCentreId: "cc3", percentage: 20 },
        ],
        fakeExecutor(THREE_COST_CENTRES)
      )
    ).rejects.toThrow(/must total 100%.*90\.00%/);
  });

  /*
   * A cost centre with no headcount carries no share — it does not block the line.
   *
   * This used to reject the whole line, which reads as a data-quality gate and behaves as a denial
   * of service: on 2026-08, 331 active cost centres had no headcount, 325 of them because they
   * employ nobody — imported site codes on the master. One of those was enough to stop rent,
   * electricity and the cafeteria being shared out across the cost centres that DO have people,
   * and Rs 3.46 crore ended up owned by nobody. Zero is not missing; it is the arithmetic working.
   * `revenue_share` and `meter_wise` already took this position — see the test directly below.
   */
  it("does not reject total_manpower when a cost centre has no headcount — it just carries no share", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 10, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
      // cc2, cc3 missing entirely
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "total_manpower", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(72500); // the only staffed cost centre carries the pool
    expect(byId.cc2.grossAmount).toBe(0);
    expect(byId.cc3.grossAmount).toBe(0);
    expect(sumOf(rows, "grossAmount")).toBe(72500);
  });

  it("falls back to live staff when Finance has typed no headcount", async () => {
    // The number was always in `employees`; requiring it to be re-typed into Branch Budget is what
    // left 331 cost centres blank. A typed plan still wins where one exists.
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 10, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "total_manpower", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers, [], [], [], [
        { cost_centre_id: "cc1", live_headcount: 999 }, // ignored — cc1 has a typed plan of 10
        { cost_centre_id: "cc2", live_headcount: 10 },
      ])
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(byId.cc2.grossAmount); // 10 planned vs 10 live, so an even split
    expect(byId.cc3.grossAmount).toBe(0); // no plan, no staff
    expect(sumOf(rows, "grossAmount")).toBe(72500);
  });

  it("still refuses when NO cost centre has the driver — there is nothing to share by", async () => {
    // The one case that is genuinely an error. An even split here would be an invention, not a
    // calculation, so it must refuse rather than quietly spread the cost evenly.
    await expect(
      computeLineAllocations("branch-1", "2026-08", "total_manpower", AMOUNTS, undefined,
        fakeExecutor(THREE_COST_CENTRES, []))
    ).rejects.toMatchObject({ code: "MONTHLY_DRIVER_MISSING" });
  });

  it("does not reject revenue_share when a cost centre has zero or missing revenue — it just carries no share", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 10, revenue_rate_per_head: 50000, remarks: null, status: "draft", updated_by: null, updated_at: null },
      { cost_centre_id: "cc2", planned_headcount: 10, revenue_rate_per_head: 0, remarks: null, status: "draft", updated_by: null, updated_at: null },
      // cc3 missing entirely — also must not block the save
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "revenue_share", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(72500); // sole revenue carries the whole pool
    expect(byId.cc2.grossAmount).toBe(0);
    expect(byId.cc3.grossAmount).toBe(0);
    expect(sumOf(rows, "grossAmount")).toBe(72500);
  });

  it("rejects a genuinely unsupported sharing method with a clear error, not a silent default", async () => {
    // floor_area used to be the example here, but migration 434 made it a real method: it is
    // seeded as default_allocation_driver on several sub-heads, so rejecting it meant a sub-head's
    // own default could not be applied. Something never seeded is used instead.
    await expect(
      computeLineAllocations("branch-1", "2026-08", "phase_of_moon", AMOUNTS, undefined, fakeExecutor(THREE_COST_CENTRES))
    ).rejects.toThrow(/not yet supported/i);
  });

  it("splits floor_area by each cost centre's floor area, since it is a seeded sub-head default", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 0, revenue_rate_per_head: 0, floor_area_sqft: 6000 },
      { cost_centre_id: "cc2", planned_headcount: 0, revenue_rate_per_head: 0, floor_area_sqft: 3000 },
      { cost_centre_id: "cc3", planned_headcount: 0, revenue_rate_per_head: 0, floor_area_sqft: 1000 },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "floor_area", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(AMOUNTS.grossAmount * 0.6);
    expect(byId.cc2.grossAmount).toBe(AMOUNTS.grossAmount * 0.3);
    expect(byId.cc3.grossAmount).toBe(AMOUNTS.grossAmount * 0.1);
    expect(rows.reduce((a, r) => a + r.grossAmount, 0)).toBe(AMOUNTS.grossAmount);
  });

  it("names the driver correctly when no cost centre has any of it", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 0, revenue_rate_per_head: 0, seat_count: 0 },
      { cost_centre_id: "cc2", planned_headcount: 0, revenue_rate_per_head: 0, seat_count: 0 },
      { cost_centre_id: "cc3", planned_headcount: 0, revenue_rate_per_head: 0, seat_count: 0 },
    ];
    await expect(
      computeLineAllocations("branch-1", "2026-08", "seat_count", AMOUNTS, undefined,
        fakeExecutor(THREE_COST_CENTRES, drivers))
    ).rejects.toThrow(/seat count/i);
  });

  it("shares by seat count across only the cost centres that have seats", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 0, revenue_rate_per_head: 0, seat_count: 10 },
      { cost_centre_id: "cc2", planned_headcount: 0, revenue_rate_per_head: 0, seat_count: 0 },
      { cost_centre_id: "cc3", planned_headcount: 0, revenue_rate_per_head: 0, seat_count: 5 },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "seat_count", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc2.grossAmount).toBe(0);
    expect(byId.cc1.grossAmount).toBeGreaterThan(byId.cc3.grossAmount); // 10 seats vs 5
    expect(sumOf(rows, "grossAmount")).toBe(72500);
  });

  // Cost-centre scope. Before this, a branch-common line always hit every active cost centre and
  // the only way to leave one out was a manual split assigning it 0%.
  it("splits across only the selected cost centres, leaving the rest with no allocation row", async () => {
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 300, revenue_rate_per_head: 0 },
      { cost_centre_id: "cc2", planned_headcount: 100, revenue_rate_per_head: 0 },
      // cc3 has no driver data at all, which is fine once it is out of scope
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "total_manpower", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers), undefined, ["cc1", "cc2"]
    );
    expect(rows.map((r) => r.costCentreId).sort()).toEqual(["cc1", "cc2"]);
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(AMOUNTS.grossAmount * 0.75);
    expect(byId.cc2.grossAmount).toBe(AMOUNTS.grossAmount * 0.25);
    // The whole line still lands — nothing is lost to the excluded cost centre.
    expect(rows.reduce((a, r) => a + r.grossAmount, 0)).toBe(AMOUNTS.grossAmount);
  });

  it("spreads across every active cost centre when no scope is given", async () => {
    const drivers: FakeDriver[] = THREE_COST_CENTRES.map((cc) => ({
      cost_centre_id: cc.id, planned_headcount: 100, revenue_rate_per_head: 0,
    }));
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "total_manpower", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, drivers)
    );
    expect(rows).toHaveLength(3);
  });

  it("does not demand driver data for a cost centre that is out of scope", async () => {
    // The whole point: cc3 has no headcount, which would previously have thrown even though the
    // line does not apply to cc3.
    const drivers: FakeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 50, revenue_rate_per_head: 0 },
      { cost_centre_id: "cc3", planned_headcount: 0, revenue_rate_per_head: 0 },
    ];
    await expect(
      computeLineAllocations("branch-1", "2026-08", "total_manpower", AMOUNTS, undefined,
        fakeExecutor(THREE_COST_CENTRES, drivers), undefined, ["cc1"])
    ).resolves.toHaveLength(1);
  });

  it("rejects a scope naming a cost centre that is not active for the branch", async () => {
    await expect(
      computeLineAllocations("branch-1", "2026-08", "equal_split", AMOUNTS, undefined,
        fakeExecutor(THREE_COST_CENTRES), undefined, ["cc1", "cc-not-here"])
    ).rejects.toThrow(/not active for this branch/i);
  });

  it("requires manual percentages only for the selected cost centres", async () => {
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "manual", AMOUNTS,
      [{ costCentreId: "cc1", percentage: 70 }, { costCentreId: "cc2", percentage: 30 }],
      fakeExecutor(THREE_COST_CENTRES), undefined, ["cc1", "cc2"]
    );
    expect(rows.map((r) => r.costCentreId).sort()).toEqual(["cc1", "cc2"]);
    expect(rows.reduce((a, r) => a + r.grossAmount, 0)).toBe(AMOUNTS.grossAmount);
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

  it("splits meter_wise proportional to summed meter consumption, reconciling to the mandatory example", async () => {
    const meters: FakeMeter[] = [
      { id: "m1", cost_centre_id: "cc1" },
      { id: "m2", cost_centre_id: "cc2" },
      { id: "m3", cost_centre_id: "cc3" },
    ];
    const readings: FakeReading[] = [
      { meter_id: "m1", reading_type: "actual", consumption: 7500, amount: 75000 },
      { meter_id: "m2", reading_type: "actual", consumption: 5000, amount: 50000 },
      { meter_id: "m3", reading_type: "actual", consumption: 4000, amount: 40000 },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "meter_wise",
      { baseAmount: 165000, taxAmount: 0, grossAmount: 165000, pnlCostAmount: 165000 },
      undefined,
      fakeExecutor(THREE_COST_CENTRES, [], meters, readings)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(75000);
    expect(byId.cc2.grossAmount).toBe(50000);
    expect(byId.cc3.grossAmount).toBe(40000);
    expect(sumOf(rows, "grossAmount")).toBe(165000);
  });

  it("prefers a meter's actual reading over its estimated reading when both exist", async () => {
    const meters: FakeMeter[] = [
      { id: "m1", cost_centre_id: "cc1" },
      { id: "m2", cost_centre_id: "cc2" },
      { id: "m3", cost_centre_id: "cc3" },
    ];
    const readings: FakeReading[] = [
      { meter_id: "m1", reading_type: "estimated", consumption: 6000, amount: 60000 },
      { meter_id: "m1", reading_type: "actual", consumption: 7500, amount: 75000 },
      { meter_id: "m2", reading_type: "actual", consumption: 5000, amount: 50000 },
      { meter_id: "m3", reading_type: "actual", consumption: 4000, amount: 40000 },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "meter_wise",
      { baseAmount: 165000, taxAmount: 0, grossAmount: 165000, pnlCostAmount: 165000 },
      undefined,
      fakeExecutor(THREE_COST_CENTRES, [], meters, readings)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(75000); // uses the actual 7,500, not the estimated 6,000
  });

  it("allocates meter_wise across only the metered cost centres, leaving unmetered ones at zero", async () => {
    // This used to throw. Requiring EVERY active cost centre to be metered rejected the ordinary
    // real case — a dedicated meter on a few processes and none on the rest — which is precisely
    // what meter-wise sharing exists for. An unmetered cost centre carries no share of a metered
    // cost, so it gets zero rather than blocking the whole line.
    const meters: FakeMeter[] = [
      { id: "m1", cost_centre_id: "cc1" },
      { id: "m2", cost_centre_id: "cc2" },
      // cc3 has no meter at all
    ];
    const readings: FakeReading[] = [
      { meter_id: "m1", reading_type: "actual", consumption: 7500, amount: 75000 },
      { meter_id: "m2", reading_type: "actual", consumption: 2500, amount: 25000 },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "meter_wise", AMOUNTS, undefined,
      fakeExecutor(THREE_COST_CENTRES, [], meters, readings)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(AMOUNTS.grossAmount * 0.75);
    expect(byId.cc2.grossAmount).toBe(AMOUNTS.grossAmount * 0.25);
    expect(byId.cc3.grossAmount).toBe(0);
    // Still reconciles exactly to the line total.
    expect(rows.reduce((a, r) => a + r.grossAmount, 0)).toBe(AMOUNTS.grossAmount);
  });

  it("still rejects meter_wise when the branch has no meter data anywhere", async () => {
    // Nothing to apportion by at all is a real error — distinct from "some cost centres unmetered".
    await expect(
      computeLineAllocations(
        "branch-1", "2026-08", "meter_wise", AMOUNTS, undefined,
        fakeExecutor(THREE_COST_CENTRES, [], [], [])
      )
    ).rejects.toThrow(/No meter reading exists/i);
  });

  it("splits grade_weighted_headcount proportional to blended grade cost, reconciling to the mandatory example", async () => {
    // rate 10,000/head/month (min_ctc = max_ctc = 120,000/yr), headcount 7.5/5/4 -> 165,000 pool.
    const gradeDrivers: FakeGradeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 7.5, min_ctc: 120000, max_ctc: 120000 },
      { cost_centre_id: "cc2", planned_headcount: 5, min_ctc: 120000, max_ctc: 120000 },
      { cost_centre_id: "cc3", planned_headcount: 4, min_ctc: 120000, max_ctc: 120000 },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "grade_weighted_headcount",
      { baseAmount: 165000, taxAmount: 0, grossAmount: 165000, pnlCostAmount: 165000 },
      undefined,
      fakeExecutor(THREE_COST_CENTRES, [], [], [], gradeDrivers)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(75000);
    expect(byId.cc2.grossAmount).toBe(50000);
    expect(byId.cc3.grossAmount).toBe(40000);
    expect(sumOf(rows, "grossAmount")).toBe(165000);
  });

  it("blends multiple grades within one cost centre into a single weighted cost", async () => {
    // cc1: 2 heads @ 10,000/mo + 3 heads @ 20,000/mo = 20,000 + 60,000 = 80,000 blended cost.
    // cc2: 5 heads @ 10,000/mo = 50,000 blended cost. Pool 130,000 split 80,000/50,000.
    const gradeDrivers: FakeGradeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 2, min_ctc: 120000, max_ctc: 120000 },
      { cost_centre_id: "cc1", planned_headcount: 3, min_ctc: 240000, max_ctc: 240000 },
      { cost_centre_id: "cc2", planned_headcount: 5, min_ctc: 120000, max_ctc: 120000 },
    ];
    const rows = await computeLineAllocations(
      "branch-1", "2026-08", "grade_weighted_headcount",
      { baseAmount: 130000, taxAmount: 0, grossAmount: 130000, pnlCostAmount: 130000 },
      undefined,
      fakeExecutor(
        [
          { id: "cc1", cost_centre_code: "CC1", cost_centre_name: "Back Office" },
          { id: "cc2", cost_centre_code: "CC2", cost_centre_name: "Collections" },
        ],
        [], [], [], gradeDrivers
      )
    );
    const byId = Object.fromEntries(rows.map((r) => [r.costCentreId, r]));
    expect(byId.cc1.grossAmount).toBe(80000);
    expect(byId.cc2.grossAmount).toBe(50000);
  });

  it("rejects grade_weighted_headcount when a cost centre has no grade drivers for the period", async () => {
    const gradeDrivers: FakeGradeDriver[] = [
      { cost_centre_id: "cc1", planned_headcount: 7.5, min_ctc: 120000, max_ctc: 120000 },
      { cost_centre_id: "cc2", planned_headcount: 5, min_ctc: 120000, max_ctc: 120000 },
      // cc3 has no grade drivers at all
    ];
    await expect(
      computeLineAllocations(
        "branch-1", "2026-08", "grade_weighted_headcount", AMOUNTS, undefined,
        fakeExecutor(THREE_COST_CENTRES, [], [], [], gradeDrivers)
      )
    ).rejects.toThrow(/Grade-wise headcount data is missing.*Customer Support/);
  });
});
