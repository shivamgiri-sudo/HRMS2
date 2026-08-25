import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mocks.execute } }));

import {
  computeEmployeeSnapshot,
  writeEmployeePerformanceSnapshots,
} from "../performance-scorecard-snapshot.service.js";

describe("computeEmployeeSnapshot", () => {
  beforeEach(() => mocks.execute.mockReset());

  it("marks unplanned_leave_flag true when attendance_status is missing_punch", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ attendance_status: "missing_punch", late_by_minutes: 0 }]]) // attendance
      .mockResolvedValueOnce([[]]) // active pip
      .mockResolvedValueOnce([[{ overall_score: 82.5 }]]) // quality
      .mockResolvedValueOnce([[{ designation_id: "desig-1" }]]); // employee designation

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
      .mockResolvedValueOnce([[{ designation_id: "desig-1" }]]); // employee designation

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
      // emp-ok: INSERT
      .mockResolvedValueOnce([{}]);

    const result = await writeEmployeePerformanceSnapshots("2026-08-24");

    expect(result.written).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].employeeId).toBe("emp-fail");
    expect(result.errors[0].error).toContain("connection reset");
  });
});
