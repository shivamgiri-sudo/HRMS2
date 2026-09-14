import { describe, expect, it } from "vitest";
import {
  getBranchMeterConsumption,
  getCostCentreMeterConsumption,
  saveReading,
} from "../meter.service.js";

interface FakeMeterMaster {
  id: string;
  fixed_rate: number;
  cost_centre_id: string;
  /** Added by migration 434. Defaulted in the fake so pre-434 fixtures read as dedicated
   *  electricity meters, exactly as the live table defaults them. */
  branch_id?: string;
  meter_type?: "dedicated" | "shared";
  utility_type?: "electricity" | "diesel" | "water" | "gas" | "other";
  parent_meter_id?: string | null;
  share_rule?: "fixed_pct" | "headcount" | "seats" | "floor_area" | "sub_meter_remainder" | null;
}

interface FakeShare { meter_id: string; cost_centre_id: string; share_pct: number; }
interface FakeDriver {
  cost_centre_id: string;
  planned_headcount?: number;
  seat_count?: number;
  floor_area_sqft?: number;
}

interface StoredReading {
  id: string;
  meter_id: string;
  period_code: string;
  opening_reading: number;
  closing_reading: number;
  consumption: number;
  rate: number;
  amount: number;
  reading_type: "actual" | "estimated";
  estimation_method: string | null;
  estimation_reason: string | null;
  reconciliation_status: "pending" | "reconciled";
}

function fakeExecutor(
  meters: FakeMeterMaster[],
  readings: StoredReading[] = [],
  shares: FakeShare[] = [],
  drivers: FakeDriver[] = []
) {
  let nextId = 1;
  const DEFAULT_BRANCH = "br1";
  const full = (m: FakeMeterMaster) => ({
    ...m,
    branch_id: m.branch_id ?? DEFAULT_BRANCH,
    meter_type: m.meter_type ?? "dedicated",
    utility_type: m.utility_type ?? "electricity",
    parent_meter_id: m.parent_meter_id ?? null,
    share_rule: m.share_rule ?? null,
  });
  return {
    readings,
    async execute(sql: string, params?: unknown[]) {
      if (sql.includes("SELECT id, fixed_rate FROM finance_meter_master")) {
        const meter = meters.find((m) => m.id === params?.[0]);
        return [meter ? [meter] : [], []];
      }
      if (sql.includes("SELECT branch_id FROM finance_meter_master")) {
        const m = meters.find((x) => x.cost_centre_id === params?.[0]);
        return [m ? [{ branch_id: full(m).branch_id }] : [], []];
      }
      if (sql.includes("SELECT branch_id FROM cost_centre_master")) {
        // Every cost centre in these fixtures belongs to the one fake branch.
        return [[{ branch_id: DEFAULT_BRANCH }], []];
      }
      if (sql.includes("FROM finance_meter_master") && sql.includes("WHERE branch_id = ?")) {
        const [branchId, utility] = params as [string, string | undefined];
        return [meters.map(full).filter((m) =>
          m.branch_id === branchId && (utility === undefined || m.utility_type === utility)), []];
      }
      if (sql.includes("FROM finance_meter_cost_centre_share")) {
        return [shares.filter((s) => s.meter_id === params?.[0]), []];
      }
      if (sql.includes("FROM finance_cost_centre_monthly_driver")) {
        const column = /seat_count AS weight/.test(sql) ? "seat_count"
          : /floor_area_sqft AS weight/.test(sql) ? "floor_area_sqft" : "planned_headcount";
        return [drivers.map((d) => ({
          cost_centre_id: d.cost_centre_id,
          weight: (d as Record<string, number | undefined>)[column] ?? 0,
        })), []];
      }
      if (sql.includes("SELECT id FROM finance_meter_master")) {
        const costCentreId = params?.[0];
        return [meters.filter((m) => m.cost_centre_id === costCentreId), []];
      }
      if (sql.startsWith("INSERT INTO finance_meter_reading")) {
        const [id, meterId, periodCode, opening, closing, rate, readingType, estimationMethod, estimationReason] =
          params as [string, string, string, number, number, number, "actual" | "estimated", string | null, string | null];
        const existingIndex = readings.findIndex(
          (r) => r.meter_id === meterId && r.period_code === periodCode && r.reading_type === readingType
        );
        const consumption = Math.round((closing - opening) * 10000) / 10000;
        const amount = Math.round(consumption * rate * 100) / 100;
        const row: StoredReading = {
          id: existingIndex >= 0 ? readings[existingIndex].id : id,
          meter_id: meterId,
          period_code: periodCode,
          opening_reading: opening,
          closing_reading: closing,
          consumption,
          rate,
          amount,
          reading_type: readingType,
          estimation_method: estimationMethod,
          estimation_reason: estimationReason,
          reconciliation_status: existingIndex >= 0 ? readings[existingIndex].reconciliation_status : "pending",
        };
        if (existingIndex >= 0) readings[existingIndex] = row;
        else readings.push(row);
        return [[], []];
      }
      if (sql.startsWith("SELECT * FROM finance_meter_reading")) {
        const [meterId, periodCode, readingType] = params as [string, string, "actual" | "estimated"];
        const row = readings.find(
          (r) => r.meter_id === meterId && r.period_code === periodCode && r.reading_type === readingType
        );
        return [row ? [row] : [], []];
      }
      if (sql.startsWith("INSERT INTO finance_meter_reconciliation")) {
        return [[], []];
      }
      if (sql.startsWith("UPDATE finance_meter_reading SET reconciliation_status")) {
        const [id] = params as [string];
        const row = readings.find((r) => r.id === id);
        if (row) row.reconciliation_status = "reconciled";
        return [[], []];
      }
      throw new Error(`fakeExecutor: unexpected query — ${sql} :: ${JSON.stringify(params)}`);
    },
  };
}

