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

  it("does not mix live biometric present count with processed attendance denominator", async () => {
    execute
      .mockResolvedValueOnce([[{ live_present: 8 }]])
      .mockResolvedValueOnce([[
        { present: 5, absent: 5, late: 0, missedPunch: 0, total: 10 },
      ]])
      .mockResolvedValueOnce([[{ expected_to_work: 10 }]]);

    const metric = await getAttendanceMetrics(scope);

    expect(metric.value).toBe(50);
    expect(metric.detail.present).toBe(5);
    expect(metric.detail.livePresent).toBe(8);
    expect(metric.detail.expectedToWork).toBe(10);
  });

  it("returns unavailable rather than zero when an attendance source query fails", async () => {
    execute.mockRejectedValueOnce(new Error("attendance source unavailable"));

    const metric = await getAttendanceMetrics(scope);

    expect(metric.value).toBeNull();
    expect(metric.status).toBe("unknown");
  });
});
