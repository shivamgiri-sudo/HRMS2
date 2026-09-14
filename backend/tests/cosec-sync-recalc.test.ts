import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute, mockQueue, mockDrain } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockQueue: vi.fn(),
  mockDrain: vi.fn().mockResolvedValue({ processed: 0, failed: 0, skipped_locked: 0 }),
}));

vi.mock("../src/db/mysql.js", () => ({ db: { execute: mockExecute, query: vi.fn().mockResolvedValue([[],[]]) } }));

vi.mock("../src/modules/payroll/payroll-targeted-recalculation.service.js", () => ({
  queuePayrollRecalculation: mockQueue,
  drainPayrollRecalcQueue: mockDrain,
}));

// Mock attendanceEngineService
vi.mock("../src/modules/wfm/attendance-engine.service.js", () => ({
  attendanceEngineService: { upsertDailyRecord: vi.fn().mockResolvedValue(undefined) },
}));

import { triggerPostSyncPayrollRecalc } from "../src/modules/wfm/cosec-sync.service.js";

beforeEach(() => { vi.clearAllMocks(); });

describe("triggerPostSyncPayrollRecalc", () => {
  it("queues and drains for each distinct payroll month", async () => {
    // 3 employees, 2 in 2026-07, 1 in 2026-06
    const written = new Map([
      ["2026-07", new Set(["emp-1", "emp-2"])],
      ["2026-06", new Set(["emp-3"])],
    ]);

    // Mock: both months have open runs
    mockExecute.mockResolvedValue([[{ run_month: "2026-07", id: "run-1" }]]);

    await triggerPostSyncPayrollRecalc(written);

    // queue called 3 times (2 + 1)
    expect(mockQueue).toHaveBeenCalledTimes(3);
    // drain called once per month
    expect(mockDrain).toHaveBeenCalledTimes(2);
    expect(mockDrain).toHaveBeenCalledWith("2026-07");
    expect(mockDrain).toHaveBeenCalledWith("2026-06");
  });

  it("skips months with no open runs", async () => {
    const written = new Map([["2026-07", new Set(["emp-1"])]]);
    // No open run for this month
    mockExecute.mockResolvedValue([[]]); // empty run rows

    await triggerPostSyncPayrollRecalc(written);

    expect(mockQueue).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
  });

  it("swallows drainer errors so sync result is not masked", async () => {
    const written = new Map([["2026-07", new Set(["emp-1"])]]);
    mockExecute.mockResolvedValue([[{ run_month: "2026-07", id: "run-1" }]]);
    mockQueue.mockResolvedValue(undefined);
    mockDrain.mockRejectedValue(new Error("drainer blew up"));

    // Must not throw
    await expect(triggerPostSyncPayrollRecalc(written)).resolves.not.toThrow();
  });
});
