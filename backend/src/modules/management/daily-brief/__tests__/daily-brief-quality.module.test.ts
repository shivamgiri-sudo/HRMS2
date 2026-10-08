import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { querySource } = vi.hoisted(() => ({ querySource: vi.fn() }));
vi.mock("../../../../db/sourceDb.js", () => ({ querySource }));

import { buildQualityModule } from "../daily-brief-quality.module.js";

describe("daily-brief-quality.module", () => {
  beforeEach(() => {
    execute.mockReset();
    querySource.mockReset();
  });

  function mockEmployees() {
    execute.mockImplementation(async () => [[
      { id: "e1", employee_code: "MAS001", full_name: "Alice" },
      { id: "e2", employee_code: "MAS002", full_name: "Bob" },
    ]]);
  }

  it("below the reused MIN_SCORED_CALLS_FOR_SIGNAL floor yields INSUFFICIENT_SAMPLE, not a silent zero average", async () => {
    mockEmployees();
    querySource.mockImplementation(async (sql: string) => {
      if (sql.includes("CallDate >= ? AND CallDate < DATE_ADD")) {
        // D-1 window: only 2 scored calls total, below the floor of 3.
        return [{ User: "MAS001", score_sum: "160", scored_calls: 2 }];
      }
      return []; // baseline window
    });

    const result = await buildQualityModule(["e1", "e2"], "2026-08-18", "summary");

    expect(result.scoredCallCount).toBe(2);
    expect(result.avgQualityPct).toBe(80); // still computed and reported...
    const health = result.sourceHealth.find((h) => h.module === "quality");
    expect(health?.state).toBe("INSUFFICIENT_SAMPLE"); // ...but flagged, not silently AVAILABLE
    expect(health?.detail).toContain("scored call");
  });

  it("adequate sample (>= floor) yields AVAILABLE with a real average", async () => {
    mockEmployees();
    querySource.mockImplementation(async (sql: string) => {
      if (sql.includes("CallDate >= ? AND CallDate < DATE_ADD")) {
        return [
          { User: "MAS001", score_sum: "270", scored_calls: 3 },
          { User: "MAS002", score_sum: "90", scored_calls: 1 },
        ];
      }
      return [];
    });

    const result = await buildQualityModule(["e1", "e2"], "2026-08-18", "summary");
    expect(result.scoredCallCount).toBe(4);
    expect(result.avgQualityPct).toBe(90);
    const health = result.sourceHealth.find((h) => h.module === "quality");
    expect(health?.state).toBe("AVAILABLE");
  });

  it("a thrown db_audit query error yields sourceHealth = ERROR, not a silent zero", async () => {
    mockEmployees();
    querySource.mockImplementation(async () => {
      throw new Error("ER_ACCESS_DENIED: simulated upstream failure");
    });

    const result = await buildQualityModule(["e1"], "2026-08-18", "summary");
    const health = result.sourceHealth.find((h) => h.module === "quality");
    expect(health?.state).toBe("ERROR");
    expect(health?.detail).toContain("simulated upstream failure");
    expect(result.avgQualityPct).toBeNull();
    expect(result.scoredCallCount).toBe(0);
  });

  it("diagnostic detail level includes parameter fail rates; summary does not", async () => {
    mockEmployees();
    querySource.mockImplementation(async (sql: string) => {
      if (sql.includes("CallDate >= ? AND CallDate < DATE_ADD") && sql.includes("callopen_fail")) {
        return [{
          callopen_fail: 1, callopen_n: 4,
          prof_fail: 0, prof_n: 4,
          listen_fail: 2, listen_n: 4,
          closure_fail: 0, closure_n: 4,
          info_fail: 1, info_n: 4,
        }];
      }
      if (sql.includes("CallDate >= ? AND CallDate < DATE_ADD")) {
        return [{ User: "MAS001", score_sum: "320", scored_calls: 4 }];
      }
      return [];
    });

    const diagnostic = await buildQualityModule(["e1"], "2026-08-18", "diagnostic");
    expect(diagnostic.parameterFailRates).not.toBeNull();
    expect(diagnostic.parameterFailRates?.find((p) => p.parameter.includes("Active listening"))?.failRatePct).toBe(50);

    const summary = await buildQualityModule(["e1"], "2026-08-18", "summary");
    expect(summary.parameterFailRates).toBeNull();
  });

  it("empty team scope yields NOT_APPLICABLE without querying", async () => {
    const result = await buildQualityModule([], "2026-08-18", "summary");
    expect(result.sourceHealth[0].state).toBe("NOT_APPLICABLE");
    expect(execute).not.toHaveBeenCalled();
    expect(querySource).not.toHaveBeenCalled();
  });
});
