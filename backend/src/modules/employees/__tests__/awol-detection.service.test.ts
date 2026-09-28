import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

import { getLastWorkedDate } from "../awol-detection.service.js";

describe("getLastWorkedDate", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns the formatted last non-absent record_date for the employee", async () => {
    mockExecute.mockResolvedValueOnce([
      [{ last_worked_date: new Date("2026-09-10T00:00:00Z") }],
    ]);
    const result = await getLastWorkedDate("emp-1");
    expect(result).toBe("2026-09-10");
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("attendance_status <> 'absent'"),
      ["emp-1"],
    );
  });

  it("returns null when the employee has no non-absent record in the lookback window", async () => {
    mockExecute.mockResolvedValueOnce([[{ last_worked_date: null }]]);
    const result = await getLastWorkedDate("emp-2");
    expect(result).toBeNull();
  });
});
