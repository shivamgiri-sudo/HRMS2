import { describe, expect, it } from "vitest";
import { getCostCentreGradeWeightedCost } from "../grade-engine.service.js";

interface FakeGradeDriverRow {
  cost_centre_id: string;
  period_code: string;
  planned_headcount: number;
  min_ctc: number;
  max_ctc: number;
}

function fakeExecutor(rows: FakeGradeDriverRow[]) {
  return {
    async execute(sql: string, params?: unknown[]) {
      if (sql.includes("FROM finance_cost_centre_grade_driver")) {
        const [costCentreId, periodCode] = params as [string, string];
        return [
          rows.filter((r) => r.cost_centre_id === costCentreId && r.period_code === periodCode && r.planned_headcount > 0),
          [],
        ];
      }
      throw new Error(`fakeExecutor: unexpected query — ${sql}`);
    },
  } as any;
}

describe("getCostCentreGradeWeightedCost", () => {
  it("computes blended monthly cost from a single grade's midpoint CTC", async () => {
    const rows: FakeGradeDriverRow[] = [
      { cost_centre_id: "cc1", period_code: "2026-08", planned_headcount: 5, min_ctc: 120000, max_ctc: 120000 },
    ];
    const result = await getCostCentreGradeWeightedCost("cc1", "2026-08", fakeExecutor(rows));
    expect(result).toEqual({ totalHeadcount: 5, blendedMonthlyCost: 50000 }); // 120000/12 = 10000/head * 5
  });

  it("uses the (min+max)/2 midpoint when min and max CTC differ", async () => {
    const rows: FakeGradeDriverRow[] = [
      { cost_centre_id: "cc1", period_code: "2026-08", planned_headcount: 1, min_ctc: 300000, max_ctc: 500000 },
    ];
    const result = await getCostCentreGradeWeightedCost("cc1", "2026-08", fakeExecutor(rows));
    // midpoint = 400000/yr = 33333.33/mo
    expect(result?.blendedMonthlyCost).toBe(33333.33);
  });

  it("sums across multiple grades within the same cost centre", async () => {
    const rows: FakeGradeDriverRow[] = [
      { cost_centre_id: "cc1", period_code: "2026-08", planned_headcount: 2, min_ctc: 120000, max_ctc: 120000 }, // 2*10000=20000
      { cost_centre_id: "cc1", period_code: "2026-08", planned_headcount: 3, min_ctc: 240000, max_ctc: 240000 }, // 3*20000=60000
    ];
    const result = await getCostCentreGradeWeightedCost("cc1", "2026-08", fakeExecutor(rows));
    expect(result).toEqual({ totalHeadcount: 5, blendedMonthlyCost: 80000 });
  });

  it("returns null (not zero) when the cost centre has no grade drivers for the period", async () => {
    const result = await getCostCentreGradeWeightedCost("cc-empty", "2026-08", fakeExecutor([]));
    expect(result).toBeNull();
  });

  it("only considers the requested period, ignoring drivers from other periods", async () => {
    const rows: FakeGradeDriverRow[] = [
      { cost_centre_id: "cc1", period_code: "2026-07", planned_headcount: 5, min_ctc: 120000, max_ctc: 120000 },
    ];
    const result = await getCostCentreGradeWeightedCost("cc1", "2026-08", fakeExecutor(rows));
    expect(result).toBeNull();
  });
});
