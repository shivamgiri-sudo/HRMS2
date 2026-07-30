import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardScope } from "../../../shared/dashboardScope.js";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../dashboard-target.service.js", () => ({
  enrichMetric: vi.fn().mockResolvedValue({
    previousValue: null,
    target: null,
    variance: null,
    variancePct: null,
    trend: null,
    status: "unknown",
  }),
}));

import { getAttendanceMetrics } from "../dashboard-metric.service.js";

const scope: DashboardScope = {
  level: "BRANCH_ALL",
  branchIds: ["branch-1"],
  processIds: [],
  employeeIds: [],
  userId: "user-1",
  role: "branch_hr",
};

describe("dashboard metric calculations", () => {
  beforeEach(() => execute.mockReset());

  // Query order: live session count, anchor date, then the processed breakdown.
  // The breakdown now carries expected_to_work and attended_days inline rather than
  // issuing a separate denominator query.
  const mockAttendance = (breakdown: Record<string, unknown>, livePresent = 8) => {
    execute
      .mockResolvedValueOnce([[{ live_present: livePresent }]])
      .mockResolvedValueOnce([[{ record_date: "2026-07-29" }]])
      .mockResolvedValueOnce([[breakdown]]);
  };

  it("does not mix live biometric present count with processed attendance denominator", async () => {
    mockAttendance({
      present: 5, halfDay: 0, absent: 5, late: 0, missedPunch: 0, onLeave: 0,
      attended_days: 5, expected_to_work: 10, total: 10,
    });

    const metric = await getAttendanceMetrics(scope);

    expect(metric.value).toBe(50);
    expect(metric.detail.present).toBe(5);
    expect(metric.detail.livePresent).toBe(8);
    expect(metric.detail.expectedToWork).toBe(10);
  });

  it("counts a half day as half a day, matching the employee self dashboard", async () => {
    // 5 full + 2 half = 6 attended of 10 expected. Half days were previously ignored
    // entirely by the org-wide metric, so the same employee saw two different figures.
    mockAttendance({
      present: 5, halfDay: 2, absent: 3, late: 1, missedPunch: 0, onLeave: 0,
      attended_days: 6, expected_to_work: 10, total: 10,
    });

    const metric = await getAttendanceMetrics(scope);

    expect(metric.value).toBe(60);
    expect(metric.detail.halfDay).toBe(2);
  });

  it("reports lateness from late_mark rather than a non-existent status", async () => {
    mockAttendance({
      present: 8, halfDay: 0, absent: 2, late: 4, missedPunch: 0, onLeave: 0,
      attended_days: 8, expected_to_work: 10, total: 10,
    });

    const metric = await getAttendanceMetrics(scope);

    expect(metric.detail.late).toBe(4);
  });

  it("returns unavailable rather than zero when an attendance source query fails", async () => {
    execute.mockRejectedValueOnce(new Error("attendance source unavailable"));

    const metric = await getAttendanceMetrics(scope);

    expect(metric.value).toBeNull();
    expect(metric.status).toBe("unknown");
    expect(metric.errorCode).toBe("QUERY_FAILED");
  });

  it("reports unavailable when no attendance day is complete enough to anchor on", async () => {
    execute
      .mockResolvedValueOnce([[{ live_present: 0 }]])
      .mockResolvedValueOnce([[{ record_date: null }]]);

    const metric = await getAttendanceMetrics(scope);

    expect(metric.value).toBeNull();
  });
});
