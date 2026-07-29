import { describe, expect, it } from "vitest";
import { getCostCentreMeterConsumption, saveReading } from "../meter.service.js";

interface FakeMeterMaster {
  id: string;
  fixed_rate: number;
  cost_centre_id: string;
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

function fakeExecutor(meters: FakeMeterMaster[], readings: StoredReading[] = []) {
  let nextId = 1;
  return {
    readings,
    async execute(sql: string, params?: unknown[]) {
      if (sql.includes("SELECT id, fixed_rate FROM finance_meter_master")) {
        const meter = meters.find((m) => m.id === params?.[0]);
        return [meter ? [meter] : [], []];
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
