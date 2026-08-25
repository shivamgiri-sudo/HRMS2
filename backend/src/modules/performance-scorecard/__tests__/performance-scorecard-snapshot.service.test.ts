import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mocks.execute } }));

const mockListSnapshots = vi.hoisted(() => vi.fn());
const mockGetDashboardSummary = vi.hoisted(() => vi.fn());
const mockGetStatement = vi.hoisted(() => vi.fn());

vi.mock("../../rta/rta.service.js", () => ({
  shrinkageService: { listSnapshots: mockListSnapshots },
}));
vi.mock("../../management/management.service.js", () => ({
  managementService: { getDashboardSummary: mockGetDashboardSummary },
}));
vi.mock("../../process-pnl/pnl-statement.service.js", () => ({
  getStatement: mockGetStatement,
}));

import {
  computeEmployeeSnapshot,
  writeEmployeePerformanceSnapshots,
} from "../performance-scorecard-snapshot.service.js";

describe("computeEmployeeSnapshot", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mockListSnapshots.mockReset();
    mockGetDashboardSummary.mockReset();
    mockGetStatement.mockReset();
  });

  it("marks unplanned_leave_flag true when attendance_status is missing_punch", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ attendance_status: "missing_punch", late_by_minutes: 0 }]]) // attendance
      .mockResolvedValueOnce([[]]) // active pip
      .mockResolvedValueOnce([[{ overall_score: 82.5 }]]) // quality
      .mockResolvedValueOnce([[{ designation_id: "desig-1" }]]) // employee designation
      .mockResolvedValueOnce([[{ has_reports: 0 }]]); // manager-tier check

    const result = await computeEmployeeSnapshot("emp-1", "2026-08-24");

    expect(result.unplannedLeaveFlag).toBe(true);
    expect(result.pipStatus).toBe("none");
    expect(result.qualityScore).toBe(82.5);
  });

  it("binds the snapshot date (not today) into the PIP-active query, for historical correctness", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]]) // attendance
      .mockResolvedValueOnce([[{ status: "active", rating: "on_track" }]]) // active pip
      .mockResolvedValueOnce([[{ overall_score: 90 }]]) // quality
      .mockResolvedValueOnce([[{ designation_id: "desig-1" }]]) // employee designation
      .mockResolvedValueOnce([[{ has_reports: 0 }]]); // manager-tier check

    await computeEmployeeSnapshot("emp-1", "2026-01-15");

    const [pipSql, pipParams] = mocks.execute.mock.calls[1];
    expect(pipSql).not.toContain("pr.status = 'active'");
    expect(pipSql).toContain("pr.start_date <=");
    expect(pipSql).toContain("pr.end_date");
    expect(pipSql).toContain("pc.checkpoint_date <=");
    // date param must be bound, not the literal string 'active', and must be the
    // snapshot date passed in — not the current date.
    expect(pipParams).toContain("2026-01-15");
    expect(pipParams).not.toContain("active");
  });

  it("populates real rollup metrics for an employee with direct reports", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]]) // attendance
      .mockResolvedValueOnce([[]]) // active pip
      .mockResolvedValueOnce([[{ overall_score: 90 }]]) // quality
      .mockResolvedValueOnce([[{ designation_id: "desig-1" }]]) // designation
      .mockResolvedValueOnce([[{ has_reports: 1 }]]) // manager-tier check
      .mockResolvedValueOnce([[{ id: "report-1" }, { id: "report-2" }]]) // direct report ids
      .mockResolvedValueOnce([[{ process_id: "proc-1", branch_id: "branch-1" }]]); // manager's own scope

    mockListSnapshots.mockResolvedValueOnce([{ total_shrinkage_pct: 12.5 }]);
    mockGetDashboardSummary.mockResolvedValueOnce({ attrition_rate: 8.2 });
    mockGetStatement.mockResolvedValueOnce({
      rows: [{ componentKey: "recognized_revenue", values: { "proc-1": 500000 } }],
    });

    const result = await computeEmployeeSnapshot("mgr-1", "2026-08-24");

    expect(result.teamShrinkagePct).toBe(12.5);
    expect(result.teamAttritionPct).toBe(8.2);
    expect(result.teamRevenue).toBe(500000);
  });

  it("leaves rollup metrics null for an individual contributor with no direct reports", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ overall_score: 90 }]])
      .mockResolvedValueOnce([[{ designation_id: "desig-2" }]])
      .mockResolvedValueOnce([[{ has_reports: 0 }]]); // no direct reports

    const result = await computeEmployeeSnapshot("ic-1", "2026-08-24");

    expect(result.teamShrinkagePct).toBeNull();
    expect(result.teamAttritionPct).toBeNull();
    expect(result.teamRevenue).toBeNull();
    expect(mockListSnapshots).not.toHaveBeenCalled();
  });

  it("degrades a single rollup metric to null on that service's own failure, without affecting the others", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ overall_score: 90 }]])
      .mockResolvedValueOnce([[{ designation_id: "desig-1" }]])
      .mockResolvedValueOnce([[{ has_reports: 1 }]])
      .mockResolvedValueOnce([[{ id: "report-1" }]])
      .mockResolvedValueOnce([[{ process_id: "proc-1", branch_id: "branch-1" }]]);

    mockListSnapshots.mockRejectedValueOnce(new Error("db down"));
    mockGetDashboardSummary.mockResolvedValueOnce({ attrition_rate: 5.0 });
    mockGetStatement.mockResolvedValueOnce({ rows: [] }); // no recognized_revenue row for this period

    const result = await computeEmployeeSnapshot("mgr-2", "2026-08-24");

    expect(result.teamShrinkagePct).toBeNull(); // service threw
    expect(result.teamAttritionPct).toBe(5.0);   // succeeded
    expect(result.teamRevenue).toBeNull();       // no matching row, not an error
  });
});

describe("writeEmployeePerformanceSnapshots", () => {
  beforeEach(() => mocks.execute.mockReset());

  it("continues past a failing employee and still writes the next one, reporting the error", async () => {
    mocks.execute
      // SELECT active employees
      .mockResolvedValueOnce([[{ id: "emp-fail" }, { id: "emp-ok" }]])
      // emp-fail: computeEmployeeSnapshot's first query throws
      .mockRejectedValueOnce(new Error("connection reset"))
      // emp-ok: computeEmployeeSnapshot's 4 queries succeed
      .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]]) // attendance
      .mockResolvedValueOnce([[]]) // active pip
      .mockResolvedValueOnce([[{ overall_score: 90 }]]) // quality
      .mockResolvedValueOnce([[{ designation_id: "desig-2" }]]) // employee designation
      .mockResolvedValueOnce([[{ has_reports: 0 }]]) // manager-tier check
      // emp-ok: INSERT
      .mockResolvedValueOnce([{}]);

    const result = await writeEmployeePerformanceSnapshots("2026-08-24");

    expect(result.written).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].employeeId).toBe("emp-fail");
    expect(result.errors[0].error).toContain("connection reset");
  });
});
