import { describe, it, expect , vi } from "vitest";
// Branch / approver policy is covered in scope.adapters.test.ts (fake DB); this file tests mapping + decide only.
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

import { jobRequisitionAdapter } from "../adapters/job-requisition.js";

const row = {
  id: "r1", requisition_code: "REQ-1", designation_name: "Agent", department_name: "Ops", branch_name: "NOIDA",
  process_name: "Sales", requested_headcount: 5, employment_type: "full_time", salary_min: 15000, salary_max: 20000,
  experience_min_years: 1, experience_max_years: 3, education_requirement: "12th", skills_required: "English",
  job_description: "Calling", shift_requirement: "Day", rotational_shift: 1, night_shift_required: 0,
  target_joining_date: "2026-11-01", requisition_validity: "2026-12-01", priority: "urgent", requisition_type: "new_position",
  business_justification: "New campaign", requested_by_name: "Asha", owner_recruiter_name: "Ravi", aging_days: 4,
  created_at: "2026-10-01T10:00:00Z", internal_posting: 0, ad_required: 1,
};

describe("jobRequisitionAdapter", () => {
  it("maps every component", async () => {
    const { ctx, calls } = fakeCtx({ "GET /api/job-requisition/pending-approvals": { success: true, data: [row] } });
    const [it1] = await jobRequisitionAdapter.list(ctx);
    expect(calls).toHaveLength(1);
    expect(it1.uid).toBe("job_requisition:r1");
    expect(it1.priority).toBe("high");
    expect(it1.rejectNeedsReason).toBe(true);
    expect(it1.viewPath).toBe("/recruitment/job-requisition?approvalId=r1");
    const labels = it1.fields.map((x) => x.label);
    for (const l of ["Designation", "Branch", "Headcount requested", "Salary range", "Target joining", "Business justification", "Job description", "Requested by", "Pending for (days)", "Ad required"]) {
      expect(labels).toContain(l);
    }
    expect(it1.fields.find((x) => x.label === "Salary range")?.value).toContain("15,000");
    expect(it1.fields.find((x) => x.label === "Internal posting")).toBeUndefined();
  });
  it("returns [] when list is empty", async () => {
    const { ctx } = fakeCtx({ "GET /api/job-requisition/pending-approvals": { data: [] } });
    expect(await jobRequisitionAdapter.list(ctx)).toEqual([]);
  });
  it("approve posts remarks, reject posts reason", async () => {
    const { ctx, calls } = fakeCtx({
      "POST /api/job-requisition/r1/approve": { success: true },
      "POST /api/job-requisition/r1/reject": { success: true },
    });
    await jobRequisitionAdapter.decide(ctx, { id: "r1" }, "approve", "ok");
    await jobRequisitionAdapter.decide(ctx, { id: "r1" }, "reject", "not needed now");
    expect(calls[0].body).toEqual({ remarks: "ok" });
    expect(calls[1].body).toEqual({ reason: "not needed now" });
  });
});
