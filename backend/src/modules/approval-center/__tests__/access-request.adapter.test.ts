import { describe, it, expect } from "vitest";
import { accessRequestAdapter } from "../adapters/access-request.js";
import { fakeCtx } from "./_fakeCtx.js";
import { LoopbackError } from "../types.js";

const rq = (o: any = {}) => ({ id: "q1", user_id: "u9", user_email: "a@b.com", page_code: "PAYROLL", page_name: "Payroll", reason: "need it", status: "pending", created_at: "2026-10-01T00:00:00Z", ...o });

describe("accessRequestAdapter", () => {
  it("maps fields and drops own / non-pending", async () => {
    const { ctx, calls } = fakeCtx({ "GET /api/access/requests": { success: true, data: [rq(), rq({ id: "own", user_id: "me-user" }), rq({ id: "d", status: "denied" })] } });
    const r = await accessRequestAdapter.list(ctx);
    expect(calls[0].query).toEqual({ status: "pending" });
    expect(r.map((i) => i.id)).toEqual(["q1"]);
    expect(r[0].fields.map((x) => x.label)).toEqual(expect.arrayContaining(["User", "Page", "Page code", "Reason", "Requested"]));
    expect(r[0].viewPath).toBe("/settings/access-control?approvalId=q1");
    expect(r[0].rejectNeedsReason).toBe(false);
  });
  it("propagates 403 for the service to swallow", async () => {
    const { ctx } = fakeCtx({ "GET /api/access/requests": new LoopbackError(403, "no") });
    await expect(accessRequestAdapter.list(ctx)).rejects.toBeInstanceOf(LoopbackError);
  });
  it("decide approve / deny", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/access/requests/q1/approve": {}, "POST /api/access/requests/q1/deny": {} });
    await accessRequestAdapter.decide(ctx, { id: "q1" }, "approve", "");
    await accessRequestAdapter.decide(ctx, { id: "q1" }, "reject", "nope");
    expect(calls[0].path).toMatch(/approve$/);
    expect(calls[1].body).toEqual({ review_note: "nope" });
  });
});
