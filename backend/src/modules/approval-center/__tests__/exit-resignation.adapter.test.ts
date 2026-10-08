import { describe, it, expect, vi, beforeEach } from "vitest";
// Branch / approver policy is covered in scope.adapters.test.ts (fake DB); this file tests mapping + decide only.
vi.mock("../adapters/_scope.js", async () => (await import("./_scopePassthrough.js")).passthrough);
import { makeCtx } from "./fakeCtx.js";

const hasRole = vi.hoisted(() => vi.fn());
vi.mock("../adapters/_roles.js", () => ({ callerHasRole: hasRole, callerRoleKeys: vi.fn() }));

import { exitResignationAdapter } from "../adapters/exit-resignation.js";

const row = (over: Record<string, unknown> = {}) => ({
  id: "x1", employee_id: "e1", status: "submitted", exit_type: "voluntary", exit_sub_type: "resignation",
  exit_reason_category: "better_opportunity", resignation_reason: "New job", last_working_day_proposed: "2026-11-15",
  notice_period_days: 30, initiated_by: "employee", initiated_by_user_id: "emp-user", employee_name: "Asha Rao",
  employee_code: "MAS100", branch_name: "Pune", process_name: "Sales", department_name: "Ops", reporting_manager_name: "Ravi",
  risk_label: "high", engagement_score: 41, regrettable_exit: 1, submitted_at: new Date().toISOString(), ...over,
});

describe("exitResignationAdapter", () => {
  beforeEach(() => hasRole.mockResolvedValue(true));

  it("maps every component and routes the view link to the command center", async () => {
    const { ctx } = makeCtx({
      "GET /api/exit": (c: any) => ({ data: c.query.status === "submitted" ? [row()] : [row({ id: "x2", status: "manager_review" })] }),
    });
    const items = await exitResignationAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["x1", "x2"]);
    const it = items[0];
    expect(it.uid).toBe("exit_resignation:x1");
    expect(it.category).toBe("Exit");
    const labels = it.fields.map((f) => f.label);
    for (const l of ["Employee", "Branch", "Process", "Reporting manager", "Resignation reason", "Proposed last working day", "Notice period (days)", "Attrition risk", "Regrettable exit"]) {
      expect(labels).toContain(l);
    }
    expect(it.viewPath).toBe("/exit/command-center?tab=overview&approvalId=x1");
    expect(it.rejectNeedsReason).toBe(true);
    expect(it.rejectLabel).toBe("Return to employee");
  });

  it("drops rows in other statuses, duplicates and the caller's own resignation", async () => {
    const { ctx } = makeCtx({
      "GET /api/exit": { data: [row({ id: "a", status: "notice_active" }), row({ id: "b", initiated_by_user_id: "u-1" }), row({ id: "c" }), row({ id: "c" })] },
    });
    const items = await exitResignationAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["c"]);
  });

  it("flags aging items high priority", async () => {
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const { ctx } = makeCtx({ "GET /api/exit": { data: [row({ submitted_at: old })] } });
    expect((await exitResignationAdapter.list(ctx))[0].priority).toBe("high");
  });

  it("lists nothing without a deciding role and makes no call", async () => {
    hasRole.mockResolvedValue(false);
    const { ctx, calls } = makeCtx();
    expect(await exitResignationAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("approve hits PATCH /approve, decline hits /return with the reason", async () => {
    const { ctx, calls } = makeCtx({ "PATCH /api/exit/x1/approve": { success: true }, "PATCH /api/exit/x1/return": { success: true } });
    await exitResignationAdapter.decide(ctx, { id: "x1" }, "approve", "");
    await exitResignationAdapter.decide(ctx, { id: "x1" }, "reject", "Please discuss first");
    expect(calls[0]).toMatchObject({ method: "PATCH", path: "/api/exit/x1/approve" });
    expect(calls[1]).toMatchObject({ method: "PATCH", path: "/api/exit/x1/return", body: { reason: "Please discuss first" } });
  });
});
