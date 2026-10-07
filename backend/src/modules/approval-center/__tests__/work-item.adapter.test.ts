import { describe, it, expect } from "vitest";
import { workItemAdapter, WORK_ITEM_VIEW_ONLY_TYPES, WORK_ITEM_EXCLUDED_TYPES } from "../adapters/work-item.js";
import { fakeCtx } from "./_fakeCtx.js";

const wi = (o: any = {}) => ({ id: "w1", item_type: "NOTICE_PERIOD_OVERRIDE_OPS", title: "Notice overridden", description: "Waived 30 days", module_code: "EXIT", entity_type: "exit", entity_id: "e1", priority: "high", status: "pending", due_at: null, created_at: "2026-10-01T00:00:00Z", source_table: "work_item", ...o });

describe("workItemAdapter", () => {
  it("surfaces only whitelisted work_item types as view-only", async () => {
    const { ctx } = fakeCtx({ "GET /api/work-inbox/my": { success: true, data: [
      wi(), wi({ id: "x", item_type: "LEAVE_APPROVAL_PENDING" }), wi({ id: "y", item_type: "AWOL_SUSPECTED" }),
      wi({ id: "z", source_table: "work_inbox_item" }), wi({ id: "j", item_type: "JOINING_DOCS_INCOMPLETE", entity_id: "emp1" }),
    ] } });
    const r = await workItemAdapter.list(ctx);
    expect(r.map((i) => i.id)).toEqual(["w1", "j"]);
    expect(r[0].meta?.viewOnly).toBe(true);
    expect(r[0].rejectNeedsReason).toBe(false);
    expect(r[0].viewPath).toBe("/exit-management?id=e1&approvalId=w1");
    expect(r[1].viewPath).toBe("/employees/emp1/joining-documents?approvalId=j");
    expect(r[0].priority).toBe("high");
    expect(r[0].fields.map((x) => x.label)).toEqual(expect.arrayContaining(["Type", "Details", "Priority", "Raised"]));
  });
  it("decide always throws", async () => {
    await expect(workItemAdapter.decide(fakeCtx({}).ctx, { id: "w1" }, "approve", "")).rejects.toThrow();
  });
  it("exclusion list never overlaps the include list", () => {
    for (const t of WORK_ITEM_EXCLUDED_TYPES) expect(WORK_ITEM_VIEW_ONLY_TYPES.has(t)).toBe(false);
  });
});
