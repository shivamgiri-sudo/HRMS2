import { describe, it, expect } from "vitest";
import { fakeCtx } from "./_ctx.js";
import { reimbursementsAdapter as a } from "../adapters/reimbursements.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope({ ...ORG_WIDE, roles: ["branch_head"] }));

const c = (o: any = {}) => ({ id: "c1", employee_name: "Ola", employee_code: "E8", claim_type: "FUEL", claim_month: "2026-09", amount_claimed: 3200, amount_approved: null, description: "Site visits", status: "submitted", submitted_at: "2026-10-01T00:00:00Z", attachment_original_name: "bill.pdf", ...o });

describe("reimbursements adapter", () => {
  it("merges manager + branch-head queues by status and tolerates a 403", async () => {
    const { ctx } = fakeCtx({
      "GET /api/payroll/reimbursements/manager-queue": { data: [c(), c({ id: "x", status: "rejected" })] },
      "GET /api/payroll/reimbursements/branch-head-queue": { data: [c({ id: "c2", status: "manager_approved", amount_approved: 3000, manager_reviewed_at: "2026-10-02", manager_review_note: "ok" })] },
    });
    const items = await a.list(ctx);
    expect(items.map((i) => [i.id, i.meta?.stage])).toEqual([["c1", "manager"], ["c2", "branch_head"]]);
    const labels = items[1].fields.map((f) => f.label);
    for (const l of ["Claim type", "Claim month", "Amount claimed", "Amount approved so far", "Description", "Attachment", "Manager note"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/payroll/reimbursements?approvalId=c1");
    expect(items[0].rejectNeedsReason).toBe(true);
    const { ctx: c2 } = fakeCtx({ "GET /api/payroll/reimbursements/manager-queue": { data: [c()] } });
    expect((await a.list(c2)).map((i) => i.id)).toEqual(["c1"]);
  });
  it("branch-head stage needs the literal branch_head role: super_admin alone is not shown it", async () => {
    useScope({ ...ORG_WIDE, roles: ["super_admin"] });
    const routes = { "GET /api/payroll/reimbursements/branch-head-queue": { data: [c({ id: "c2", status: "manager_approved", branch_id: "b1" })] } };
    expect(await a.list(fakeCtx(routes).ctx)).toEqual([]);
    useScope({ ...ORG_WIDE, roles: ["super_admin", "branch_head"] });
    expect((await a.list(fakeCtx(routes).ctx)).map((i) => i.id)).toEqual(["c2"]);
  });
  it("decide per stage", async () => {
    const { ctx, calls } = fakeCtx({
      "PATCH /api/payroll/reimbursements/c1/manager-approve": {}, "PATCH /api/payroll/reimbursements/c1/manager-reject": {},
      "PATCH /api/payroll/reimbursements/c2/branch-head-approve": {}, "PATCH /api/payroll/reimbursements/c2/branch-head-reject": {},
    });
    await a.decide(ctx, { id: "c1", meta: { stage: "manager" } }, "approve", "fine");
    await a.decide(ctx, { id: "c1", meta: { stage: "manager" } }, "reject", "no bill");
    await a.decide(ctx, { id: "c2", meta: { stage: "branch_head" } }, "approve", "");
    await a.decide(ctx, { id: "c2", meta: { stage: "branch_head" } }, "reject", "over limit");
    expect(calls.map((x) => x.path.split("/").slice(-1)[0])).toEqual(["manager-approve", "manager-reject", "branch-head-approve", "branch-head-reject"]);
    expect(calls[0].body).toEqual({ note: "fine" });
    expect(calls[1].body).toEqual({ reason: "no bill" });
  });
});
