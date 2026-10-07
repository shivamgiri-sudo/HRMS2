import { describe, expect, it, vi } from "vitest";

vi.mock("../canonical-pnl.service.js", () => ({
  getCachedAllocationSummary: vi.fn(),
  shiftPeriod: (p: string, d: number) => { const [y, m] = p.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1 + d, 1)); return x.toISOString().slice(0, 7); },
}));
import { periodsToWarm } from "../pnl-summary-warmer.js";

describe("P&L summary warmer", () => {
  it("warms last month and this month; next month too from the 20th (forecast season)", () => {
    expect(periodsToWarm(new Date(Date.UTC(2026, 9, 6)))).toEqual(["2026-09", "2026-10"]);
    expect(periodsToWarm(new Date(Date.UTC(2026, 9, 22)))).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(periodsToWarm(new Date(Date.UTC(2027, 0, 3)))).toEqual(["2026-12", "2027-01"]);
  });
});
