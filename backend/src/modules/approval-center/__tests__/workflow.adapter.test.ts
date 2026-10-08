import { describe, it, expect } from "vitest";
import { workflowAdapter } from "../adapters/workflow.js";
import { fakeCtx } from "./_fakeCtx.js";

const row = (o: any = {}) => ({
  id: "r1", workflow_id: "w1", module_key: "it", entity_type: "asset", entity_id: "a1", current_step: 2, status: "pending",
  requested_by: "u-other", summary: "Laptop issue", summary_text: "Laptop issue", created_at: new Date(Date.now() - 100 * 3_600_000).toISOString(),
  workflow_name: "Asset Approval", workflow_code: "ASSET_APPROVAL", step_name: "Manager", approver_role: "manager", sla_hours: 24,
  requested_by_name: "Asha", ...o,
});

describe("workflowAdapter", () => {
  it("maps fields, flags overdue, deep-links", async () => {
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
