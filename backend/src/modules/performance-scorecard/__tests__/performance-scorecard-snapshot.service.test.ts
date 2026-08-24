import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mocks.execute } }));

import { computeEmployeeSnapshot } from "../performance-scorecard-snapshot.service.js";

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
});
