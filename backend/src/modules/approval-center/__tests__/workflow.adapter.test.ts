import { describe, it, expect } from "vitest";
import { workflowAdapter } from "../adapters/workflow.js";
import { fakeCtx } from "./_fakeCtx.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE, person } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const row = (o: any = {}) => ({
  id: "r1", workflow_id: "w1", module_key: "it", entity_type: "asset", entity_id: "a1", current_step: 2, status: "pending",
  requested_by: "u-other", summary: "Laptop issue", summary_text: "Laptop issue", created_at: new Date(Date.now() - 100 * 3_600_000).toISOString(),
  workflow_name: "Asset Approval", workflow_code: "ASSET_APPROVAL", step_name: "Manager", approver_role: "manager", sla_hours: 24,
  requested_by_name: "Asha", ...o,
});

/** The caller is requester u-other's reporting manager (effective approver), same branch. */
const asApprover = () => useScope(person({ roles: ["manager"] }), { users: { "u-other": { employeeId: "e-other", branchId: "b-noi" } }, approvers: { "e-other": "emp-me" } });

describe("workflowAdapter", () => {
  it("manager-type step: only the effective approver; super_admin / another manager / hr are not shown it", async () => {
    const routes = { "GET /api/workflow/requests/pending": { data: [row()] } };
    const world = { users: { "u-other": { employeeId: "e-other", branchId: "b-noi" } }, approvers: { "e-other": "emp-approver" } };
    useScope(person({ employeeId: "emp-approver", roles: ["manager"] }), world);
    expect((await workflowAdapter.list(fakeCtx(routes).ctx)).map((i) => i.id)).toEqual(["r1"]);
    for (const roles of [["super_admin"], ["manager"], ["hr"], ["admin"]]) {
      useScope(person({ roles, orgWide: roles[0] === "super_admin" }), world);
      expect(await workflowAdapter.list(fakeCtx(routes).ctx), roles.join()).toEqual([]);
    }
  });
  it("role-owned step: caller must literally hold the step role; super_admin without it is not shown", async () => {
    const routes = { "GET /api/workflow/requests/pending": { data: [row({ approver_role: "hr" })] } };
    const world = { users: { "u-other": { employeeId: "e-other", branchId: "b-noi" } } };
    useScope(person({ roles: ["hr"] }), world);
    expect((await workflowAdapter.list(fakeCtx(routes).ctx)).map((i) => i.id)).toEqual(["r1"]);
    useScope(person({ roles: ["super_admin"], orgWide: true }), world);
    expect(await workflowAdapter.list(fakeCtx(routes).ctx)).toEqual([]);
  });
  it("maps fields, flags overdue, deep-links", async () => {
    asApprover();
    const { ctx } = fakeCtx({ "GET /api/workflow/requests/pending": { data: [row()] } });
    const [it] = await workflowAdapter.list(ctx);
    expect(it.uid).toBe("workflow:r1");
    expect(it.title).toBe("Laptop issue");
    expect(it.priority).toBe("high");
    expect(it.viewPath).toBe("/workflow-admin?approvalId=r1");
    expect(it.rejectNeedsReason).toBe(false);
    const labels = it.fields.map((x) => x.label);
    expect(labels).toEqual(expect.arrayContaining(["Workflow", "Requested by", "Summary", "Current step", "Approver role", "Submitted"]));
  });
  it("drops own requests, job requisitions and non-pending", async () => {
    asApprover();
    const { ctx } = fakeCtx({
      "GET /api/workflow/requests/pending": { data: [
        row({ id: "own", requested_by: "me-user" }),
        row({ id: "jr", workflow_code: "JOB_REQUISITION_APPROVAL" }),
        row({ id: "jr2", entity_type: "job_requisition" }),
        row({ id: "done", status: "approved" }),
        row({ id: "ok" }),
      ] },
    });
    expect((await workflowAdapter.list(ctx)).map((i) => i.id)).toEqual(["ok"]);
  });
  it("decide hits act endpoint for approve and reject", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/workflow/requests/r1/act": {} });
    await workflowAdapter.decide(ctx, { id: "r1" }, "approve", "");
    await workflowAdapter.decide(ctx, { id: "r1" }, "reject", "no");
    expect(calls[0].body).toEqual({ action: "approved", remarks: undefined });
    expect(calls[1].body).toEqual({ action: "rejected", remarks: "no" });
  });
});
