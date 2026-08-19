import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const connExecute = vi.fn().mockResolvedValue([[], []]);
  return {
    connExecute,
    conn: {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute: connExecute,
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    },
  };
});

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([[], []]),
    getConnection: vi.fn().mockResolvedValue(mocks.conn),
  },
  pingDb: vi.fn(),
}));
vi.mock("../src/modules/engagement/badge.service.js", () => ({ queueAutoAwards: vi.fn() }));
vi.mock("../src/modules/payroll/payroll-targeted-recalculation.service.js", () => ({
  recalculateOpenPayrollForEmployee: vi.fn().mockResolvedValue({ status: "recalculated", runId: "run-1", message: "ok" }),
  queuePayrollRecalculation: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "../src/db/mysql.js";
import {
  fallbackMinutesForRegularizedStatus,
  isAprRegularizationReason,
  wfmService,
} from "../src/modules/wfm/wfm.service.js";
import { recalculateOpenPayrollForEmployee } from "../src/modules/payroll/payroll-targeted-recalculation.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;
const recalc = recalculateOpenPayrollForEmployee as ReturnType<typeof vi.fn>;

const fakeShift = {
  id: "shift-1", shift_code: "GEN", shift_name: "General",
  start_time: "09:00", end_time: "18:00", required_minutes: 540,
  branch_name: null, process_name: null, active_status: 1,
  created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
};

const fakeSession = {
  id: "sess-1", employee_id: "emp-1", session_date: "2026-05-21",
  login_time: "2026-05-21T09:00:00Z", logout_time: null,
  total_login_minutes: 0, current_status: "Logged In",
  punch_source: "MANUAL", branch_name: null, process_name: null,
  created_at: "2026-05-21T09:00:00Z", updated_at: "2026-05-21T09:00:00Z",
};

const fakeReg = {
  id: "reg-1", employee_id: "emp-1", session_date: "2026-05-20",
  reason: "Was present", status: "pending",
  created_at: "2026-05-21T00:00:00Z", updated_at: "2026-05-21T00:00:00Z",
};

/**
 * A request that can actually change the day.
 *
 * fakeReg carries no requested status, no dispute type and no corrected punch,
 * so there is nothing for an approval to apply. Approving it used to "succeed"
 * and write nothing — the employee was told their correction was approved while
 * their attendance and LWP were untouched. That is now refused, so the tests
 * about the approval flow itself need a request with a correction in it.
 */
const fakeApprovableReg = { ...fakeReg, requested_status: "present" };

beforeEach(() => {
  vi.clearAllMocks();
  exec.mockReset().mockResolvedValue([[], []]);
  recalc.mockClear();
  mocks.connExecute.mockReset().mockResolvedValue([[], []]);
  mocks.conn.beginTransaction.mockClear();
  mocks.conn.commit.mockClear();
  mocks.conn.rollback.mockClear();
  mocks.conn.release.mockClear();
});

// ─── Shifts ──────────────────────────────────────────────────────────────────

describe("wfmService.listShifts", () => {
  it("returns all shifts", async () => {
    exec.mockResolvedValueOnce([[fakeShift], []]);
    const r = await wfmService.listShifts();
    expect(r).toHaveLength(1);
    expect(r[0].shift_code).toBe("GEN");
  });

  it("filters active shifts only", async () => {
    exec.mockResolvedValueOnce([[fakeShift], []]);
    await wfmService.listShifts({ activeStatus: "active" });
    const [sql] = exec.mock.calls[0];
    expect(sql).toMatch(/active_status\s*=\s*1/i);
  });
});

describe("wfmService.getShift", () => {
  it("returns shift by id", async () => {
    exec.mockResolvedValueOnce([[fakeShift], []]);
    const r = await wfmService.getShift("shift-1");
    expect(r.shift_code).toBe("GEN");
  });

  it("throws when not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(wfmService.getShift("nope")).rejects.toThrow("Shift not found");
  });
});

describe("wfmService.createShift", () => {
  it("throws when shift_code already exists", async () => {
    exec.mockResolvedValueOnce([[fakeShift], []]);
    await expect(
      wfmService.createShift({ shiftCode: "GEN", shiftName: "General", startTime: "09:00", endTime: "18:00", requiredMinutes: 540 }, "user-1")
    ).rejects.toThrow("Shift code already exists");
  });

  it("creates shift", async () => {
    exec.mockResolvedValueOnce([[], []]); // no dup
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // INSERT
    exec.mockResolvedValueOnce([[fakeShift], []]); // re-fetch
    const r = await wfmService.createShift(
      { shiftCode: "GEN", shiftName: "General", startTime: "09:00", endTime: "18:00", requiredMinutes: 540 }, "user-1"
    );
    expect(r.shift_code).toBe("GEN");
  });
});

describe("wfmService.updateShift", () => {
  it("throws when not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(wfmService.updateShift("nope", { shiftName: "X" }, "user-1")).rejects.toThrow("Shift not found");
  });

  it("updates and returns shift", async () => {
    exec.mockResolvedValueOnce([[fakeShift], []]); // getShift
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    exec.mockResolvedValueOnce([[{ ...fakeShift, shift_name: "Night" }], []]); // re-fetch
    const r = await wfmService.updateShift("shift-1", { shiftName: "Night" }, "user-1");
    expect(r.shift_name).toBe("Night");
  });
});

// ─── Attendance Sessions ───────────────────────────────────────────────────────

describe("wfmService.clockIn", () => {
  it("throws when session already exists for that date", async () => {
    exec.mockResolvedValueOnce([[fakeSession], []]);
    await expect(
      wfmService.clockIn({ employeeId: "emp-1", sessionDate: "2026-05-21", punchSource: "MANUAL" }, "user-1")
    ).rejects.toThrow("Session already exists");
  });

  it("creates session and returns it", async () => {
    exec.mockResolvedValueOnce([[], []]); // no existing
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // INSERT
    exec.mockResolvedValueOnce([[fakeSession], []]); // re-fetch
    const r = await wfmService.clockIn(
      { employeeId: "emp-1", sessionDate: "2026-05-21", punchSource: "MANUAL" }, "user-1"
    );
    expect(r.current_status).toBe("Logged In");
  });
});

describe("wfmService.clockOut", () => {
  it("throws when session not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(wfmService.clockOut("nope", "user-1")).rejects.toThrow("Session not found");
  });

  it("sets logout_time and calculates total_login_minutes", async () => {
    const loginAt = new Date("2026-05-21T09:00:00Z");
    exec.mockResolvedValueOnce([[{ ...fakeSession, login_time: loginAt.toISOString() }], []]); // get session
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    exec.mockResolvedValueOnce([[{ ...fakeSession, logout_time: new Date().toISOString(), current_status: "Logged Out" }], []]); // re-fetch
    const r = await wfmService.clockOut("sess-1", "user-1");
    expect(r.current_status).toBe("Logged Out");
  });
});

