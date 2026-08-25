import { describe, expect, it, vi } from "vitest";
import type { DashboardScope } from "../../../shared/dashboardScope.js";

/**
 * Drilldown handlers for the employee performance scorecard's per-metric tiles.
 * These read from employee_performance_daily_snapshot (Task 1's new table) and require
 * employeeId/dateFrom/dateTo filters — there is no branch/process rollup for these,
 * only a single employee's own record range.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { drillAttendanceStatus, drillPipStatus } from "../performance-scorecard-drilldown.js";

describe("drillAttendanceStatus", () => {
  it("returns one record per snapshot day with attendanceStatus and lateByMinutes", async () => {
    execute.mockReset();
    execute.mockResolvedValue([
      [
        {
          employeeCode: "E100",
          employeeName: "Test User",
          snapshotDate: "2026-08-24",
          attendanceStatus: "present",
          lateByMinutes: 5,
        },
      ],
      [],
    ]);

    const result = await drillAttendanceStatus(
      {} as any,
      { employeeId: "emp-1", dateFrom: "2026-08-01", dateTo: "2026-08-24" },
    );

    expect(result.metricCode).toBe("ATTENDANCE_STATUS");
    expect(result.records).toHaveLength(1);
    expect((result.records[0] as any).attendanceStatus).toBe("present");
  });

  it("throws a 400-flagged error when employeeId, dateFrom, or dateTo is missing", async () => {
    execute.mockReset();
    await expect(
      drillAttendanceStatus({} as any, { employeeId: "emp-1" }),
    ).rejects.toThrow();
  });
});

/**
 * CRITICAL fix: the handlers used to accept `_scope: unknown` and never applied it to
 * the query, so any of the 16 entitled roles could read an arbitrary employeeId's full
 * performance/PIP history regardless of reporting relationship. These prove the caller's
 * real scope is now folded into the SQL — a TEAM_ONLY manager whose team is
 * ["emp-in-team"] cannot read a snapshot/PIP row for an employee outside that team, even
 * though the requested employeeId is otherwise well-formed.
 *
 * The mock below stands in for the DB by actually applying the scope predicate embedded
 * in the generated SQL/params, the way MySQL would — rather than unconditionally
 * returning canned rows regardless of what was asked, which would prove nothing about
 * enforcement.
 */
describe("performance-scorecard-drilldown authorization", () => {
  const teamScope: DashboardScope = {
    level: "TEAM_ONLY",
    branchIds: [],
    processIds: [],
    employeeIds: ["emp-in-team"],
    userId: "manager-1",
    role: "manager",
  };

  function fakeScopedExecute(row: Record<string, unknown>) {
    return async (sql: string, params: unknown[]) => {
      const [employeeId, , , ...scopeParams] = params as string[];
      if (sql.includes("1=0")) return [[], []];
      if (sql.includes("e.id IN") && !scopeParams.includes(employeeId)) return [[], []];
      if (row.employeeId !== employeeId) return [[], []];
      return [[row], []];
    };
  }

  it("drillAttendanceStatus returns the row for an employee inside the caller's team", async () => {
    execute.mockReset();
    execute.mockImplementation(
      fakeScopedExecute({
        employeeId: "emp-in-team",
        employeeCode: "E100",
        employeeName: "In Team",
        snapshotDate: "2026-08-10",
        attendanceStatus: "present",
      }),
    );

    const result = await drillAttendanceStatus(teamScope, {
      employeeId: "emp-in-team",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-24",
    });

    expect(result.records).toHaveLength(1);
  });

  it("drillAttendanceStatus returns no rows for an employeeId outside the caller's team", async () => {
    execute.mockReset();
    execute.mockImplementation(
      fakeScopedExecute({
        employeeId: "emp-other-team",
        employeeCode: "E200",
        employeeName: "Other Team",
        snapshotDate: "2026-08-10",
        attendanceStatus: "present",
      }),
    );

    const result = await drillAttendanceStatus(teamScope, {
      employeeId: "emp-other-team",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-24",
    });

    expect(result.records).toHaveLength(0);
    // The SQL sent to the DB must carry the scope predicate — confirms the fix wires the
    // real scope into the query rather than trusting the caller-supplied employeeId alone.
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("e.id IN");
    expect(params).toContain("emp-in-team");
    expect(params).not.toContain("emp-other-team-should-not-appear-in-scope-params");
  });

  it("drillPipStatus (a differently-shaped query with no employees join previously) also enforces scope", async () => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string, params: unknown[]) => {
      const [employeeId, ...scopeParams] = params as string[];
      if (sql.includes("1=0")) return [[], []];
      if (sql.includes("e.id IN") && !scopeParams.includes(employeeId)) return [[], []];
      return [[{ status: "active", start_date: "2026-01-01" }], []];
    });

    const blocked = await drillPipStatus(teamScope, {
      employeeId: "emp-other-team",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-24",
    });
    expect(blocked.records).toHaveLength(0);

    execute.mockReset();
    execute.mockImplementation(async (sql: string, params: unknown[]) => {
      const [employeeId, ...scopeParams] = params as string[];
      if (sql.includes("1=0")) return [[], []];
      if (sql.includes("e.id IN") && !scopeParams.includes(employeeId)) return [[], []];
      return [[{ status: "active", start_date: "2026-01-01" }], []];
    });
    const allowed = await drillPipStatus(teamScope, {
      employeeId: "emp-in-team",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-24",
    });
    expect(allowed.records).toHaveLength(1);
  });

  it("an ORG_ALL scope (e.g. hr/ceo) can still reach any employeeId", async () => {
    const orgScope: DashboardScope = {
      level: "ORG_ALL",
      branchIds: [],
      processIds: [],
      employeeIds: [],
      userId: "hr-1",
      role: "hr",
    };
    execute.mockReset();
    execute.mockImplementation(
      fakeScopedExecute({
        employeeId: "emp-anywhere",
        employeeCode: "E300",
        employeeName: "Anywhere",
        snapshotDate: "2026-08-10",
        attendanceStatus: "present",
      }),
    );

    const result = await drillAttendanceStatus(orgScope, {
      employeeId: "emp-anywhere",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-24",
    });

    expect(result.records).toHaveLength(1);
  });
});
