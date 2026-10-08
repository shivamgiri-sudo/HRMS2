import { describe, it, expect, vi } from "vitest";
// Branch / approver policy is covered in scope.adapters.test.ts (fake DB); this file tests mapping + decide only.
vi.mock("../adapters/_scope.js", async () => (await import("./_scopePassthrough.js")).passthrough);
import { makeCtx } from "./fakeCtx.js";

const roles = vi.hoisted(() => vi.fn());
vi.mock("../adapters/_roles.js", () => ({ callerRoleKeys: roles, callerHasRole: vi.fn() }));

import { exitClearanceAdapter } from "../adapters/exit-clearance.js";

const task = (over: Record<string, unknown> = {}) => ({
  id: "t1", exit_request_id: "x1", employee_id: "e1", clearance_area: "it", task_title: "IT access closure",
  task_description: "Revoke VPN and mail", owner_role: "it", due_date: "2099-01-01", status: "pending", remarks: null,
  attachment_url: null, created_at: "2026-10-01T00:00:00Z", employee_name: "Asha Rao", employee_code: "MAS100",
  branch_name: "Pune", process_name: "Sales", exit_status: "notice_active", last_working_day_confirmed: "2026-11-15", noc_case_status: null, ...over,
});

describe("exitClearanceAdapter", () => {
  it("maps fields and picks the page from owner_role", async () => {
    roles.mockResolvedValue(["it"]);
    const { ctx } = makeCtx({ "GET /api/exit/clearance/queue": { data: [task(), task({ id: "t2", clearance_area: "manager", owner_role: "manager" })] } });
    const items = await exitClearanceAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["t1"]); // manager-area task is not clearable by an 'it' caller
    expect(items[0].viewPath).toBe("/provisioning/it?approvalId=t1");
    const labels = items[0].fields.map((f) => f.label);
    for (const l of ["Employee", "Branch", "Clearance area", "Task", "Description", "Due date", "Task status", "Exit status", "Last working day"]) expect(labels).toContain(l);
    expect(items[0].meta).toEqual({ exitRequestId: "x1" });
  });

  it("routes each owner_role to its own page", async () => {
    roles.mockResolvedValue(["super_admin"]);
    const rows = ["manager", "hr", "admin", "wfm", "payroll", "it"].map((r, i) => task({ id: `t${i}`, clearance_area: r, owner_role: r }));
    const { ctx } = makeCtx({ "GET /api/exit/clearance/queue": { data: rows } });
    const paths = (await exitClearanceAdapter.list(ctx)).map((i) => i.viewPath.split("?")[0]);
    expect(paths).toEqual(["/provisioning/manager-handover", "/provisioning/hr-exit", "/provisioning/admin", "/provisioning/wfm-alignment", "/provisioning/payroll-exit", "/provisioning/it"]);
  });

  it("flags overdue and blocked tasks high", async () => {
    roles.mockResolvedValue(["it"]);
    const { ctx } = makeCtx({ "GET /api/exit/clearance/queue": { data: [task({ due_date: "2020-01-01" })] } });
    expect((await exitClearanceAdapter.list(ctx))[0].priority).toBe("high");
  });

  it("clear -> cleared, decline -> blocked, both with remarks via the exit-scoped endpoint", async () => {
    const { ctx, calls } = makeCtx({ "PATCH /api/exit/x1/clearance/t1": { success: true } });
    const item = { id: "t1", meta: { exitRequestId: "x1" } };
    await exitClearanceAdapter.decide(ctx, item, "approve", "done");
    await exitClearanceAdapter.decide(ctx, item, "reject", "laptop not returned");
    expect(calls[0].body).toEqual({ status: "cleared", remarks: "done" });
    expect(calls[1].body).toEqual({ status: "blocked", remarks: "laptop not returned" });
  });

  it("refuses to decide without the exit request reference", async () => {
    const { ctx } = makeCtx();
    await expect(exitClearanceAdapter.decide(ctx, { id: "t1" }, "approve", "")).rejects.toThrow();
  });

  it("requires a remark when blocking", async () => {
    roles.mockResolvedValue(["it"]);
    const { ctx } = makeCtx({ "GET /api/exit/clearance/queue": { data: [task()] } });
    expect((await exitClearanceAdapter.list(ctx))[0].rejectNeedsReason).toBe(true);
  });
});
