import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardScope } from "../../../shared/dashboardScope.js";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute },
}));

import { performanceIntelligenceRepository } from "../performance-intelligence.repository.js";

function teamScope(): DashboardScope {
  return {
    level: "TEAM_ONLY",
    branchIds: [],
    processIds: [],
    userId: "tl-user",
    role: "team_leader",
  };
}

describe("performanceIntelligenceRepository", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("checks employee access using the canonical employee scope predicate", async () => {
    execute.mockResolvedValueOnce([[{ id: "employee-1" }]]);

    const allowed = await performanceIntelligenceRepository.canAccessEmployee(
      teamScope(),
      "employee-1",
    );

    expect(allowed).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("reporting_manager_id"),
      ["employee-1", "tl-user", "tl-user"],
    );
  });

  it("uses placeholders for requested employee and date bounds", async () => {
    execute.mockResolvedValueOnce([[]]);

    await performanceIntelligenceRepository.listMetricFacts(
      teamScope(),
      {
        from: "2026-07-01",
        to: "2026-07-18",
        employeeId: "employee-1",
        page: 1,
        pageSize: 25,
      },
      "employee-1",
    );

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("kda.score_date BETWEEN ? AND ?");
    expect(sql).toContain("e.id IN (?)");
    expect(sql).not.toContain("employee-1");
    expect(params).toEqual(expect.arrayContaining([
      "tl-user",
      "2026-07-01",
      "2026-07-18",
      "employee-1",
    ]));
  });
});