describe("wfmService.listSessions", () => {
  it("returns paginated sessions", async () => {
    exec.mockResolvedValueOnce([[fakeSession], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    const r = await wfmService.listSessions({ page: 1, limit: 20 });
    expect(r.data).toHaveLength(1);
    expect(r.total).toBe(1);
  });
});

// ─── Regularization ───────────────────────────────────────────────────────────

describe("wfmService.submitRegularization", () => {
  it("creates regularization request", async () => {
    exec.mockResolvedValueOnce([[], []]); // duplicate check
    exec.mockResolvedValueOnce([[{ branch_id: null }], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[], []]); // inbox employee lookup
    // REGULARIZATION_PENDING work-inbox trigger (added 2026-08-19): a name lookup, then
    // createWorkItemIfNotExists's own dedup-check SELECT + INSERT — 3 extra db.execute
    // calls between the inbox-notification block and the SMS block below.
    exec.mockResolvedValueOnce([[], []]); // trigger: employee name lookup
    exec.mockResolvedValueOnce([[], []]); // trigger: work_item dedup check (none pending)
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // trigger: work_item INSERT
    exec.mockResolvedValueOnce([[], []]); // SMS employee lookup
    exec.mockResolvedValueOnce([[fakeReg], []]);
    const r = await wfmService.submitRegularization(
      { employeeId: "emp-1", sessionDate: "2026-05-20", reason: "Was present" }, "emp-1"
    );
    expect(r.status).toBe("pending");
  });
});

describe("wfmService.reviewRegularization", () => {
  it("throws when not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(
      wfmService.reviewRegularization("nope", { status: "approved" }, "mgr-1")
    ).rejects.toThrow("Regularization not found");
  });

  it("approves regularization", async () => {
    exec.mockResolvedValueOnce([[fakeApprovableReg], []]); // get
    mocks.connExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // regularization status UPDATE
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // inbox alert close
    exec.mockResolvedValueOnce([[], []]); // SMS employee lookup
    exec.mockResolvedValueOnce([[{ ...fakeApprovableReg, status: "approved" }], []]); // re-fetch
    const r = await wfmService.reviewRegularization("reg-1", { status: "approved" }, "mgr-1");
    expect(r.status).toBe("approved");
  });

  it("refuses to approve a request that would change nothing", async () => {
    // The silent case: no requested status, no exception dispute type, no
    // corrected punch. This used to return 'approved' and write no attendance
    // at all, so the audit trail recorded a correction that never happened.
    exec.mockResolvedValueOnce([[fakeReg], []]); // get
    await expect(
      wfmService.reviewRegularization("reg-1", { status: "approved" }, "mgr-1")
    ).rejects.toThrow(/would not change the attendance record/);
  });

  it("approves a punch-only correction, which carries no requested status", async () => {
    // The default category on /attendance-regularization. The correction lives in
    // the times, not in a status, and used to be discarded on approval.
    const punchOnly = { ...fakeReg, new_punch_in: "09:00", new_punch_out: "18:00" };
    exec.mockResolvedValueOnce([[punchOnly], []]); // get
    mocks.connExecute.mockResolvedValue([[{}], []]);
    exec.mockResolvedValue([[{ ...punchOnly, status: "approved" }], []]);
    const r = await wfmService.reviewRegularization("reg-1", { status: "approved" }, "mgr-1");
    expect(r.status).toBe("approved");
  });

  it("closes the inbox alerts the decision settles", async () => {
    // Reviewing used to update attendance and leave the alert open, so the
    // approver kept being reminded about a regularization they had cleared.
    exec.mockResolvedValueOnce([[fakeApprovableReg], []]); // get
    mocks.connExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([{ affectedRows: 2 }, []]); // inbox alert close
    exec.mockResolvedValueOnce([[], []]); // SMS employee lookup
    exec.mockResolvedValueOnce([[{ ...fakeApprovableReg, status: "approved" }], []]);

    await wfmService.reviewRegularization("reg-1", { status: "approved" }, "mgr-1");

    const closeCall = exec.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE work_inbox_item")
    );
    expect(closeCall).toBeTruthy();
    expect(String(closeCall?.[0])).toContain("is_actioned = 1");
    // The punch and validation alerts for that same date are answered too.
    expect(String(closeCall?.[0])).toContain("attendance_missing_punch");
    expect(closeCall?.[1]).toContain("reg-1");
  });

  it("keeps the alert open when the manager only passes it to WFM", async () => {
    // manager_approved is a hand-off, not a completion — WFM still has to act.
    mocks.connExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    // Blanket row so both getRegularization calls resolve; the escalation
    // lookups in between are satisfied by the same stub.
    exec.mockResolvedValue([[{ ...fakeReg, status: "manager_approved" }], []]);

    await wfmService.reviewRegularization("reg-1", { status: "manager_approved" } as never, "mgr-1");

    const closeCall = exec.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE work_inbox_item")
    );
    expect(closeCall).toBeUndefined();
  });

  it("creates and locks ADR when approved APR regularization has no existing ADR", async () => {
    exec.mockResolvedValueOnce([[
      {
        ...fakeReg,
        requested_status: "present",
        reason_code: "DIALLER_NOT_LOGGED",
      },
    ], []]);
    mocks.connExecute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // regularization status UPDATE
      .mockResolvedValueOnce([[], []]) // existing ADR lookup
      .mockResolvedValueOnce([[{ apr_minutes: 0 }], []]) // APR minutes lookup
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // ADR upsert
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // inbox alert close
    exec.mockResolvedValueOnce([[], []]); // SMS employee lookup
    exec.mockResolvedValueOnce([[{ ...fakeReg, status: "approved" }], []]);

    await wfmService.reviewRegularization("reg-1", { status: "approved" }, "mgr-1");

    const adrUpsertCall = mocks.connExecute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO attendance_daily_record")
    );
    expect(adrUpsertCall).toBeTruthy();
    expect(adrUpsertCall?.[1]).toContain("apr_regularization");
    expect(adrUpsertCall?.[1]).toContain(480);
    expect(mocks.conn.commit).toHaveBeenCalledTimes(1);
    expect(recalc).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "emp-1",
      payrollMonth: "2026-05",
      sourceEventType: "attendance_regularization",
      sourceEventId: "reg-1",
    }));
  });

  it("rejects approval when ADR is locked by another correction", async () => {
    exec.mockResolvedValueOnce([[
      {
        ...fakeReg,
        requested_status: "present",
        reason_code: "DIALLER_NOT_LOGGED",
      },
    ], []]);
    mocks.connExecute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[
        {
          attendance_status: "absent",
          lwp_value: 1,
          is_locked: 1,
          regularization_id: "other-reg",
          override_by: null,
        },
      ], []]);

    await expect(
      wfmService.reviewRegularization("reg-1", { status: "approved" }, "mgr-1")
    ).rejects.toThrow("already locked by another correction");
    expect(mocks.conn.rollback).toHaveBeenCalledTimes(1);
  });
});

describe("APR regularization helpers", () => {
  it("recognizes APR regularization reasons", () => {
    expect(isAprRegularizationReason("DIALLER_NOT_LOGGED")).toBe(true);
    expect(isAprRegularizationReason("dialler_not_logged")).toBe(true);
    expect(isAprRegularizationReason("LATE_ARRIVAL_VALID")).toBe(false);
  });

  it("uses payroll-safe fallback minutes for approved statuses", () => {
    expect(fallbackMinutesForRegularizedStatus("present")).toBe(480);
    expect(fallbackMinutesForRegularizedStatus("half_day")).toBe(240);
    expect(fallbackMinutesForRegularizedStatus("absent")).toBe(0);
  });
});

describe("wfmService.listRegularizations", () => {
  it("returns list filtered by status", async () => {
    exec.mockResolvedValueOnce([[fakeReg], []]);
    const r = await wfmService.listRegularizations({ status: "pending" });
    expect(r).toHaveLength(1);
    const [sql] = exec.mock.calls[0];
    expect(sql).toMatch(/status/i);
  });
});
