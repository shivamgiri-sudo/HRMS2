import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock factories can capture these variables
const { mockExecute, mockRecalc } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockRecalc: vi.fn(),
}));

// Mock DB — overrides the global setup.ts mock for this test file
vi.mock("../src/db/mysql.js", () => ({ db: { execute: mockExecute } }));

// Mock recalculation
vi.mock("../src/modules/payroll/payroll-targeted-recalculation.service.js", () => ({
  recalculateOpenPayrollForEmployee: mockRecalc,
}));

import { drainPayrollRecalcQueue } from "../src/modules/payroll/payroll-recalc-drainer.service.js";

beforeEach(() => { vi.clearAllMocks(); });

describe("drainPayrollRecalcQueue", () => {
  it("returns zeros when queue is empty", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // SELECT pending rows
    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result).toEqual({ processed: 0, failed: 0, skipped_locked: 0 });
    expect(mockRecalc).not.toHaveBeenCalled();
  });

  it("processes pending entries and marks them completed", async () => {
    const rows = [
      { id: "id-1", employee_id: "emp-1", payroll_month: "2026-07-01", reason: "cosec_sync" },
      { id: "id-2", employee_id: "emp-2", payroll_month: "2026-07-01", reason: "cosec_sync" },
    ];
    mockExecute
      .mockResolvedValueOnce([rows])  // SELECT pending
      .mockResolvedValue([[]]); // UPDATE calls
    mockRecalc.mockResolvedValue({ status: "recalculated", runId: "run-1", message: "ok" });

    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockRecalc).toHaveBeenCalledTimes(2);
  });

  it("marks entry as skipped_locked when run is locked", async () => {
    const rows = [{ id: "id-3", employee_id: "emp-3", payroll_month: "2026-07-01", reason: "cosec_sync" }];
    mockExecute
      .mockResolvedValueOnce([rows])
      .mockResolvedValue([[]]);
    mockRecalc.mockResolvedValue({ status: "queued", runId: "run-1", message: "run is locked" });

    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result.skipped_locked).toBe(1);
    expect(result.processed).toBe(0);
  });

  it("marks entry as failed when recalc throws", async () => {
    const rows = [{ id: "id-4", employee_id: "emp-4", payroll_month: "2026-07-01", reason: "cosec_sync" }];
    mockExecute
      .mockResolvedValueOnce([rows])
      .mockResolvedValue([[]]);
    mockRecalc.mockRejectedValue(new Error("DB error"));

    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });
});
