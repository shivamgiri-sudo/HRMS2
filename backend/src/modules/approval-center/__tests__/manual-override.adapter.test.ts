import { describe, it, expect, vi } from "vitest";
const hasRole = vi.fn();
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole: (...a: any[]) => hasRole(...a) }));
import { manualOverrideAdapter } from "../adapters/manual-override.js";

const row = (o: any = {}) => ({
  id: "m1", employee_id: "e1", employee_name: "Asha", employee_code: "E1", branch_name: "Pune", process_name: "BPO",
  attendance_date: "2026-09-10", old_status: "absent", new_status: "half_day", old_lwp: 1, new_lwp: 0.5,
  reason: "Forgot to punch", approval_status: "pending", higher_approval_required: 0, payroll_month: "2026-09",
  payroll_impact_amount: 450, created_at: "2026-09-11T05:00:00Z", ...o,
});

describe("manualOverrideAdapter", () => {
  it("maps fields; hides locked rows from non-super-admin", async () => {
    hasRole.mockResolvedValue(false);
    const call = vi.fn().mockResolvedValue({ data: [row(), row({ id: "m2", higher_approval_required: 1 }), row({ id: "m3", approval_status: "approved" })] });
    const items = await manualOverrideAdapter.list({ userId: "u", call } as any);
    expect(call.mock.calls[0]).toEqual(["GET", "/api/attendance/manual-overrides", { query: { status: "pending" } }]);
    expect(items.map((i) => i.id)).toEqual(["m1"]);
    const labels = items[0].fields.map((x) => x.label);
    for (const l of ["Employee", "Branch", "Attendance date", "Current status", "New status", "Payroll impact", "Reason"]) expect(labels).toContain(l);
    expect(items[0].rejectNeedsReason).toBe(true);
    expect(items[0].viewPath).toContain("/hr/attendance-lookup?empCode=E1&approvalId=m1");
  });
  it("shows locked rows to super admin", async () => {
    hasRole.mockResolvedValue(true);
    const call = vi.fn().mockResolvedValue({ data: [row({ higher_approval_required: 1 })] });
    const items = await manualOverrideAdapter.list({ userId: "u", call } as any);
    expect(items).toHaveLength(1);
    expect(items[0].priority).toBe("high");
  });
  it("decides", async () => {
    const call = vi.fn().mockResolvedValue({});
    await manualOverrideAdapter.decide({ userId: "u", call } as any, { id: "m1" }, "approve", "");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/attendance/manual-overrides/m1/approve", { body: {} });
    await manualOverrideAdapter.decide({ userId: "u", call } as any, { id: "m1" }, "reject", "not valid reason here");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/attendance/manual-overrides/m1/reject", { body: { reason: "not valid reason here" } });
  });
});
