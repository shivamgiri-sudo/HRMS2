import { describe, expect, it, vi } from "vitest";

/**
 * A manager's home dashboard resolves to scope level TEAM_ONLY. The Headcount tile
 * itself is scoped correctly via buildScopeWhereEmployees (e.id IN (...team...)), but
 * its drilldown built its WHERE clause with the sibling buildScopeWhere() instead —
 * which has no case for TEAM_ONLY or SELF_ONLY and falls back to `1=0`. The drawer
 * behind a real manager's "Team Members" tile therefore always reported 0 records,
 * regardless of team size — reproduced live against a real manager (2 direct reports)
 * before this fix. drillAttendance had the identical defect.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { getDrilldown } from "../dashboard-drilldown.service.js";
import type { DashboardScope } from "../../../shared/dashboardScope.js";

const teamScope: DashboardScope = {
  level: "TEAM_ONLY",
  branchIds: [],
  processIds: [],
  employeeIds: ["emp-report-1", "emp-report-2"],
  userId: "manager-1",
  role: "manager",
};

describe("dashboard drilldowns respect TEAM_ONLY scope", () => {
  it("drillHeadcount scopes by the manager's resolved team, not 1=0", async () => {
    execute.mockReset();
    execute.mockResolvedValue([
      [{ branchId: "branch-1", branchName: "NOIDA", count: 2 }],
      [],
    ]);

    const result = await getDrilldown("HEADCOUNT", teamScope, {});

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("e.id IN");
    expect(sql).not.toContain("1=0");
    expect(params).toEqual(["emp-report-1", "emp-report-2"]);
    expect(result.records).toHaveLength(1);
    expect(result.totalCount).toBe(2);
  });

  it("drillAttendance scopes by the manager's resolved team, not 1=0", async () => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("AS record_date")) return [[{ record_date: "2026-08-11" }], []];
      return [[], []];
    });

    await getDrilldown("ATTENDANCE", teamScope, {});

    const mainQueryCall = execute.mock.calls.find(([sql]) => sql.includes("attendance_daily_record a"));
    expect(mainQueryCall).toBeDefined();
    const [sql, params] = mainQueryCall as [string, unknown[]];
    expect(sql).toContain("e.id IN");
    expect(sql).not.toContain("1=0");
    expect(params).toEqual(["2026-08-11", "emp-report-1", "emp-report-2"]);
  });

  it("still fails closed to 1=0 when a team/self scope has no resolved employees", async () => {
    execute.mockReset();
    execute.mockResolvedValue([[], []]);
    const empty: DashboardScope = { ...teamScope, employeeIds: [] };

    await getDrilldown("HEADCOUNT", empty, {});

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("1=0");
    expect(params).toEqual([]);
  });
});