describe("meter.service — saveReading", () => {
  it("computes consumption and amount from opening/closing reading and the meter's fixed rate", async () => {
    const meters: FakeMeterMaster[] = [{ id: "m1", fixed_rate: 10, cost_centre_id: "cc1" }];
    const exec = fakeExecutor(meters);
    const { reading } = await saveReading(
      "m1", "2026-08",
      { openingReading: 1000, closingReading: 8500, readingType: "actual" },
      "user-1",
      exec as any
    );
    expect(reading.consumption).toBe(7500);
    expect(reading.amount).toBe(75000);
  });

  it("rejects a closing reading lower than the opening reading", async () => {
    const meters: FakeMeterMaster[] = [{ id: "m1", fixed_rate: 10, cost_centre_id: "cc1" }];
    await expect(
      saveReading("m1", "2026-08", { openingReading: 500, closingReading: 100, readingType: "actual" }, "user-1", fakeExecutor(meters) as any)
    ).rejects.toThrow(/cannot be less than/);
  });

  it("requires an estimation method and reason for an estimated reading", async () => {
    const meters: FakeMeterMaster[] = [{ id: "m1", fixed_rate: 10, cost_centre_id: "cc1" }];
    await expect(
      saveReading("m1", "2026-08", { openingReading: 0, closingReading: 100, readingType: "estimated" }, "user-1", fakeExecutor(meters) as any)
    ).rejects.toThrow(/[Ee]stimation method/);
  });

  it("creates a reconciliation record when an actual reading follows an approved estimated reading, without overwriting the estimate in place", async () => {
    const meters: FakeMeterMaster[] = [{ id: "m1", fixed_rate: 10, cost_centre_id: "cc1" }];
    const exec = fakeExecutor(meters);
    await saveReading(
      "m1", "2026-08",
      { openingReading: 0, closingReading: 6000, readingType: "estimated", estimationMethod: "Prior month average", estimationReason: "Meter faulty" },
      "user-1",
      exec as any
    );

    const { reading, reconciliation } = await saveReading(
      "m1", "2026-08",
      { openingReading: 0, closingReading: 7500, readingType: "actual" },
      "user-2",
      exec as any
    );

    expect(reconciliation).toBe(true);
    expect(reading.amount).toBe(75000);
    // Both rows coexist — the estimated reading is marked reconciled, not deleted/overwritten.
    expect(exec.readings).toHaveLength(2);
    const estimated = exec.readings.find((r) => r.reading_type === "estimated")!;
    expect(estimated.reconciliation_status).toBe("reconciled");
    expect(estimated.amount).toBe(60000);
  });

  it("does not create a duplicate reconciliation record on a second actual save once already reconciled", async () => {
    const meters: FakeMeterMaster[] = [{ id: "m1", fixed_rate: 10, cost_centre_id: "cc1" }];
    const exec = fakeExecutor(meters);
    await saveReading(
      "m1", "2026-08",
      { openingReading: 0, closingReading: 6000, readingType: "estimated", estimationMethod: "Prior month average", estimationReason: "Meter faulty" },
      "user-1",
      exec as any
    );
    await saveReading("m1", "2026-08", { openingReading: 0, closingReading: 7500, readingType: "actual" }, "user-2", exec as any);
    const { reconciliation } = await saveReading(
      "m1", "2026-08",
      { openingReading: 0, closingReading: 7600, readingType: "actual" },
      "user-2",
      exec as any
    );
    expect(reconciliation).toBe(false);
  });
});

