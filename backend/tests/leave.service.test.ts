import { describe, it, expect, vi, beforeEach } from "vitest";

// reviewRequest runs inside a transaction obtained from db.getConnection(), so
// the mock must supply one. Without it every reviewRequest test threw
// "db.getConnection is not a function", and because vi.clearAllMocks() does not
// drain the mockResolvedValueOnce queue, the values those tests had queued
// leaked into listRequests / getBalance / listHolidays / createHoliday and broke
// them too.
const { getConnection, connExecute, connQuery } = vi.hoisted(() => ({
  getConnection: vi.fn(),
  connExecute: vi.fn(),
  // Separate from connExecute: reviewRequest's FOR UPDATE lock and
  // submitRequest's GET_LOCK/RELEASE_LOCK mutex now run on a dedicated
  // connection via conn.query(...), not conn.execute(...). (2026-08-13 audit)
  connQuery: vi.fn(),
}));

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), getConnection },
  pingDb: vi.fn(),
}));
vi.mock("../src/modules/inbox/inbox.service.js", () => ({
  inboxService: { resolveItems: vi.fn().mockResolvedValue(undefined), createItem: vi.fn() },
}));
vi.mock("../src/modules/communication/sms.helper.js", () => ({
  sendSMS: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "../src/db/mysql.js";
import { leaveService } from "../src/modules/leave/leave.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;

const commit = vi.fn();
const rollback = vi.fn();

/**
 * Route statements inside the transaction by SQL text rather than call order.
 * Order-based mocking is what rotted here in the first place — every statement
 * added to reviewRequest silently shifted the queue underneath these tests.
 */
function routeConn(handlers: Array<[RegExp, unknown]>) {
  connExecute.mockImplementation((sql: string) => {
    for (const [pattern, result] of handlers) {
      if (pattern.test(sql)) return Promise.resolve(result);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
}

const fakeType = { id: "lt-1", leave_code: "CL", leave_name: "Casual Leave", max_days_per_year: 12, carry_forward: 0, requires_approval: 1, paid_leave: 1, active_status: 1 };
const fakeRequest = { id: "lr-1", employee_id: "emp-1", leave_type_id: "lt-1", from_date: "2026-06-01", to_date: "2026-06-03", total_days: 3, status: "pending" };
const fakeBalance = { id: "bal-1", employee_id: "emp-1", leave_type_id: "lt-1", balance_year: 2026, allocated_days: 12, used_days: 0, adjusted_days: 0 };
const fakeHoliday = { id: "hol-1", holiday_name: "Diwali", holiday_date: "2026-10-20", holiday_type: "national", active_status: 1 };

beforeEach(() => {
  // mockReset, not clearAllMocks: clear leaves queued mockResolvedValueOnce
  // values in place, so one test's unconsumed queue becomes the next test's
  // first result.
  exec.mockReset();
  exec.mockResolvedValue([[], []]);
  connExecute.mockReset();
  connExecute.mockResolvedValue([{ affectedRows: 1 }, []]);
  connQuery.mockReset();
  // Default: GET_LOCK acquires successfully. Individual reviewRequest tests
  // override this via routeConn's FOR UPDATE pattern (conn.execute, not
  // conn.query) for the double-approval status check; submitRequest's mutex
  // uses conn.query and is satisfied by this default.
  connQuery.mockResolvedValue([[{ acquired: 1 }], []]);
  commit.mockReset();
  rollback.mockReset();
  getConnection.mockReset();
  getConnection.mockResolvedValue({
    execute: connExecute,
    query: connQuery,
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit,
    rollback,
    release: vi.fn(),
  });
});

// The FOR UPDATE status-lock reviewRequest now runs first inside its
// transaction — every test that reaches the transaction must route it to the
// same status getRequest() returned, or the (correct, intentional) status-
// changed-by-another-action guard fires instead of the behaviour under test.
function forUpdateLock(status: string): [RegExp, unknown] {
  return [/FOR UPDATE/i, [[{ status }], []]];
}

describe("leaveService.listLeaveTypes", () => {
  it("returns leave types", async () => {
    exec.mockResolvedValueOnce([[fakeType], []]);
    const r = await leaveService.listLeaveTypes();
    expect(r).toHaveLength(1);
    expect(r[0].leave_code).toBe("CL");
  });
});

describe("leaveService.createLeaveType", () => {
  it("throws when code already exists", async () => {
    exec.mockResolvedValueOnce([[fakeType], []]);
    await expect(
      leaveService.createLeaveType({ leaveCode: "CL", leaveName: "Casual", maxDaysPerYear: 12, carryForward: false, requiresApproval: true, paidLeave: true })
    ).rejects.toThrow("Leave code already exists");
  });

  it("creates leave type", async () => {
    exec.mockResolvedValueOnce([[], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeType], []]);
    const r = await leaveService.createLeaveType({ leaveCode: "CL", leaveName: "Casual", maxDaysPerYear: 12, carryForward: false, requiresApproval: true, paidLeave: true });
    expect(r.leave_code).toBe("CL");
  });
});

describe("leaveService.submitRequest", () => {
  it("creates leave request and returns it", async () => {
    // Routed by SQL: submitRequest runs policy and eligibility reads before the
    // INSERT, and their number is not something this test should depend on.
    exec.mockImplementation((sql: string) => {
      if (/SELECT id FROM leave_request/i.test(sql)) return Promise.resolve([[], []]);
      if (/FROM leave_request/i.test(sql)) return Promise.resolve([[fakeRequest], []]);
      if (/^\s*INSERT/i.test(sql)) return Promise.resolve([{ affectedRows: 1 }, []]);
      return Promise.resolve([[], []]);
    });
    const r = await leaveService.submitRequest({
      employeeId: "emp-1", leaveTypeId: "lt-1",
      fromDate: "2026-06-01", toDate: "2026-06-03", totalDays: 3,
    });
    expect(r.status).toBe("pending");
  });
});

describe("leaveService.reviewRequest", () => {
  it("throws when request not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(
      leaveService.reviewRequest("nope", { status: "approved" }, "mgr-1")
    ).rejects.toThrow("Leave request not found");
  });

  it("approves request with existing balance ledger", async () => {
    exec.mockResolvedValueOnce([[fakeRequest], []]);                              // getRequest
    exec.mockResolvedValue([[{ ...fakeRequest, status: "approved" }], []]);       // re-fetch + post-commit reads
    routeConn([
      forUpdateLock("pending"),
      [/FROM leave_type_master/i, [[{ max_days_per_year: 12 }], []]],
      [/FROM leave_balance_ledger/i, [[fakeBalance], []]],
      [/FROM attendance_daily_record/i, [[], []]],
    ]);

    const r = await leaveService.reviewRequest("lr-1", { status: "approved" }, "mgr-1");

    expect(r.status).toBe("approved");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    const sql = connExecute.mock.calls.map(([s]) => s).join("\n");
    expect(sql).toMatch(/UPDATE leave_balance_ledger[\s\S]*used_days = used_days \+/i);
  });

  it("captures a pre-approval attendance snapshot before overwriting attendance", async () => {
    // The snapshot is what makes a later discard able to put the day back, so it
    // must be written inside the same transaction and BEFORE the attendance upsert.
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    exec.mockResolvedValue([[{ ...fakeRequest, status: "approved" }], []]);
    routeConn([
      forUpdateLock("pending"),
      [/FROM leave_type_master/i, [[{ max_days_per_year: 12 }], []]],
      [/FROM leave_balance_ledger/i, [[fakeBalance], []]],
      [/FROM attendance_daily_record/i, [[], []]],
    ]);

    await leaveService.reviewRequest("lr-1", { status: "approved" }, "mgr-1");

    const statements = connExecute.mock.calls.map(([s]) => String(s));
    const snapshotIdx = statements.findIndex((s) => /INSERT IGNORE INTO attendance_state_snapshot/i.test(s));
    const upsertIdx = statements.findIndex((s) => /INSERT INTO attendance_daily_record/i.test(s));
    expect(snapshotIdx).toBeGreaterThan(-1);
    expect(upsertIdx).toBeGreaterThan(-1);
    expect(snapshotIdx).toBeLessThan(upsertIdx);

    // One snapshot row per calendar day of 2026-06-01..2026-06-03.
    const snapshotParams = connExecute.mock.calls.find(([s]) =>
      /INSERT IGNORE INTO attendance_state_snapshot/i.test(String(s)))![1] as any[];
    expect(snapshotParams.filter((p) => p === "2026-06-01")).toHaveLength(1);
    expect(snapshotParams).toContain("2026-06-02");
    expect(snapshotParams).toContain("2026-06-03");
  });

  it("approves request and creates balance ledger when none exists", async () => {
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    exec.mockResolvedValue([[{ ...fakeRequest, status: "approved" }], []]);
    routeConn([
      forUpdateLock("pending"),
      [/FROM leave_type_master/i, [[{ max_days_per_year: 12 }], []]],
      [/FROM leave_balance_ledger/i, [[], []]],   // no ledger row
      [/FROM attendance_daily_record/i, [[], []]],
    ]);

    const r = await leaveService.reviewRequest("lr-1", { status: "approved" }, "mgr-1");

    expect(r.status).toBe("approved");
    const sql = connExecute.mock.calls.map(([s]) => s).join("\n");
    expect(sql).toMatch(/INSERT INTO leave_balance_ledger/i);
  });

  /**
   * Approval attribution. Before this lock the terminal UPDATE wrote `status` and
   * nothing else: the actor and timestamp reached leave_approval_log but never
   * leave_request, so approved_by and approved_at were NULL on all 2,642 approved
   * rows (measured live 2026-08-11) and the MIS leave report rendered both blank.
   */
  function approvalUpdate() {
    return connExecute.mock.calls.find(([s]) =>
      /UPDATE leave_request\b/i.test(String(s)) && /\bapproved_by\b/i.test(String(s)));
  }

  it("stamps the approver and approval time on the leave request itself", async () => {
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    exec.mockResolvedValue([[{ ...fakeRequest, status: "approved" }], []]);
    routeConn([
      forUpdateLock("pending"),
      [/FROM leave_type_master/i, [[{ max_days_per_year: 12 }], []]],
      [/FROM leave_balance_ledger/i, [[fakeBalance], []]],
      [/FROM attendance_daily_record/i, [[], []]],
      // The reviewer arrives as an auth user id; the report joins approved_by to
      // employees.id, so the service must resolve it.
      [/FROM employees WHERE user_id/i, [[{ id: "emp-mgr-9" }], []]],
    ]);

    await leaveService.reviewRequest("lr-1", { status: "approved" }, "user-mgr-1");

    const call = approvalUpdate();
    expect(call, "terminal approval must UPDATE leave_request with approved_by").toBeDefined();
    expect(String(call![0])).toMatch(/approved_at\s*=\s*NOW\(\)/i);
    expect(call![1] as unknown[]).toContain("emp-mgr-9");
  });

  it("falls back to the auth user id when the approver has no employee record", async () => {
    // 995 of 1,117 active employees carry user_id, so an approver without one is
    // real. A traceable id beats a blank audit column.
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    exec.mockResolvedValue([[{ ...fakeRequest, status: "approved" }], []]);
    routeConn([
      forUpdateLock("pending"),
      [/FROM leave_type_master/i, [[{ max_days_per_year: 12 }], []]],
      [/FROM leave_balance_ledger/i, [[fakeBalance], []]],
      [/FROM attendance_daily_record/i, [[], []]],
      [/FROM employees WHERE user_id/i, [[], []]],
    ]);

    await leaveService.reviewRequest("lr-1", { status: "approved" }, "user-mgr-1");

    expect(approvalUpdate()![1] as unknown[]).toContain("user-mgr-1");
  });

  it("records branch_head as the approval level on the branch-head exception path", async () => {
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    exec.mockResolvedValue([[{ ...fakeRequest, status: "branch_head_approved" }], []]);
    routeConn([
      forUpdateLock("pending"),
      [/FROM leave_type_master/i, [[{ max_days_per_year: 12 }], []]],
      [/FROM leave_balance_ledger/i, [[fakeBalance], []]],
      [/FROM attendance_daily_record/i, [[], []]],
      [/FROM employees WHERE user_id/i, [[{ id: "emp-bh-2" }], []]],
    ]);

    await leaveService.reviewRequest("lr-1", { status: "branch_head_approved" }, "user-bh-1");

    expect(String(approvalUpdate()![0])).toMatch(/approval_level\s*=\s*'branch_head'/i);
  });

  it("does not stamp approved_by when the decision is a rejection", async () => {
    // approved_by means approver. Overloading it with rejections would make the
    // MIS report name a rejecter as the approver.
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    exec.mockResolvedValue([[{ ...fakeRequest, status: "rejected" }], []]);
    routeConn([forUpdateLock("pending"), [/FROM attendance_daily_record/i, [[], []]]]);

    await leaveService.reviewRequest("lr-1", { status: "rejected" }, "user-mgr-1");

    expect(approvalUpdate()).toBeUndefined();
    const joined = connExecute.mock.calls.map(([s]) => String(s)).join("\n");
    expect(joined).toMatch(/UPDATE leave_request SET status = \?/i);
  });

  it("throws when insufficient balance and rolls back", async () => {
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    routeConn([
      forUpdateLock("pending"),
      [/FROM leave_type_master/i, [[{ max_days_per_year: 12 }], []]],
      [/FROM leave_balance_ledger/i, [[{ ...fakeBalance, allocated_days: 2, used_days: 0 }], []]],
    ]);

    await expect(
      leaveService.reviewRequest("lr-1", { status: "approved" }, "mgr-1")
    ).rejects.toThrow("Insufficient leave balance");
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it("cancelling an approved leave credits the balance back without inventing absences", async () => {
    // Regression lock. The old revert wrote 'absent' + lwp_value 1.00 across every
    // calendar day in the range, but approval also writes every calendar day — so
    // cancelling a leave that spanned a weekend or holiday turned those days into
    // unpaid absences the employee never took.
    exec.mockResolvedValueOnce([[{ ...fakeRequest, status: "approved" }], []]);
    exec.mockResolvedValue([[{ ...fakeRequest, status: "cancelled" }], []]);
    routeConn([
      forUpdateLock("approved"),
      [/FROM attendance_daily_record/i, [[
        { record_date: "2026-06-01", attendance_status: "leave_approved", lwp_value: 0, is_locked: 0 },
        { record_date: "2026-06-02", attendance_status: "leave_approved", lwp_value: 0, is_locked: 0 },
        { record_date: "2026-06-03", attendance_status: "leave_approved", lwp_value: 0, is_locked: 0 },
      ], []]],
      [/FROM attendance_state_snapshot/i, [[], []]],
    ]);

    await leaveService.reviewRequest("lr-1", { status: "cancelled" }, "mgr-1");

    const statements = connExecute.mock.calls.map(([s]) => String(s));
    const joined = statements.join("\n");

    expect(joined).toMatch(/UPDATE leave_balance_ledger[\s\S]*GREATEST\(0, used_days - \?\)/i);
    // The specific defect: no blanket absent / LWP 1.00 write.
    expect(joined).not.toMatch(/attendance_status = 'absent'/i);
    expect(joined).not.toMatch(/lwp_value = 1\.00/i);
    // Days are neutralised and unlocked so the engine can resolve week-off/holiday.
    expect(joined).toMatch(/attendance_status = 'unreconciled'/i);
    expect(joined).toMatch(/is_locked = 0/i);
  });

  it("rejects request without touching the balance ledger", async () => {
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    exec.mockResolvedValue([[{ ...fakeRequest, status: "rejected" }], []]);
    routeConn([forUpdateLock("pending")]);

    const r = await leaveService.reviewRequest("lr-1", { status: "rejected" }, "mgr-1");

    expect(r.status).toBe("rejected");
    const sql = connExecute.mock.calls.map(([s]) => s).join("\n");
    expect(sql).not.toMatch(/UPDATE leave_balance_ledger/i);
    expect(sql).not.toMatch(/INSERT IGNORE INTO attendance_state_snapshot/i);
  });
});

describe("leaveService.listRequests", () => {
  it("returns paginated requests", async () => {
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    const r = await leaveService.listRequests({ page: 1, limit: 20 });
    expect(r.data).toHaveLength(1);
    expect(r.total).toBe(1);
  });

  it("filters by employeeId", async () => {
    exec.mockResolvedValueOnce([[fakeRequest], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    await leaveService.listRequests({ employeeId: "emp-1", page: 1, limit: 20 });
    const [sql] = exec.mock.calls[0];
    expect(sql).toMatch(/employee_id/i);
  });
});

describe("leaveService.getBalance", () => {
  it("returns balance for employee and year", async () => {
    exec.mockResolvedValueOnce([[fakeBalance], []]);
    const r = await leaveService.getBalance("emp-1", 2026);
    expect(r).toHaveLength(1);
    expect(r[0].allocated_days).toBe(12);
  });
});

describe("leaveService.listHolidays", () => {
  it("returns holidays", async () => {
    exec.mockResolvedValueOnce([[fakeHoliday], []]);
    const r = await leaveService.listHolidays();
    expect(r).toHaveLength(1);
    expect(r[0].holiday_name).toBe("Diwali");
  });
});

describe("leaveService.createHoliday", () => {
  it("creates holiday", async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeHoliday], []]);
    const r = await leaveService.createHoliday({ holidayName: "Diwali", holidayDate: "2026-10-20", holidayType: "national" });
    expect(r.holiday_name).toBe("Diwali");
  });
});
