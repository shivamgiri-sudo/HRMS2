import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeCtx } from "./_ctx.js";

const hasAnyRole = vi.fn();
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a) }));
import { nocAdapter as a } from "../adapters/noc.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const n = (o: any = {}) => ({ id: "n1", employee_name: "Kiran", employee_code: "E2", noc_type: "fnf", run_month: "2026-09", upload_status: "uploaded", uploaded_by_name: "Branch Payroll", uploaded_at: "2026-10-01T00:00:00Z", ...o });
beforeEach(() => hasAnyRole.mockReset());

describe("NOC adapter", () => {
  it("payroll head lists uploaded NOCs", async () => {
    hasAnyRole.mockResolvedValue(true);
    const { ctx, calls } = fakeCtx({ "GET /api/payroll/noc/": { data: [n(), n({ id: "n2", upload_status: "validated" })] } });
    const items = await a.list(ctx);
    expect(calls[0].query).toEqual({ uploadStatus: "uploaded" });
    expect(items.map((i) => i.id)).toEqual(["n1"]);
    const labels = items[0].fields.map((f) => f.label);
    for (const l of ["NOC type", "Payroll month", "Uploaded by", "Uploaded on", "Employee code"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/payroll/noc?approvalId=n1");
    expect(items[0].rejectNeedsReason).toBe(true);
  });
  it("others get nothing", async () => {
    hasAnyRole.mockResolvedValue(false);
    const { ctx, calls } = fakeCtx({});
    expect(await a.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide validate / reject", async () => {
    const { ctx, calls } = fakeCtx({ "PATCH /api/payroll/noc/n1/validate": {}, "PATCH /api/payroll/noc/n1/reject": {} });
    await a.decide(ctx, { id: "n1" }, "approve", "");
    await a.decide(ctx, { id: "n1" }, "reject", "blurry scan");
    expect(calls.map((c) => c.path.split("/").pop())).toEqual(["validate", "reject"]);
    expect(calls[1].body).toEqual({ reason: "blurry scan" });
  });
});
