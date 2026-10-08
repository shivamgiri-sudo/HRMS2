import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An approved bulk upload cannot be unpicked one row at a time.
 *
 * A branch head approves a bulk batch once, for hundreds of employees. `lockEntity`
 * records every row the batch applied in `bulk_upload_locked_entity` precisely so that
 * single decision cannot then be reversed row by row through the discard screen,
 * leaving the batch's own summary claiming rows that no longer exist.
 *
 * `getEntityLock` was written to read that table and had ZERO production callers — the
 * lock was recorded on every approval and enforced nowhere. These tests hold the wiring
 * in place at the only two entry points that can erase one of these rows.
 */

const { execute, getConnection, getEntityLock } = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnection: vi.fn(),
  getEntityLock: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../../bulk-upload/bulk-approval.service.js", () => ({ getEntityLock }));
// In scope, so the lock is the only thing that can refuse these discards — otherwise
// OUT_OF_SCOPE would answer first and the lock would look enforced when it was not.
vi.mock("../../../shared/scopeAccess.js", () => ({ hasScopedAccess: async () => true }));

const LEAVE = {
  id: "leave-1", employee_id: "emp-1", status: "approved", leave_type_id: "lt-1",
  from_date: "2026-08-03", to_date: "2026-08-04", total_days: 2,
  leave_name: "Casual Leave", employee_code: "MAS001",
};
const REG = {
  id: "reg-1", employee_id: "emp-1", status: "approved", session_date: "2026-08-03",
  dispute_type: null, reason_code: "missed_punch", employee_code: "MAS001",
};

const { discardService } = await import("../discard.service.js");

const actor = { userId: "u1", roles: ["super_admin"], role: "super_admin" };

beforeEach(() => {
  getEntityLock.mockReset();
  execute.mockReset().mockImplementation(async (sql: string, params?: unknown[]) => {
    const id = params?.[0];
    if (/FROM leave_request/i.test(sql)) return [id === LEAVE.id ? [LEAVE] : []];
    if (/FROM attendance_regularization/i.test(sql)) return [id === REG.id ? [REG] : []];
    return [[]];
  });
});

describe("discard refuses a row an approved bulk upload locked", () => {
  it("blocks an approved leave that came from a bulk batch", async () => {
    getEntityLock.mockResolvedValue({
      entity_type: "leave_request", upload_batch_no: "BATCH-1787", locked_at: "2026-08-20",
    });

    const preview = await discardService.previewLeave("leave-1", actor);
    const blocker = preview.blockers.find((b) => b.code === "LOCKED_BY_BULK_UPLOAD");

    expect(blocker).toBeDefined();
    expect(blocker!.message).toContain("BATCH-1787");
    expect(getEntityLock).toHaveBeenCalledWith("leave_request", "leave-1");
  });

  it("blocks an approved regularization that came from a bulk batch", async () => {
    getEntityLock.mockResolvedValue({
      entity_type: "attendance_regularization", upload_batch_no: "BATCH-1787", locked_at: "2026-08-20",
    });

    const preview = await discardService.previewRegularization("reg-1", actor);

    expect(preview.blockers.some((b) => b.code === "LOCKED_BY_BULK_UPLOAD")).toBe(true);
    expect(getEntityLock).toHaveBeenCalledWith("attendance_regularization", "reg-1");
  });

  it("refuses the discard itself, not only the preview", async () => {
    getEntityLock.mockResolvedValue({
      entity_type: "leave_request", upload_batch_no: "BATCH-1787", locked_at: "2026-08-20",
    });

    await expect(
      discardService.discardLeave("leave-1", actor, "wrong dates"),
    ).rejects.toMatchObject({ code: "LOCKED_BY_BULK_UPLOAD" });
    // Nothing may be written on a refusal — no transaction is even opened.
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("leaves an ordinary approved leave discardable", async () => {
    getEntityLock.mockResolvedValue(null);

    const preview = await discardService.previewLeave("leave-1", actor);

    expect(preview.blockers.some((b) => b.code === "LOCKED_BY_BULK_UPLOAD")).toBe(false);
  });
});

describe("discardBatchRows — the 'reverse it through that batch' path", () => {
  it("unlocks a row when the caller names the SAME batch that locked it", async () => {
    getEntityLock.mockResolvedValue({
      entity_type: "leave_request", upload_batch_id: "batch-A", upload_batch_no: "BATCH-1787", locked_at: "2026-08-20",
    });

    const preview = await discardService.previewLeave("leave-1", actor, "batch-A");
    expect(preview.blockers.some((b) => b.code === "LOCKED_BY_BULK_UPLOAD")).toBe(false);
  });

  it("still refuses when the caller names a DIFFERENT batch than the one that locked it", async () => {
    getEntityLock.mockResolvedValue({
      entity_type: "leave_request", upload_batch_id: "batch-A", upload_batch_no: "BATCH-1787", locked_at: "2026-08-20",
    });

    const preview = await discardService.previewLeave("leave-1", actor, "batch-B");
    const blocker = preview.blockers.find((b) => b.code === "LOCKED_BY_BULK_UPLOAD");
    expect(blocker).toBeDefined();
  });

  it("reports each row's own outcome independently rather than stopping the selection on the first failure", async () => {
    // Two rows, two DIFFERENT reasons to fail, neither reaching a transaction —
    // proves discardBatchRows loops and records a distinct outcome per row rather
    // than throwing (and losing the rest of the selection) on the first one.
    // "leave-1" is locked by a batch OTHER than the one this call names.
    // "leave-2" resolves to no row at all (execute's default mock only recognises
    // leave-1/reg-1), so it fails with NOT_FOUND instead.
    getEntityLock.mockImplementation(async (_type: string, entityId: string) =>
      entityId === "leave-1"
        ? { entity_type: "leave_request", upload_batch_id: "batch-OTHER", upload_batch_no: "BATCH-9999", locked_at: "2026-08-20" }
        : null,
    );
    const results = await discardService.discardBatchRows(
      "batch-A", "leave", ["leave-1", "leave-2"], actor, "batch found to be wrong",
    );
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.entityId === "leave-1")).toMatchObject({ success: false });
    expect(results.find((r) => r.entityId === "leave-1")?.message).toContain("BATCH-9999");
    expect(results.find((r) => r.entityId === "leave-2")).toMatchObject({
      success: false, message: expect.stringContaining("not found"),
    });
  });
});
