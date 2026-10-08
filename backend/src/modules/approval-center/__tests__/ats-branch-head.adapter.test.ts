import { describe, it, expect , vi } from "vitest";
// Branch / approver policy is covered in scope.adapters.test.ts (fake DB); this file tests mapping + decide only.
vi.mock("../adapters/_roles.js", () => ({ callerHasRole: async () => true, callerRoleKeys: async () => [] }));
vi.mock("../adapters/_scope.js", async () => (await import("./_scopePassthrough.js")).passthrough);
import type { LoopbackCtx } from "../types.js";

function fakeCtx(routes: Record<string, any>, userId = "u1") {
  const calls: Array<{ method: string; path: string; query?: any; body?: any }> = [];
  const ctx: LoopbackCtx = {
    userId,
    async call(method, path, opts) {
      calls.push({ method, path, query: opts?.query, body: opts?.body });
      const r = routes[`${method} ${path}`];
      if (r instanceof Error) throw r;
      if (r === undefined) throw new Error(`unexpected ${method} ${path}`);
      return typeof r === "function" ? r() : r;
    },
  } as LoopbackCtx;
  return { ctx, calls };
}

import { atsBranchHeadAdapter } from "../adapters/ats-branch-head.js";

const row = {
  id: "p1", candidate_id: "c1", candidate_code: "C-1", candidate_name: "Ravi K", mobile: "9", email: "r@x.in",
  applied_for_role: "Agent", applied_for_branch: "b1", branch_display_name: "NOIDA", employment_type: "onroll",
  gross_salary: 24000, joining_date: "2026-10-20", salary_start_date: "2026-10-21", basic_salary: 12000, hra: 6000,
  conveyance: 1000, special_allowance: 5000, submitted_by: "Payroll Pat", submitted_at: "2026-10-05T10:00:00Z",
};

describe("atsBranchHeadAdapter", () => {
  it("maps all salary components", async () => {
    const { ctx } = fakeCtx({
      "GET /api/ats/branch-head-approval/pending": { success: true, data: [row] },
      "GET /api/ats/onboarding/pending-approval": { ok: true, data: [] },
    });
    const [i] = await atsBranchHeadAdapter.list(ctx);
    expect(i.uid).toBe("ats_branch_head:p1");
    const labels = i.fields.map((x) => x.label);
    for (const l of ["Gross salary", "Basic", "HRA", "Conveyance", "Special allowance", "Joining date", "Salary start date", "Submitted by (Payroll HR)", "Payroll HR validation"]) {
      expect(labels).toContain(l);
    }
    expect(i.viewPath).toBe("/ats/branch-head-approval?approvalId=p1");
  });
  it("skips candidates already in the canonical offer queue", async () => {
    const { ctx } = fakeCtx({
      "GET /api/ats/branch-head-approval/pending": { data: [row, { ...row, id: "p2", candidate_id: "c2" }] },
      "GET /api/ats/onboarding/pending-approval": { data: [{ candidate_id: "c1" }] },
    });
    const items = await atsBranchHeadAdapter.list(ctx);
    expect(items.map((x) => x.id)).toEqual(["p2"]);
  });
  it("still lists when the offer queue is forbidden", async () => {
    const { ctx } = fakeCtx({
      "GET /api/ats/branch-head-approval/pending": { data: [row] },
      "GET /api/ats/onboarding/pending-approval": new Error("403"),
    });
    expect(await atsBranchHeadAdapter.list(ctx)).toHaveLength(1);
  });
  it("decide maps to approved / rejected", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/ats/branch-head-approval/process": { success: true } });
    await atsBranchHeadAdapter.decide(ctx, { id: "p1" }, "approve", "");
    await atsBranchHeadAdapter.decide(ctx, { id: "p1" }, "reject", "no");
    expect(calls[0].body).toEqual({ approval_id: "p1", approval_status: "approved", remarks: undefined });
    expect(calls[1].body).toEqual({ approval_id: "p1", approval_status: "rejected", remarks: "no" });
  });
});
