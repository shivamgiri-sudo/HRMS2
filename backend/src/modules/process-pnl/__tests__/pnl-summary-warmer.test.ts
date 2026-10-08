import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../canonical-pnl.service.js", () => ({
  refreshAllocationSummary: vi.fn(),
  shiftPeriod: (p: string, d: number) => { const [y, m] = p.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1 + d, 1)); return x.toISOString().slice(0, 7); },
}));
import { periodsToWarm, scopesToWarm } from "../pnl-summary-warmer.js";

describe("P&L summary warmer", () => {
  it("warms last month and this month; next month too from the 20th (forecast season)", () => {
    expect(periodsToWarm(new Date(Date.UTC(2026, 9, 6)))).toEqual(["2026-09", "2026-10"]);
    expect(periodsToWarm(new Date(Date.UTC(2026, 9, 22)))).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(periodsToWarm(new Date(Date.UTC(2027, 0, 3)))).toEqual(["2026-12", "2027-01"]);
  });

  it("warms the company scope and each branch in the exact shape a branch-confined user reads", () => {
    expect(scopesToWarm("2026-10", ["B1", "B2"])).toEqual([
      { period: "2026-10" },
      { period: "2026-10", branchId: "B1", branchIds: ["B1"] },
      { period: "2026-10", branchId: "B2", branchIds: ["B2"] },
    ]);
  });
});
