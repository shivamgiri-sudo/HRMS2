import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: m.execute },
  pool: { execute: m.execute },
}));
vi.mock("../../../utils/dateUtils.js", () => ({
  getIstDateString: () => "2026-12-15",
  getIstMonthStart: () => "2026-12-01",
}));

import { getRevenueAtRisk, monthRangeBounds } from "../bi.service.js";

describe("monthRangeBounds", () => {
  it("returns [first of month, first of next month)", () => {
    expect(monthRangeBounds(2026, 9)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(monthRangeBounds(2026, 12)).toEqual(["2026-12-01", "2027-01-01"]);
    expect(monthRangeBounds(2026, 1)).toEqual(["2026-01-01", "2026-02-01"]);
  });
});

describe("getRevenueAtRisk target month filter", () => {
  beforeEach(() => m.execute.mockReset());
  it("uses a sargable range on target_month, never YEAR()/MONTH()", async () => {
    m.execute.mockResolvedValue([
      [
        {
          total_target: 100,
          total_actual: 40,
          process: "p",
          target: 100,
          actual: 40,
        },
      ],
      [],
    ]);
    const r = await getRevenueAtRisk();
    expect(r.target).toBe(100);
    const sqls = m.execute.mock.calls.map((c) => String(c[0]));
    for (const q of sqls) expect(q).not.toMatch(/YEAR\(|MONTH\(/);
    const tq = m.execute.mock.calls.find(
      (c) =>
        String(c[0]).includes("bill_revenue_target_snapshot") &&
        !String(c[0]).includes("LEFT JOIN"),
    )!;
    expect(tq[1]).toEqual(["2026-12-01", "2027-01-01"]);
    const pq = m.execute.mock.calls.find((c) =>
      String(c[0]).includes("LEFT JOIN"),
    )!;
    expect(pq[1]).toEqual([
      "2026-12-01",
      "2026-12-15",
      "2026-12-01",
      "2027-01-01",
    ]);
  });
});
