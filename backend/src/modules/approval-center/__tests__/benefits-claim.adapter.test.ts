import { describe, it, expect, vi } from "vitest";

vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn(async () => ({ id: "emp-me", employee_code: "E0" })) }));

import { benefitsClaimAdapter } from "../adapters/benefits-claim.js";
import { fakeCtx } from "./_fakeCtx.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope({ ...ORG_WIDE, employeeId: "emp-me" }));

const claim = (o: any = {}) => ({ id: "c1", employee_id: "emp-x", employee_name: "Nina", employee_code: "E7", claim_type: "medical", amount: "2500.50", claim_date: "2026-09-30", description: "Dental", receipt_ref: "R-9", status: "submitted", created_at: "2026-10-01T00:00:00Z", ...o });

describe("benefitsClaimAdapter", () => {
  it("maps fields for reviewers", async () => {
    const { ctx, calls } = fakeCtx({ "GET /api/benefits/claims": { success: true, data: [claim()], stats: { total_submitted: 1 } } });
    const [it] = await benefitsClaimAdapter.list(ctx);
    expect(calls[0].query).toEqual({ status: "submitted" });
    expect(it.fields.map((x) => x.label)).toEqual(expect.arrayContaining(["Employee", "Claim type", "Amount", "Claim date", "Description", "Receipt reference"]));
    expect(it.viewPath).toBe("/benefits?approvalId=c1");
  });
  it("ignores non-reviewer response (no stats) and own claims", async () => {
    expect(await benefitsClaimAdapter.list(fakeCtx({ "GET /api/benefits/claims": { success: true, data: [claim()] } }).ctx)).toEqual([]);
    const { ctx } = fakeCtx({ "GET /api/benefits/claims": { data: [claim({ employee_id: "emp-me" }), claim({ id: "c2", status: "paid" })], stats: {} } });
    expect(await benefitsClaimAdapter.list(ctx)).toEqual([]);
  });
  it("decide PATCH review", async () => {
    const { ctx, calls } = fakeCtx({ "PATCH /api/benefits/claims/c1/review": {} });
    await benefitsClaimAdapter.decide(ctx, { id: "c1" }, "approve", "");
    await benefitsClaimAdapter.decide(ctx, { id: "c1" }, "reject", "no receipt");
    expect(calls[0].body).toEqual({ action: "approved", remarks: undefined });
    expect(calls[1].body).toEqual({ action: "rejected", remarks: "no receipt" });
    expect(benefitsClaimAdapter.list).toBeTypeOf("function");
  });
});
