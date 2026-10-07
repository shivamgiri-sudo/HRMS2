import { describe, it, expect } from "vitest";
import { fakeCtx } from "./_ctx.js";
import { salaryDisputeAdapter as a } from "../adapters/salaryDispute.js";

const d = (o: any = {}) => ({ id: "d1", employee_name: "Meera", employee_code: "E9", run_month: "2026-09", dispute_type: "MISSING_OT", affected_dates: ["2026-09-03", "2026-09-04"], description: "OT not paid", status: "pending_wfm", differential_amount: null, wfm_remarks: null, created_at: "2026-10-01T00:00:00Z", ...o });

describe("salary dispute adapter", () => {
  it("lists both queues, WFM stage is reject-only", async () => {
    const { ctx } = fakeCtx({
      "GET /api/salary-disputes/queue/wfm": { data: [d(), d({ id: "x", status: "approved" })] },
      "GET /api/salary-disputes/queue/payroll-head": { data: [d({ id: "d2", status: "pending_payroll_head", differential_amount: 1500, wfm_remarks: "validated ok", differential_basis: "OT hrs" })] },
    });
    const items = await a.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["d1", "d2"]);
    expect(items[0].meta).toMatchObject({ stage: "wfm", viewOnly: true });
    expect(items[1].meta).toMatchObject({ stage: "payroll_head" });
    expect(items[1].meta?.viewOnly).toBeUndefined();
    const labels = items[1].fields.map((f) => f.label);
    for (const l of ["Dispute type", "Affected dates", "WFM differential amount", "WFM remarks", "Payroll month"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/payroll/salary-disputes?tab=queue&approvalId=d1");
    expect(items[0].rejectNeedsReason).toBe(true);
  });
  it("a 403 on one queue still returns the other", async () => {
    const { ctx } = fakeCtx({ "GET /api/salary-disputes/queue/payroll-head": { data: [d({ id: "d2", status: "pending_payroll_head" })] } });
    expect((await a.list(ctx)).map((i) => i.id)).toEqual(["d2"]);
  });
  it("decide: PH approve/reject, WFM reject, WFM approve refused", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/salary-disputes/d2/payroll-head-review": {}, "POST /api/salary-disputes/d1/wfm-review": {} });
    await a.decide(ctx, { id: "d2", meta: { stage: "payroll_head" } }, "approve", "");
    await a.decide(ctx, { id: "d2", meta: { stage: "payroll_head" } }, "reject", "not valid at all");
    await a.decide(ctx, { id: "d1", meta: { stage: "wfm" } }, "reject", "dates are wrong here");
    expect(calls[0].body).toEqual({ action: "approve", remarks: "Approved via Approval Center" });
    expect(calls[1].body).toEqual({ action: "reject", remarks: "not valid at all" });
    expect(calls[2]).toMatchObject({ path: "/api/salary-disputes/d1/wfm-review", body: { action: "reject", remarks: "dates are wrong here" } });
    await expect(a.decide(ctx, { id: "d1", meta: { stage: "wfm" } }, "approve", "long enough remark")).rejects.toThrow(/differential/);
    expect(calls).toHaveLength(3);
  });
});
