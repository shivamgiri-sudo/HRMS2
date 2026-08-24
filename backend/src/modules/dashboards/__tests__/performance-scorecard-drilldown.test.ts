import { describe, expect, it, vi } from "vitest";

/**
 * Drilldown handlers for the employee performance scorecard's per-metric tiles.
 * These read from employee_performance_daily_snapshot (Task 1's new table) and require
 * employeeId/dateFrom/dateTo filters — there is no branch/process rollup for these,
 * only a single employee's own record range.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { drillAttendanceStatus } from "../performance-scorecard-drilldown.js";

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
