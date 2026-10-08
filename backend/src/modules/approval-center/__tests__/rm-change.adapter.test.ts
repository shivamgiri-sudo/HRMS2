import { describe, it, expect, vi } from "vitest";
// Branch / approver policy is covered in scope.adapters.test.ts (fake DB); this file tests mapping + decide only.
vi.mock("../adapters/_scope.js", async () => (await import("./_scopePassthrough.js")).passthrough);
const emp = vi.fn();
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: (...a: any[]) => emp(...a) }));
import { rmChangeAdapter } from "../adapters/rm-change.js";

describe("rmChangeAdapter", () => {
  it("maps fields and drops own request", async () => {
    emp.mockResolvedValue({ id: "me" });
    const call = vi.fn().mockResolvedValue({ ok: true, data: [
      { id: "r1", employee_id: "e1", employee_name: "A B", employee_code: "C1", branch_name: "Pune", current_manager_name: "X", requested_manager_name: "Y", reason: "Shift change", status: "pending", created_at: "2030-01-01T00:00:00Z" },
      { id: "r2", employee_id: "me", employee_name: "Me", status: "pending" },
    ] });
    const items = await rmChangeAdapter.list({ userId: "u", call } as any);
    expect(items.map((i) => i.id)).toEqual(["r1"]);
    expect(items[0].fields.map((x) => x.label)).toEqual(expect.arrayContaining(["Employee", "Branch", "Current manager", "Requested manager", "Reason"]));
    expect(items[0].rejectNeedsReason).toBe(true);
    expect(items[0].viewPath).toBe("/wfm-manager-approvals?approvalId=r1");
  });
  it("decides", async () => {
    const call = vi.fn().mockResolvedValue({});
    const c = { userId: "u", call } as any;
    await rmChangeAdapter.decide(c, { id: "r1" }, "approve", "");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/rm-change/r1/action", { body: { action: "approved", remarks: undefined } });
    await rmChangeAdapter.decide(c, { id: "r1" }, "reject", "no");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/rm-change/r1/action", { body: { action: "rejected", remarks: "no" } });
  });
});
