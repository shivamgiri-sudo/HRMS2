import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Manual P&L Adjustments (Part B, 2026-09-01) — service-level behaviour.
 *
 * Design under test: a separate adjustment line, never blended into system-calculated actuals.
 *   - Creating an adjustment leaves it 'pending' and must not affect any total.
 *   - Approving it makes it count in getAdjustedTotal(), with the right sign: reward ADDS to
 *     revenue, penalty SUBTRACTS. projected_revenue is informational only and never enters
 *     adjustedTotal.
 *   - Rejecting it must never affect anything.
 *   - Maker-checker: the creator cannot approve/reject their own entry (mirrors
 *     budget-topup.service.ts's P0P1-4 rule).
 */

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
});

describe("createManualAdjustment", () => {
  it("inserts as 'pending' and never as 'approved' directly", async () => {
    const { createManualAdjustment } = await import("../pnl-manual-adjustment.service.js");
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.startsWith("SELECT id, branch_id FROM process_master")) {
        return [[{ id: "proc-1", branch_id: "branch-1" }], []];
      }
      if (q.startsWith("INSERT INTO pnl_manual_adjustment")) {
        return [{ affectedRows: 1 }, []];
      }
      if (q.includes("FROM pnl_manual_adjustment a")) {
        return [[{
          id: "adj-1", process_id: "proc-1", branch_id: "branch-1", period_code: "2026-07",
          adjustment_type: "reward", amount: 50000, reason: "test", status: "pending",
          created_by: "u1", created_at: new Date().toISOString(), approved_by: null,
          approved_at: null, rejection_reason: null,
        }], []];
      }
      return [[], []];
    });

    const result = await createManualAdjustment(
      { processId: "proc-1", periodCode: "2026-07", adjustmentType: "reward", amount: 50000, reason: "test" },
      "u1"
    );
    expect(result.status).toBe("pending");

    const insertCall = execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO pnl_manual_adjustment"));
    expect(insertCall, "must issue an INSERT").toBeTruthy();
    expect(String(insertCall![0])).toContain("'pending'");
    expect(String(insertCall![0])).not.toMatch(/'approved'/);
  });

  it("refuses a zero/negative amount", async () => {
    const { createManualAdjustment } = await import("../pnl-manual-adjustment.service.js");
    await expect(
      createManualAdjustment(
        { processId: "proc-1", periodCode: "2026-07", adjustmentType: "reward", amount: 0, reason: "x" },
        "u1"
      )
    ).rejects.toMatchObject({ code: "ADJUSTMENT_AMOUNT_INVALID" });
  });

  it("refuses a missing reason — this is money, a justification is required", async () => {
    const { createManualAdjustment } = await import("../pnl-manual-adjustment.service.js");
    await expect(
      createManualAdjustment(
        { processId: "proc-1", periodCode: "2026-07", adjustmentType: "penalty", amount: 1000, reason: "   " },
        "u1"
      )
    ).rejects.toMatchObject({ code: "ADJUSTMENT_REASON_REQUIRED" });
  });
});

