import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

import { buildRosterModule, classifyShortageSeverity } from "../daily-brief-roster.module.js";

describe("daily-brief-roster: shortage severity thresholds", () => {
  it("matches the exact thresholds reused from business-actions.signal-sync.ts's syncRosterShortages", () => {
    // Verified live: shortage > 10 => critical, shortage > 5 => high, else medium.
    expect(classifyShortageSeverity(11)).toBe("critical");
    expect(classifyShortageSeverity(10)).toBe("high"); // boundary: not > 10
    expect(classifyShortageSeverity(6)).toBe("high");
    expect(classifyShortageSeverity(5)).toBe("medium"); // boundary: not > 5
    expect(classifyShortageSeverity(1)).toBe("medium");
  });
});

describe("daily-brief-roster: buildRosterModule", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("returns NOT_APPLICABLE when no process/branch scope is supplied", async () => {
    const result = await buildRosterModule({}, "2026-08-18");
    expect(result.lookingAhead).toEqual([]);
    expect(result.pendingAcknowledgement).toBeNull();
    for (const health of result.sourceHealth) {
      expect(health.state).toBe("NOT_APPLICABLE");
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("computes worst severity from the largest single-slot shortage in scope", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM wfm_slot_requirement")) {
        return [[
          { requirement_date: "2026-08-19", process_id: "p1", process_name: "Voice", required_hc: 20, scheduled_hc: 8, coverage_delta: -12 }, // shortage 12 -> critical
          { requirement_date: "2026-08-20", process_id: "p1", process_name: "Voice", required_hc: 10, scheduled_hc: 9, coverage_delta: -1 },  // shortage 1 -> medium
        ]];
      }
      if (sql.includes("FROM wfm_roster_assignment")) {
        return [[{ pending_count: 3, rejected_count: 1 }]];
      }
      return [[]];
    });

    const result = await buildRosterModule({ processIds: ["p1"] }, "2026-08-18");

    expect(result.worstSeverity).toBe("critical");
    expect(result.uncoveredHc.value).toBe(13); // 12 + 1
    expect(result.pendingAcknowledgement?.value).toBe(3);
    expect(result.pendingRejectedByEmployee?.value).toBe(1);
    expect(result.sourceHealth.find((h) => h.module === "roster_forecast")?.state).toBe("AVAILABLE");
  });

  it("a thrown roster query error yields sourceHealth = ERROR, not a silent zero", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM wfm_slot_requirement")) {
        throw new Error("ER_NO_SUCH_TABLE: simulated failure");
      }
      return [[{ pending_count: 0, rejected_count: 0 }]];
    });

    const result = await buildRosterModule({ branchIds: ["b1"] }, "2026-08-18");

    const forecastHealth = result.sourceHealth.find((h) => h.module === "roster_forecast");
    expect(forecastHealth?.state).toBe("ERROR");
    expect(forecastHealth?.detail).toContain("simulated failure");
    expect(result.lookingAhead).toEqual([]);
    expect(result.uncoveredHc.value).toBe(0);
  });
});
