import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeCtx } from "./_ctx.js";

const hasAnyRole = vi.fn();
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a) }));
import { loansAdapter as a } from "../adapters/loans.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const loan = (o: any = {}) => ({ id: "l1", employee_name: "Tia", employee_code: "E5", loan_type: "Salary Advance", amount: 20000, installments: 4, deduction_per_month: 5000, start_date: "2026-11-01", end_date: "2027-02-01", reason: "Family", status: "pending_approval", created_by: "someone", branch_name: "Goa", created_at: "2026-10-01T00:00:00Z", ...o });
beforeEach(() => hasAnyRole.mockReset());

describe("loans adapter", () => {
  it("lists pending, drops caller-created loans, maps fields", async () => {
    hasAnyRole.mockResolvedValue(true);
    const { ctx, calls } = fakeCtx({ "GET /api/payroll/loans/": { data: [loan(), loan({ id: "l2", created_by: "u-caller" }), loan({ id: "l3", status: "active" })] } });
    const items = await a.list(ctx);
    expect(calls[0].query).toMatchObject({ status: "pending_approval", limit: 200 });
    expect(items.map((i) => i.id)).toEqual(["l1"]);
    const labels = items[0].fields.map((f) => f.label);
    for (const l of ["Loan type", "Amount", "Installments", "Deduction per month", "Start date", "End date", "Reason", "Branch"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/payroll/loans?approvalId=l1");
  });
  it("non-head role gets nothing", async () => {
    hasAnyRole.mockResolvedValue(false);
    const { ctx, calls } = fakeCtx({});
    expect(await a.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/payroll/loans/l1/approve": {}, "POST /api/payroll/loans/l1/reject": {} });
    await a.decide(ctx, { id: "l1" }, "approve", "");
    await a.decide(ctx, { id: "l1" }, "reject", "policy");
    expect(calls.map((c) => c.path)).toEqual(["/api/payroll/loans/l1/approve", "/api/payroll/loans/l1/reject"]);
    expect(calls[1].body).toEqual({ reason: "policy" });
  });
});
