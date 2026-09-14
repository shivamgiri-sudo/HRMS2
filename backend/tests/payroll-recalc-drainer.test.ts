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

/**
 * The drainer reclaims abandoned claims BEFORE it selects work, so that UPDATE is the first
 * statement every call makes and each test has to account for it. Default it to "nothing was
 * abandoned", which is the ordinary case; the reclamation tests below override it.
 */
const expectReclaimSweep = (affectedRows = 0) =>
  mockExecute.mockResolvedValueOnce([{ affectedRows }]);

describe("drainPayrollRecalcQueue", () => {
  it("returns zeros when queue is empty", async () => {
    expectReclaimSweep();
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
    expectReclaimSweep();
    mockExecute
      .mockResolvedValueOnce([rows])  // SELECT pending
      .mockResolvedValue([{ affectedRows: 1 }]); // UPDATE calls - the claim reads affectedRows
    mockRecalc.mockResolvedValue({ status: "recalculated", runId: "run-1", message: "ok" });

    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockRecalc).toHaveBeenCalledTimes(2);
  });

  /**
   * The claim is what makes this queue safe to drain from two places at once.
   *
   * The UPDATE that moves an entry to 'processing' used to be `WHERE id = ?` with its result
   * discarded — a note about intent, not a claim. The SELECT above it and that write are not
   * atomic together, and there are two entry points (the COSEC sync worker and a manual sync
   * route), so both could read the same pending row and both proceed — running the payroll
   * recalculation engine twice over one employee-month and interleaving read-modify-write on
   * the same salary_prep_line. This queue has already processed 3,164 entries in production.
   */
  it("skips an entry another drainer already claimed, and does not recalculate it", async () => {
    const rows = [{ id: "id-9", employee_id: "emp-9", payroll_month: "2026-07-01", reason: "cosec_sync" }];
    expectReclaimSweep();
    mockExecute
      .mockResolvedValueOnce([rows])              // SELECT pending
      .mockResolvedValueOnce([{ affectedRows: 0 }]); // the claim loses the race

    const result = await drainPayrollRecalcQueue("2026-07");

    expect(mockRecalc).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("marks entry as skipped_locked when run is locked", async () => {
    const rows = [{ id: "id-3", employee_id: "emp-3", payroll_month: "2026-07-01", reason: "cosec_sync" }];
    expectReclaimSweep();
    mockExecute
      .mockResolvedValueOnce([rows])
      .mockResolvedValue([{ affectedRows: 1 }]);
    mockRecalc.mockResolvedValue({ status: "queued", runId: "run-1", message: "run is locked" });

    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result.skipped_locked).toBe(1);
    expect(result.processed).toBe(0);
  });

  it("marks entry as failed when recalc throws", async () => {
    const rows = [{ id: "id-4", employee_id: "emp-4", payroll_month: "2026-07-01", reason: "cosec_sync" }];
    expectReclaimSweep();
    mockExecute
      .mockResolvedValueOnce([rows])
      .mockResolvedValue([{ affectedRows: 1 }]);
    mockRecalc.mockRejectedValue(new Error("DB error"));

    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });

  /**
   * Abandoned claims — a worker that died between claiming an entry and finishing it.
   *
   * The claim moves a row to 'processing'; if the process then dies (OOM, pm2 restart mid-run),
   * the row stays 'processing' with processed_at NULL forever. The work SELECT reads 'pending'
   * only, so nothing ever looked at that row again and that employee's salary_prep_line stayed
   * silently stale against attendance. Found live 2026-08-17: one row claimed on 2026-08-12 and
   * still unprocessed five days later.
   *
   * This behaviour had no test at all, which is how adding it broke the five above without
   * anything failing at the point of the change.
   */
  describe("abandoned claims", () => {
    it("sweeps stale claims back to pending BEFORE selecting work, so they are picked up", async () => {
      const reclaimedRow = [{ id: "id-5", employee_id: "emp-5", payroll_month: "2026-07-01", reason: "cosec_sync" }];
      expectReclaimSweep(1);                                // one abandoned claim reclaimed
      mockExecute
        .mockResolvedValueOnce([reclaimedRow])              // SELECT now returns it
        .mockResolvedValue([{ affectedRows: 1 }]);
      mockRecalc.mockResolvedValue({ status: "recalculated", runId: "run-1", message: "ok" });

      const result = await drainPayrollRecalcQueue("2026-07");

      // Ordering is the whole point: reclaim first, then read. Reversed, the reclaimed row would
      // not be visible until the NEXT drain.
      const firstSql = String(mockExecute.mock.calls[0][0]);
      expect(firstSql).toMatch(/UPDATE\s+payroll_recalculation_queue/i);
      expect(firstSql).toMatch(/status\s*=\s*'pending'/i);
      expect(String(mockExecute.mock.calls[1][0])).toMatch(/SELECT/i);
      expect(result.processed).toBe(1);
    });

    it("only reclaims claims that are actually abandoned, not live ones", async () => {
      expectReclaimSweep(0);
      mockExecute.mockResolvedValueOnce([[]]);

      await drainPayrollRecalcQueue("2026-07");

      // A live claim reclaimed too early would run the recalculation twice over one
      // employee-month — the exact interleaving the atomic claim exists to prevent. The sweep is
      // therefore bounded on all three of: still processing, never finished, and old enough.
      const sql = String(mockExecute.mock.calls[0][0]);
      expect(sql).toMatch(/status\s*=\s*'processing'/i);
      expect(sql).toMatch(/processed_at\s+IS\s+NULL/i);
      expect(sql).toMatch(/requested_at\s*<\s*DATE_SUB\(NOW\(\),\s*INTERVAL\s*\d+\s*MINUTE\)/i);
    });

    it("scopes the sweep to the month being drained", async () => {
      expectReclaimSweep(0);
      mockExecute.mockResolvedValueOnce([[]]);

      await drainPayrollRecalcQueue("2026-07");

      // Unscoped, draining July would reclaim an in-flight June claim held by another drainer.
      expect(String(mockExecute.mock.calls[0][0])).toMatch(/payroll_month\s*=\s*\?/i);
      expect(mockExecute.mock.calls[0][1]).toEqual(["2026-07-01"]);
    });
  });
});
