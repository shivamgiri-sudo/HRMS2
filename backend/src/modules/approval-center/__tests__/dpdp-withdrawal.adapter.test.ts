import { describe, it, expect } from "vitest";
import { dpdpWithdrawalAdapter } from "../adapters/dpdp-withdrawal.js";
import { fakeCtx } from "./_fakeCtx.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const w = (o: any = {}) => ({ id: "d1", requester_id: "u-x", requester_name: "Tara", requester_type: "employee", status: "submitted", withdrawal_reason: "Privacy", withdrawal_scope_json: '["marketing","analytics"]', request_channel: "portal", reference_number: "DPDP-1", sla_due_at: "2020-01-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", processing_hold_active: 0, escalation_required: 0, ...o });

describe("dpdpWithdrawalAdapter", () => {
  it("merges submitted + in_review, maps fields, SLA breach is high", async () => {
    const { ctx, calls } = fakeCtx({
      "GET /api/privacy/dpdp-withdrawal": (c: any) => ({ data: c.query.status === "submitted" ? [w()] : [w({ id: "d2", status: "in_review", processing_hold_active: 1 })] }),
    });
    const r = await dpdpWithdrawalAdapter.list(ctx);
    expect(calls.map((c) => c.query?.status)).toEqual(["submitted", "in_review"]);
    expect(r.map((i) => i.id)).toEqual(["d1", "d2"]);
    expect(r[0].priority).toBe("high");
    const by = Object.fromEntries(r[0].fields.map((x) => [x.label, x.value]));
    expect(by["Consents withdrawn"]).toBe("marketing, analytics");
    expect(by["Reason"]).toBe("Privacy");
    expect(r[1].fields.find((x) => x.label === "Processing hold")?.value).toBe("Active");
    expect(r[0].rejectNeedsReason).toBe(true);
    expect(r[0].viewPath).toBe("/compliance/dpdp-withdrawal-admin?approvalId=d1");
  });
  it("drops own and closed", async () => {
    const { ctx } = fakeCtx({ "GET /api/privacy/dpdp-withdrawal": { data: [w({ requester_id: "me-user" }), w({ id: "z", status: "approved" })] } });
    expect(await dpdpWithdrawalAdapter.list(ctx)).toEqual([]);
  });
  it("decide approve remarks / reject reason", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/privacy/dpdp-withdrawal/d1/approve": {}, "POST /api/privacy/dpdp-withdrawal/d1/reject": {} });
    await dpdpWithdrawalAdapter.decide(ctx, { id: "d1" }, "approve", "ok");
    await dpdpWithdrawalAdapter.decide(ctx, { id: "d1" }, "reject", "invalid");
    expect(calls[0].body).toEqual({ remarks: "ok" });
    expect(calls[1].body).toEqual({ reason: "invalid" });
  });
});
