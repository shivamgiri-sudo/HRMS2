import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

import { db } from "../src/db/mysql.js";
import { leaveService } from "../src/modules/leave/leave.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;

const fakeType = { id: "lt-1", leave_code: "CL", leave_name: "Casual Leave", max_days_per_year: 12, carry_forward: 0, requires_approval: 1, paid_leave: 1, active_status: 1 };
const fakeRequest = { id: "lr-1", employee_id: "emp-1", leave_type_id: "lt-1", from_date: "2026-06-01", to_date: "2026-06-03", total_days: 3, status: "pending" };
const fakeBalance = { id: "bal-1", employee_id: "emp-1", leave_type_id: "lt-1", balance_year: 2026, allocated_days: 12, used_days: 0, adjusted_days: 0 };
const fakeHoliday = { id: "hol-1", holiday_name: "Diwali", holiday_date: "2026-10-20", holiday_type: "national", active_status: 1 };

beforeEach(() => vi.clearAllMocks());

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
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeRequest], []]);
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

  it("approves request", async () => {
    exec.mockResolvedValueOnce([[fakeRequest], []]); // get
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE request
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // INSERT approval log
    exec.mockResolvedValueOnce([[{ ...fakeRequest, status: "approved" }], []]); // re-fetch
    const r = await leaveService.reviewRequest("lr-1", { status: "approved" }, "mgr-1");
    expect(r.status).toBe("approved");
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