describe("meter.service — getCostCentreMeterConsumption", () => {
  it("sums consumption/amount across multiple meters for a cost centre", async () => {
    const meters: FakeMeterMaster[] = [
      { id: "m1", fixed_rate: 10, cost_centre_id: "cc1" },
      { id: "m2", fixed_rate: 5, cost_centre_id: "cc1" },
    ];
    const exec = fakeExecutor(meters);
    await saveReading("m1", "2026-08", { openingReading: 0, closingReading: 100, readingType: "actual" }, "user-1", exec as any);
    await saveReading("m2", "2026-08", { openingReading: 0, closingReading: 200, readingType: "actual" }, "user-1", exec as any);

    const result = await getCostCentreMeterConsumption("cc1", "2026-08", exec as any);
    expect(result).not.toBeNull();
    expect(result!.consumption).toBe(300); // 100 + 200
    expect(result!.amount).toBe(2000); // (100*10) + (200*5)
  });

  it("returns null when the cost centre has meters but none has any reading yet", async () => {
    const meters: FakeMeterMaster[] = [{ id: "m1", fixed_rate: 10, cost_centre_id: "cc1" }];
    const result = await getCostCentreMeterConsumption("cc1", "2026-08", fakeExecutor(meters) as any);
    expect(result).toBeNull();
  });

  it("returns null when the cost centre has no meters at all", async () => {
    const result = await getCostCentreMeterConsumption("cc-nonexistent", "2026-08", fakeExecutor([]) as any);
    expect(result).toBeNull();
  });
});

