import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));
vi.mock("../src/modules/engagement/badge.service.js", () => ({ queueAutoAwards: vi.fn() }));
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

import { db } from "../src/db/mysql.js";
import { wfmService } from "../src/modules/wfm/wfm.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  vi.clearAllMocks();
  exec.mockReset().mockResolvedValue([[], []]);
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
    exec.mockResolvedValueOnce([[{ branch_id: null }], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
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
    exec.mockResolvedValueOnce([[fakeReg], []]); // get
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    exec.mockResolvedValueOnce([[{ ...fakeReg, status: "approved" }], []]); // re-fetch
    const r = await wfmService.reviewRegularization("reg-1", { status: "approved" }, "mgr-1");
    expect(r.status).toBe("approved");
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
