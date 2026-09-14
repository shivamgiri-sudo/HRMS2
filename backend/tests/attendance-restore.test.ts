import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyRestore, type DateRestorePlan } from "../src/shared/attendanceRestore.js";

/**
 * Regression cover for a discard that reported success while doing nothing.
 *
 * The DELETE carried `AND is_locked = 0`, but a regularization approval always
 * sets is_locked = 1 — so the delete matched zero rows for the exact case it
 * exists to handle. The result still said "1 date deleted", because the count
 * came from the plan rather than from rows affected. Live consequence: a dispute
 * read `discarded` while its attendance row sat there, present and locked,
 * still pointing at the discarded request.
 */

const execute = vi.fn();
const conn: any = { execute };

function plan(over: Partial<DateRestorePlan> = {}): DateRestorePlan {
  return {
    date: "2026-07-28",
    currentStatus: "present",
    currentLwp: 0,
    mode: "delete",
    restoredStatus: null,
    restoredLwp: null,
    ...over,
  };
}

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([{ affectedRows: 1 }, []]);
});

describe("applyRestore — delete", () => {
  it("does NOT filter on is_locked, or it can never remove a row an approval locked", async () => {
    await applyRestore(conn, "emp-1", [plan()], new Map(), "u1", "reason");

    const [sql] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/DELETE FROM attendance_daily_record/i);
    expect(String(sql)).not.toMatch(/is_locked/i);
  });

  it("records rows actually affected, so the count cannot claim phantom work", async () => {
    execute.mockResolvedValue([{ affectedRows: 0 }, []]);   // nothing matched
    const p = plan();
    await applyRestore(conn, "emp-1", [p], new Map(), "u1", "reason");
    expect(p.appliedRows).toBe(0);

    execute.mockResolvedValue([{ affectedRows: 1 }, []]);
    const p2 = plan();
    await applyRestore(conn, "emp-1", [p2], new Map(), "u1", "reason");
    expect(p2.appliedRows).toBe(1);
  });

  it("scopes the delete to one employee and one date", async () => {
    await applyRestore(conn, "emp-1", [plan()], new Map(), "u1", "reason");
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual(["emp-1", "2026-07-28"]);
  });
});

describe("applyRestore — rows it must never touch", () => {
  it("writes nothing for skip_locked or skip_owned", async () => {
    await applyRestore(
      conn, "emp-1",
      [plan({ mode: "skip_locked" }), plan({ mode: "skip_owned" })],
      new Map(), "u1", "reason"
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("applyRestore — unlocking so the engine can recompute", () => {
  it("clears is_locked and ownership on the partial path", async () => {
    const p = plan({ mode: "partial", restoredStatus: "absent", restoredLwp: 1 });
    await applyRestore(conn, "emp-1", [p], new Map(), "u1", "reason");
    const [sql] = execute.mock.calls[0];
    // Every attendance-engine write is guarded by IF(is_locked = 0, ...), so a
    // row left locked would never be recomputed again.
    expect(String(sql)).toMatch(/is_locked = 0/);
    expect(String(sql)).toMatch(/regularization_id = NULL/);
    expect(p.appliedRows).toBe(1);
  });

  it("neutralises rather than inventing an absence on the rederive path", async () => {
    const p = plan({ mode: "rederive" });
    await applyRestore(conn, "emp-1", [p], new Map(), "u1", "reason");
    const [sql] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/attendance_status = 'unreconciled'/);
    expect(String(sql)).not.toMatch(/attendance_status = 'absent'/);
    expect(String(sql)).toMatch(/is_locked = 0/);
  });
});

describe("applyRestore — snapshot", () => {
  it("restores only columns the snapshot actually carries", async () => {
    const snapshots = new Map([
      ["2026-07-28", { row_existed: 1, snapshot: { attendance_status: "absent", lwp_value: 1, is_locked: 0 } }],
    ]);
    const p = plan({ mode: "snapshot", restoredStatus: "absent", restoredLwp: 1 });
    await applyRestore(conn, "emp-1", [p], snapshots as any, "u1", "reason");

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE attendance_daily_record/i);
    expect(String(sql)).toMatch(/attendance_status = \?/);
    // Columns absent from the snapshot must not appear in the SET list.
    expect(String(sql)).not.toMatch(/clock_in_time/);
    expect(params.slice(-2)).toEqual(["emp-1", "2026-07-28"]);
    expect(p.appliedRows).toBe(1);
  });
});
