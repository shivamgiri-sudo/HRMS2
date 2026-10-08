import { describe, it, expect, vi } from "vitest";
// Branch / approver policy is covered in scope.adapters.test.ts (fake DB); this file tests mapping + decide only.
vi.mock("../adapters/_scope.js", async () => (await import("./_scopePassthrough.js")).passthrough);

const allowed = new Set(["a1"]);
vi.mock("../../work-inbox/work-inbox.service.js", () => ({
  assertWorkItemAccess: vi.fn(async (_u: string, id: string) => { if (!allowed.has(id)) throw new Error("403"); }),
}));

import { awolAdapter } from "../adapters/awol.js";
import { fakeCtx } from "./_fakeCtx.js";

const item = (o: any = {}) => ({ id: "a1", item_type: "AWOL_SUSPECTED", title: "Possible AWOL: Dev", description: "7 days absent", entity_id: "emp9", priority: "high", status: "pending", created_at: "2026-10-01T00:00:00Z", due_at: null, source_table: "work_item", ...o });

describe("awolAdapter", () => {
  it("lists only items the caller may complete, with context", async () => {
    const { ctx } = fakeCtx({
      "GET /api/work-inbox/my": { data: [item(), item({ id: "a2" }), item({ id: "o", item_type: "LEAVE_APPROVAL_PENDING" })] },
      "GET /api/work-inbox/a1/awol-context": { success: true, data: { employeeId: "emp9", employeeName: "Dev Rao", lastWorkedDate: "2026-09-28" } },
    });
    const r = await awolAdapter.list(ctx);
    expect(r.map((i) => i.id)).toEqual(["a1"]);
    expect(r[0].title).toContain("Dev Rao");
    expect(r[0].fields.find((x) => x.label === "Last worked day")).toBeTruthy();
    expect(r[0].rejectNeedsReason).toBe(true);
    expect(r[0].approveLabel).toBe("Confirm absconding");
    expect(r[0].viewPath).toBe("/work-inbox?approvalId=a1");
  });
  it("reject calls awol/reject with remarks", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/work-inbox/a1/awol/reject": {} });
    await awolAdapter.decide(ctx, { id: "a1" }, "reject", "was on approved visit");
    expect(calls[0].body).toEqual({ remarks: "was on approved visit" });
  });
  it("approve reads last worked date then confirms", async () => {
    const { ctx, calls } = fakeCtx({
      "GET /api/work-inbox/a1/awol-context": { data: { lastWorkedDate: "2026-09-28T00:00:00.000Z" } },
      "POST /api/work-inbox/a1/awol/confirm": { data: { exitRequestId: "x" } },
    });
    await awolAdapter.decide(ctx, { id: "a1" }, "approve", "");
    expect(calls[1].body).toEqual({ lastWorkedDate: "2026-09-28", remarks: undefined });
  });
  it("approve without a last worked date throws", async () => {
    const { ctx } = fakeCtx({ "GET /api/work-inbox/a1/awol-context": { data: { lastWorkedDate: null } } });
    await expect(awolAdapter.decide(ctx, { id: "a1" }, "approve", "")).rejects.toThrow(/Last worked date/);
  });
});