describe("getAdjustedTotal — sign and blending rules", () => {
  const rowsFor = (grouped: Array<{ adjustment_type: string; status: string; total: number; cnt: number }>) =>
    execute.mockResolvedValueOnce([grouped, []]);

  it("does not change the total while an adjustment is still pending", async () => {
    const { getAdjustedTotal } = await import("../pnl-manual-adjustment.service.js");
    rowsFor([{ adjustment_type: "reward", status: "pending", total: 50000, cnt: 1 }]);
    const result = await getAdjustedTotal("proc-1", "2026-07", 1_000_000);
    expect(result.adjustedTotal, "a pending entry must not move the total").toBe(1_000_000);
    expect(result.pendingCount).toBe(1);
    expect(result.approvedRewards).toBe(0);
  });

  it("adds an approved reward to the system revenue", async () => {
    const { getAdjustedTotal } = await import("../pnl-manual-adjustment.service.js");
    rowsFor([{ adjustment_type: "reward", status: "approved", total: 75000, cnt: 1 }]);
    const result = await getAdjustedTotal("proc-1", "2026-07", 1_000_000);
    expect(result.adjustedTotal).toBe(1_075_000);
    expect(result.approvedRewards).toBe(75000);
  });

  it("subtracts an approved penalty from the system revenue", async () => {
    const { getAdjustedTotal } = await import("../pnl-manual-adjustment.service.js");
    rowsFor([{ adjustment_type: "penalty", status: "approved", total: 40000, cnt: 1 }]);
    const result = await getAdjustedTotal("proc-1", "2026-07", 1_000_000);
    expect(result.adjustedTotal).toBe(960_000);
    expect(result.approvedPenalties).toBe(40000);
  });

  it("never lets a rejected entry affect the total", async () => {
    const { getAdjustedTotal } = await import("../pnl-manual-adjustment.service.js");
    rowsFor([{ adjustment_type: "reward", status: "rejected", total: 999999, cnt: 1 }]);
    const result = await getAdjustedTotal("proc-1", "2026-07", 1_000_000);
    expect(result.adjustedTotal).toBe(1_000_000);
    expect(result.approvedRewards).toBe(0);
  });

  it("keeps approved projected_revenue out of adjustedTotal — informational only", async () => {
    const { getAdjustedTotal } = await import("../pnl-manual-adjustment.service.js");
    rowsFor([{ adjustment_type: "projected_revenue", status: "approved", total: 2_000_000, cnt: 1 }]);
    const result = await getAdjustedTotal("proc-1", "2026-07", 1_000_000);
    expect(result.adjustedTotal, "projected revenue is forward-looking, not a realised adjustment").toBe(1_000_000);
    expect(result.approvedProjectedRevenue).toBe(2_000_000);
  });

  it("nets an approved reward and an approved penalty together", async () => {
    const { getAdjustedTotal } = await import("../pnl-manual-adjustment.service.js");
    rowsFor([
      { adjustment_type: "reward", status: "approved", total: 100000, cnt: 1 },
      { adjustment_type: "penalty", status: "approved", total: 30000, cnt: 1 },
    ]);
    const result = await getAdjustedTotal("proc-1", "2026-07", 1_000_000);
    expect(result.adjustedTotal).toBe(1_070_000);
  });
});

describe("reviewManualAdjustment — maker-checker and state machine", () => {
  function mockEntry(overrides: Record<string, unknown> = {}) {
    return {
      id: "adj-1", process_id: "proc-1", period_code: "2026-07", adjustment_type: "reward",
      amount: 50000, reason: "test", status: "pending", created_by: "maker-1",
      created_at: new Date().toISOString(), approved_by: null, approved_at: null,
      rejection_reason: null, ...overrides,
    };
  }

  it("refuses when the creator tries to review their own adjustment", async () => {
    const { reviewManualAdjustment } = await import("../pnl-manual-adjustment.service.js");
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SELECT * FROM pnl_manual_adjustment WHERE id")) {
        return [[mockEntry()], []];
      }
      return [[], []];
    });
    await expect(
      reviewManualAdjustment("adj-1", "approve", "maker-1")
    ).rejects.toMatchObject({ code: "ADJUSTMENT_MAKER_CHECKER" });
  });

  it("lets a different reviewer approve it", async () => {
    const { reviewManualAdjustment } = await import("../pnl-manual-adjustment.service.js");
    let updateSql = "";
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("SELECT * FROM pnl_manual_adjustment WHERE id")) return [[mockEntry()], []];
      if (q.startsWith("UPDATE pnl_manual_adjustment")) { updateSql = q; return [{ affectedRows: 1 }, []]; }
      if (q.includes("FROM pnl_manual_adjustment a")) return [[mockEntry({ status: "approved", approved_by: "checker-1" })], []];
      return [[], []];
    });
    const result = await reviewManualAdjustment("adj-1", "approve", "checker-1");
    expect(result.status).toBe("approved");
    expect(updateSql).toContain("'approved'");
  });

  it("requires a rejection reason", async () => {
    const { reviewManualAdjustment } = await import("../pnl-manual-adjustment.service.js");
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SELECT * FROM pnl_manual_adjustment WHERE id")) return [[mockEntry()], []];
      return [[], []];
    });
    await expect(
      reviewManualAdjustment("adj-1", "reject", "checker-1", "")
    ).rejects.toMatchObject({ code: "ADJUSTMENT_REJECT_REASON_REQUIRED" });
  });

  it("refuses to review an entry that is no longer pending", async () => {
    const { reviewManualAdjustment } = await import("../pnl-manual-adjustment.service.js");
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SELECT * FROM pnl_manual_adjustment WHERE id")) {
        return [[mockEntry({ status: "approved" })], []];
      }
      return [[], []];
    });
    await expect(
      reviewManualAdjustment("adj-1", "approve", "checker-1")
    ).rejects.toMatchObject({ code: "ADJUSTMENT_WRONG_STAGE" });
  });
});
