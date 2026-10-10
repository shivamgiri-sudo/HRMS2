import { describe, it, expect, vi } from "vitest";

const scope = { employeeId: "emp-me", branchId: "b1", roles: ["employee"] as string[] };
vi.mock("../../visitor/visitor.service.js", () => ({ visitorService: { getScope: vi.fn(async () => scope) } }));

import { visitorAdapter, canDecideVisit } from "../adapters/visitor.js";
import { fakeCtx } from "./_fakeCtx.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const visit = (o: any = {}) => ({
  id: "v1", visit_number: "VIS-1", visit_type: "business_meeting", purpose: "Demo", status: "pending_approval", scheduled_start: "2026-10-08T09:00:00Z",
  scheduled_end: "2026-10-08T10:00:00Z", branch_id: "b1", branch_name: "Pune", host_employee_id: "emp-me", host_display_name: "Me",
  visitor_name: "Vik", company_name: "Acme", masked_mobile: "******1234", ...o,
});

describe("visitorAdapter", () => {
  it("lists only visits the caller can decide", async () => {
    scope.roles = ["employee"];
    const { ctx, calls } = fakeCtx({ "GET /api/visitor/visits": { success: true, data: [visit(), visit({ id: "v2", host_employee_id: "other" }), visit({ id: "v3", status: "checked_in" })] } });
    const r = await visitorAdapter.list(ctx);
    expect(calls[0].query).toMatchObject({ status: "pending_approval", limit: 200 });
    expect(r.map((i) => i.id)).toEqual(["v1"]);
    expect(r[0].fields.map((x) => x.label)).toEqual(expect.arrayContaining(["Visitor", "Company", "Host", "Purpose", "Scheduled start", "Visit number"]));
    expect(r[0].rejectNeedsReason).toBe(true);
    expect(r[0].viewPath).toBe("/visitor-management/approvals?approvalId=v1");
  });
  it("branch approvers see same-branch visits only", async () => {
    scope.roles = ["branch_head"];
    const { ctx } = fakeCtx({ "GET /api/visitor/visits": { data: [visit({ id: "a", host_employee_id: "x" }), visit({ id: "b", host_employee_id: "x", branch_id: "b9" })] } });
    expect((await visitorAdapter.list(ctx)).map((i) => i.id)).toEqual(["a"]);
  });
  it("canDecideVisit mirrors decide rules", () => {
    // designated = host, a branch role of the visit's own branch, or admin of the own branch when the visit has no host.
    // super_admin / admin are merely ABLE to decide and are not shown a hosted visit.
    expect(canDecideVisit({ employeeId: null, branchId: null, roles: ["super_admin"] }, { branch_id: "z" })).toBe(false);
    expect(canDecideVisit({ employeeId: null, branchId: "z", roles: ["super_admin"] }, { branch_id: "z", host_employee_id: "h" })).toBe(false);
    expect(canDecideVisit({ employeeId: "h", branchId: null, roles: ["super_admin"] }, { branch_id: "z", host_employee_id: "h" })).toBe(true);
    expect(canDecideVisit({ employeeId: null, branchId: "z", roles: ["admin"] }, { branch_id: "z", host_employee_id: "h" })).toBe(false);
    expect(canDecideVisit({ employeeId: null, branchId: "z", roles: ["admin"] }, { branch_id: "z" })).toBe(true);
    expect(canDecideVisit({ employeeId: null, branchId: "z", roles: ["branch_head"] }, { branch_id: "z", host_employee_id: "h" })).toBe(true);
    expect(canDecideVisit({ employeeId: null, branchId: "y", roles: ["admin"] }, { branch_id: "z" })).toBe(false);
    expect(canDecideVisit({ employeeId: null, branchId: null, roles: ["admin"] }, { branch_id: "z" })).toBe(false);
    expect(canDecideVisit({ employeeId: null, branchId: "b", roles: ["visitor_security"] }, { branch_id: "b" })).toBe(false);
  });
  it("decide: approve drops short reason, reject sends reason", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/visitor/visits/v1/approve": {}, "POST /api/visitor/visits/v1/reject": {} });
    await visitorAdapter.decide(ctx, { id: "v1" }, "approve", "ok");
    await visitorAdapter.decide(ctx, { id: "v1" }, "approve", "fine by me");
    await visitorAdapter.decide(ctx, { id: "v1" }, "reject", "not expected");
    expect(calls[0].body).toEqual({});
    expect(calls[1].body).toEqual({ reason: "fine by me" });
    expect(calls[2].path).toBe("/api/visitor/visits/v1/reject");
    expect(calls[2].body).toEqual({ reason: "not expected" });
  });
});
