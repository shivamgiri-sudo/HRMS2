import { describe, it, expect, vi } from "vitest";

const roleMock = vi.fn();
vi.mock("../../wfm/wfm.regularization.secure.routes.js", () => ({
  regularizationReviewRole: (...a: any[]) => roleMock(...a),
  // faithful copy of the stage rule for the cases under test
  nextRegularizationStatus: (role: string, cur: string) => {
    if (role === "super_admin") return "approved";
    if (role === "manager") return cur === "pending" ? "manager_approved" : null;
    if (role === "wfm") return cur === "manager_approved" ? "approved" : null;
    if (role === "payroll") return cur === "payroll_pending" ? "approved" : null;
    return null;
  },
}));

import { regularizationAdapter } from "../adapters/regularization.js";

const row = (o: any = {}) => ({
  id: "r1", employee_name: "Asha", employee_code: "E1", branch_name: "Pune", process_name: "BPO",
  manager_name: "Ravi", session_date: "2026-10-01", requested_status: "present", current_attendance_status: "absent",
  reason: "Biometric down", reason_label: "Device issue", status: "pending", created_at: new Date().toISOString(),
  supporting_doc_id: "d1", decision_support: { riskLevel: "low", flags: [], canApproveNow: false }, ...o,
});

describe("regularizationAdapter", () => {
  it("maps fields and filters non-actionable", async () => {
    roleMock.mockImplementation(async (_u: string, id: string) => (id === "r1" ? "manager" : id === "r3" ? "wfm" : null));
    const call = vi.fn().mockResolvedValue({ data: [row(), row({ id: "r2" }), row({ id: "r3", status: "pending" })] });
    const items = await regularizationAdapter.list({ userId: "u", call } as any);
    expect(call.mock.calls[0][1]).toBe("/api/wfm/regularizations");
    expect(items.map((i) => i.id)).toEqual(["r1"]); // r2 no role, r3 wfm at stage 1
    const i = items[0];
    expect(i.stage).toContain("Stage 1");
    expect(i.rejectNeedsReason).toBe(true);
    const labels = i.fields.map((x) => x.label);
    for (const l of ["Employee", "Branch", "Attendance date", "Requested status", "Reason", "Supporting document"]) expect(labels).toContain(l);
    expect(i.viewPath).toBe("/attendance-regularization?approvalId=r1");
  });
  it("uses canApproveNow without a role lookup", async () => {
    roleMock.mockReset();
    const call = vi.fn().mockResolvedValue({ data: [row({ status: "payroll_pending", decision_support: { canApproveNow: true } })] });
    const items = await regularizationAdapter.list({ userId: "u", call } as any);
    expect(items).toHaveLength(1);
    expect(roleMock).not.toHaveBeenCalled();
    expect(items[0].stage).toContain("Stage 3");
  });
  it("decides approve and reject", async () => {
    const call = vi.fn().mockResolvedValue({});
    await regularizationAdapter.decide({ userId: "u", call } as any, { id: "r1" }, "approve", "");
    expect(call).toHaveBeenLastCalledWith("PATCH", "/api/wfm/regularizations/r1/review", { body: { status: "approved", reviewerNote: null } });
    await regularizationAdapter.decide({ userId: "u", call } as any, { id: "r1" }, "reject", "no proof");
    expect(call).toHaveBeenLastCalledWith("PATCH", "/api/wfm/regularizations/r1/review", { body: { status: "rejected", reviewerNote: "no proof" } });
  });
});
