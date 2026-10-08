import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../shared/dashboardScope.js", () => ({
  resolveDashboardScope: vi.fn(async () => ({
    level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [], userId: "u", role: "admin",
  })),
}));

const { db } = await import("../../../db/mysql.js");
const { performanceGovernanceService } = await import("../performance-governance.service.js");

describe("referenceData", () => {
  it("fetches the four option lists concurrently and maps each result", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(db.execute).mockImplementation((async (sql: string) => {
      started.push(sql);
      if (started.length === 4) release();
      await gate; // only completes if all four were issued without awaiting each other
      if (sql.includes("FROM kpi_metric_master")) return [[{ id: "m1", metric_code: "Q", metric_name: "Quality" }], []];
      if (sql.includes("FROM process_master")) return [[{ id: "p1", process_name: "P" }], []];
      if (sql.includes("FROM branch_master")) return [[{ id: "b1", branch_name: "B" }], []];
      return [[{ id: "e1", employee_code: "MAS1", employee_name: "A" }], []];
    }) as never);

    const res = await performanceGovernanceService.referenceData("u", "");
    expect(started).toHaveLength(4);
    expect(res.employees[0]).toMatchObject({ id: "e1", employeeCode: "MAS1" });
    expect(res.processes).toEqual([{ id: "p1", name: "P" }]);
    expect(res.branches).toEqual([{ id: "b1", name: "B" }]);
    expect(res.metrics[0]).toMatchObject({ id: "m1", code: "Q", aggregation: "average" });
  });
});