// Migration 434. Before it, finance_meter_master.cost_centre_id was scalar and NOT NULL, so a
// meter feeding several processes could not be represented at all and its whole consumption was
// charged to whichever single cost centre it named.
describe("meter.service — shared meters", () => {
  const read = async (exec: unknown, meterId: string, closing: number) =>
    saveReading(meterId, "2026-08", { openingReading: 0, closingReading: closing, readingType: "actual" },
      "user-1", exec as any);

  it("gives a dedicated meter's whole consumption to its own cost centre", async () => {
    const exec = fakeExecutor([{ id: "m1", fixed_rate: 10, cost_centre_id: "cc1", meter_type: "dedicated" }]);
    await read(exec, "m1", 100);
    const byCc = await getBranchMeterConsumption("br1", "2026-08", exec as any);
    expect(byCc.get("cc1")).toEqual({ consumption: 100, amount: 1000 });
    expect(byCc.size).toBe(1);
  });

  it("splits a shared meter by its fixed percentages", async () => {
    const exec = fakeExecutor(
      [{ id: "m1", fixed_rate: 10, cost_centre_id: "cc1", meter_type: "shared", share_rule: "fixed_pct" }],
      [],
      [
        { meter_id: "m1", cost_centre_id: "cc1", share_pct: 50 },
        { meter_id: "m1", cost_centre_id: "cc2", share_pct: 30 },
        { meter_id: "m1", cost_centre_id: "cc3", share_pct: 20 },
      ]
    );
    await read(exec, "m1", 1000);
    const byCc = await getBranchMeterConsumption("br1", "2026-08", exec as any);
    expect(byCc.get("cc1")!.consumption).toBe(500);
    expect(byCc.get("cc2")!.consumption).toBe(300);
    expect(byCc.get("cc3")!.consumption).toBe(200);
    // Money follows the same proportion and the parts still add back to the whole.
    const totalAmount = [...byCc.values()].reduce((a, u) => a + u.amount, 0);
    expect(totalAmount).toBeCloseTo(10000, 2);
  });

  it("splits a shared meter by planned headcount when that is its rule", async () => {
    const exec = fakeExecutor(
      [{ id: "m1", fixed_rate: 1, cost_centre_id: "cc1", meter_type: "shared", share_rule: "headcount" }],
      [], [],
      [{ cost_centre_id: "cc1", planned_headcount: 300 }, { cost_centre_id: "cc2", planned_headcount: 100 }]
    );
    await read(exec, "m1", 800);
    const byCc = await getBranchMeterConsumption("br1", "2026-08", exec as any);
    expect(byCc.get("cc1")!.consumption).toBe(600); // 300/400
    expect(byCc.get("cc2")!.consumption).toBe(200); // 100/400
  });

  it("charges sub-meters their actuals and shares only the remainder", async () => {
    // A main meter reading 1000, with two sub-meters accounting for 600 of it. The leftover 400
    // belongs to the cost centres that are NOT separately metered.
    const exec = fakeExecutor(
      [
        { id: "main", fixed_rate: 10, cost_centre_id: "cc1", meter_type: "shared", share_rule: "sub_meter_remainder" },
        { id: "sub1", fixed_rate: 10, cost_centre_id: "cc1", parent_meter_id: "main" },
        { id: "sub2", fixed_rate: 10, cost_centre_id: "cc2", parent_meter_id: "main" },
      ],
      [], [],
      [
        { cost_centre_id: "cc1", planned_headcount: 300 },
        { cost_centre_id: "cc2", planned_headcount: 100 },
        { cost_centre_id: "cc3", planned_headcount: 50 },
        { cost_centre_id: "cc4", planned_headcount: 50 },
      ]
    );
    await read(exec, "main", 1000);
    await read(exec, "sub1", 400);
    await read(exec, "sub2", 200);

    const byCc = await getBranchMeterConsumption("br1", "2026-08", exec as any);
    // cc1 and cc2 keep their own sub-metered actuals and take no part of the remainder.
    expect(byCc.get("cc1")!.consumption).toBe(400);
    expect(byCc.get("cc2")!.consumption).toBe(200);
    // The unmetered pair split the 400 remainder 50/50 on equal headcount.
    expect(byCc.get("cc3")!.consumption).toBe(200);
    expect(byCc.get("cc4")!.consumption).toBe(200);
    // Nothing invented, nothing lost.
    expect([...byCc.values()].reduce((a, u) => a + u.consumption, 0)).toBe(1000);
  });

  it("never adds unlike units together", async () => {
    // A kWh meter and a litre meter on the same cost centre. Summing them would produce 5300 of
    // nothing; a utility-scoped query must see only its own kind.
    const exec = fakeExecutor([
      { id: "elec", fixed_rate: 8, cost_centre_id: "cc1", utility_type: "electricity" },
      { id: "dg",   fixed_rate: 90, cost_centre_id: "cc1", utility_type: "diesel" },
    ]);
    await read(exec, "elec", 5000);
    await read(exec, "dg", 300);

    const kwh = await getBranchMeterConsumption("br1", "2026-08", exec as any, "electricity");
    const litres = await getBranchMeterConsumption("br1", "2026-08", exec as any, "diesel");
    expect(kwh.get("cc1")!.consumption).toBe(5000);
    expect(litres.get("cc1")!.consumption).toBe(300);
    // Unscoped still totals everything, preserving the pre-434 behaviour for existing callers.
    const all = await getBranchMeterConsumption("br1", "2026-08", exec as any);
    expect(all.get("cc1")!.consumption).toBe(5300);
  });

  it("attributes a shared meter to its owner when there is nothing to apportion by", async () => {
    const exec = fakeExecutor(
      [{ id: "m1", fixed_rate: 10, cost_centre_id: "cc1", meter_type: "shared", share_rule: "headcount" }],
      [], [], [] // no drivers at all
    );
    await read(exec, "m1", 100);
    const byCc = await getBranchMeterConsumption("br1", "2026-08", exec as any);
    expect(byCc.get("cc1")!.consumption).toBe(100);
  });
});
