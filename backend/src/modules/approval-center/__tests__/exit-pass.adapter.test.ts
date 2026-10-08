import { describe, it, expect, vi } from "vitest";

vi.mock("../../assets/exit-pass.service.js", () => ({
  UNRESTRICTED_ROLES: ["super_admin", "admin", "it_head"],
  getActorRoles: vi.fn(async () => (globalThis as any).__roles ?? []),
  resolveRequestingEmployee: vi.fn(async () => ({ employeeId: "emp-me", branchId: "b1", fullName: "Me" })),
}));

import { exitPassAdapter } from "../adapters/exit-pass.js";
import { fakeCtx } from "./_fakeCtx.js";

const pass = (o: any = {}) => ({
  id: "x1", status: "pending_branch_head", requestor_employee_id: "emp-other", requestor_name: "Kiran", branch_name: "Pune",
  branch_head_employee_id: "emp-me", request_department: "IT", movement_type: "returnable", priority: "urgent", purpose_code: "REPAIR",
  purpose_details: "Screen broken", destination_type: "vendor", destination_name: "FixIt", planned_exit_at: "2026-10-08T10:00:00Z",
  submitted_at: "2026-10-07T04:00:00Z", ...o,
});
const base = (bh: any[], ad: any[]) => ({
  "GET /api/exit-passes/pending/branch-head": { success: true, data: bh },
  "GET /api/exit-passes/pending/admin": { success: true, data: ad },
  "GET /api/exit-passes/x1": { data: { items: [{ item_name: "Laptop", quantity: 1, unit: "Nos", category: "IT", serial_number: "S1" }] } },
});

describe("exitPassAdapter", () => {
  it("maps branch-head stage with items", async () => {
    (globalThis as any).__roles = ["branch_head"];
    const { ctx } = fakeCtx(base([pass()], []));
    const [it] = await exitPassAdapter.list(ctx);
    expect(it.meta).toEqual({ stage: "branch_head" });
    expect(it.priority).toBe("high");
    expect(it.fields.find((x) => x.label === "Items")?.value).toContain("Laptop");
    expect(it.viewPath).toBe("/it-admin/exit-pass?tab=pending_bh&approvalId=x1");
    expect(it.rejectNeedsReason).toBe(true);
  });
  it("drops scope-only branch-head rows and own requests; keeps all for override roles", async () => {
    (globalThis as any).__roles = ["branch_head"];
    const rows = [pass({ id: "mine-assigned" }), pass({ id: "scope-only", branch_head_employee_id: "emp-else" }), pass({ id: "own", requestor_employee_id: "emp-me" })];
    let r = await exitPassAdapter.list(fakeCtx(base(rows, [])).ctx);
    expect(r.map((i) => i.id)).toEqual(["mine-assigned"]);
    (globalThis as any).__roles = ["admin"];
    r = await exitPassAdapter.list(fakeCtx(base(rows, [])).ctx);
    expect(r.map((i) => i.id)).toEqual(["mine-assigned", "scope-only"]);
  });
  it("admin stage rows", async () => {
    (globalThis as any).__roles = ["admin"];
    const { ctx } = fakeCtx(base([], [pass({ id: "a1", status: "pending_admin_approval" }), pass({ id: "a2", status: "approved" })]));
    const r = await exitPassAdapter.list(ctx);
    expect(r.map((i) => i.id)).toEqual(["a1"]);
    expect(r[0].meta).toEqual({ stage: "admin" });
    expect(r[0].viewPath).toContain("tab=pending_admin");
  });
  it("decide routes by stage", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/exit-passes/x1/branch-head/decision": {}, "POST /api/exit-passes/x1/admin/decision": {} });
    await exitPassAdapter.decide(ctx, { id: "x1", meta: { stage: "branch_head" } }, "approve", "");
    await exitPassAdapter.decide(ctx, { id: "x1", meta: { stage: "branch_head" } }, "reject", "no");
    await exitPassAdapter.decide(ctx, { id: "x1", meta: { stage: "admin" } }, "reject", "no");
    expect(calls.map((c) => c.path)).toEqual(["/api/exit-passes/x1/branch-head/decision", "/api/exit-passes/x1/branch-head/decision", "/api/exit-passes/x1/admin/decision"]);
    expect(calls.map((c) => c.body.decision)).toEqual(["approved", "rejected", "rejected"]);
    expect(calls[1].body.remarks).toBe("no");
  });
});
