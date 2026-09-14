import { describe, it, expect, vi, beforeEach } from "vitest";

const exec = vi.fn();
vi.mock("../src/db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => exec(...args) },
  pingDb: vi.fn(),
}));

import { leavePolicyService } from "../src/modules/leave/leave-policy.service.js";

beforeEach(() => {
  exec.mockReset();
});

// ── 2026-08-13 policy sign-off: #14 ─────────────────────────────────────────
describe("leavePolicyService.checkELOccurrences", () => {
  it("counts by which calendar year(s) the new request's dates fall in, not just from_date's year", async () => {
    // A Dec-2026/Jan-2027-spanning request should check BOTH years, not just
    // 2026 (from_date's year). Simulate: employee already has 2 EL requests
    // touching 2027 (so 2027 would become a 3rd occurrence), 0 in 2026.
    exec.mockImplementation((sql: string, params: unknown[]) => {
      const year = String(params[1]).slice(0, 4);
      if (year === "2027") return Promise.resolve([[{ cnt: 2 }], []]);
      return Promise.resolve([[{ cnt: 0 }], []]);
    });

    const result = await leavePolicyService.checkELOccurrences("emp-1", "2026-12-30", "2027-01-02");

    expect(result.isException).toBe(true);
    expect(exec).toHaveBeenCalledTimes(2); // once per year touched (2026, 2027)
  });

  it("does not flag an exception when neither touched year has reached 2 prior occurrences", async () => {
    exec.mockResolvedValue([[{ cnt: 1 }], []]);
    const result = await leavePolicyService.checkELOccurrences("emp-1", "2026-06-01", "2026-06-05");
    expect(result.isException).toBe(false);
  });

  it("single-year request checks only that one year", async () => {
    exec.mockResolvedValue([[{ cnt: 0 }], []]);
    await leavePolicyService.checkELOccurrences("emp-1", "2026-06-01", "2026-06-05");
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
