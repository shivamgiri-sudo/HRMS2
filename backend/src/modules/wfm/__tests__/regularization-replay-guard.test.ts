import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * reviewRegularization must not re-apply a decision that is already in place.
 *
 * Why this exists: the method rewrites attendance_regularization and then re-applies the
 * correction to attendance_daily_record. It used to do that unconditionally, so approving an
 * already-approved row wrote the correction a second time. A bulk branch-head approval cut off
 * by the 60s proxy timeout leaves most of a batch approved and the batch back at
 * pending_approval — and the only way to finish it is to approve again, which replayed every
 * row that had already landed (83 of 217 on the real batch that prompted this).
 */

const execute = vi.fn();
const getConnection = vi.fn();

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: (...a: unknown[]) => execute(...a),
    getConnection: () => getConnection(),
  },
}));

describe("reviewRegularization — replay guard", () => {
  beforeEach(() => {
    execute.mockReset();
    getConnection.mockReset();
  });

  function connSpy() {
    return {
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
  }

  it("returns an already-approved row untouched — no transaction, no re-write", async () => {
    const { wfmService } = await import("../wfm.service.js");
    const conn = connSpy();
    getConnection.mockResolvedValue(conn);
    // getRegularization's SELECT
    execute.mockResolvedValue([[{ id: "reg-1", status: "approved", employee_id: "e1" }]]);

    const out = await wfmService.reviewRegularization(
      "reg-1",
      { status: "approved", reviewerNote: "bulk replay" },
      "approver-1",
    );

    expect(out.status).toBe("approved");
    // The guard must short-circuit before any write path is opened.
    expect(getConnection).not.toHaveBeenCalled();
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("still applies a decision that genuinely changes — approved -> rejected", async () => {
    const { wfmService } = await import("../wfm.service.js");
    const conn = connSpy();
    getConnection.mockResolvedValue(conn);
    execute.mockResolvedValue([[{ id: "reg-2", status: "approved", employee_id: "e2" }]]);

    await wfmService
      .reviewRegularization("reg-2", { status: "rejected", reviewerNote: "reversed" }, "approver-1")
      .catch(() => undefined); // downstream attendance work is not what this asserts

    expect(getConnection).toHaveBeenCalled();
    expect(conn.beginTransaction).toHaveBeenCalled();
  });
});
