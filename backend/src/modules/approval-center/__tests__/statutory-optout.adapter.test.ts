import { describe, it, expect, vi, beforeEach } from "vitest";
// Branch / approver policy is covered in scope.adapters.test.ts (fake DB); this file tests mapping + decide only.
vi.mock("../adapters/_scope.js", async () => (await import("./_scopePassthrough.js")).passthrough);
import { makeCtx } from "./fakeCtx.js";

const hasRole = vi.hoisted(() => vi.fn());
vi.mock("../adapters/_roles.js", () => ({ callerHasRole: hasRole, callerRoleKeys: vi.fn() }));

import { statutoryOptOutAdapter } from "../adapters/statutory-optout.js";

const row = (over: Record<string, unknown> = {}) => ({
  id: "o1", employee_id: "e1", override_type: "pf_opt_out", status: "pending", declaration_text: "I earn above the PF ceiling and opt out.",
  requested_at: "2026-10-05T00:00:00Z", employee_name: "Asha Rao", employee_code: "MAS100", branch_name: "Pune", ...over,
});

describe("statutoryOptOutAdapter", () => {
  beforeEach(() => hasRole.mockResolvedValue(true));

  it("maps all components", async () => {
    const { ctx } = makeCtx({ "GET /api/payroll/statutory-overrides/pending": { data: [row(), row({ id: "o2", override_type: "esic_opt_out" })] } });
    const items = await statutoryOptOutAdapter.list(ctx);
    expect(items.map((i) => i.title)).toEqual(["Asha Rao — PF opt-out", "Asha Rao — ESI opt-out"]);
    const labels = items[0].fields.map((f) => f.label);
    for (const l of ["Employee", "Employee code", "Branch", "Request", "Employee declaration", "Requested on", "Effective from"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/payroll/ho-queues?tab=optout&approvalId=o1");
    expect(items[0].rejectNeedsReason).toBe(false);
  });

  it("is hidden from finance-only callers (list admits finance, approve does not)", async () => {
    hasRole.mockResolvedValue(false);
    const { ctx, calls } = makeCtx();
    expect(await statutoryOptOutAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(hasRole).toHaveBeenCalledWith("u-1", "payroll", "super_admin");
  });

  it("drops non-pending rows", async () => {
    const { ctx } = makeCtx({ "GET /api/payroll/statutory-overrides/pending": { data: [row({ status: "revoked" })] } });
    expect(await statutoryOptOutAdapter.list(ctx)).toEqual([]);
  });

  it("decide sends decision + note and no effective month (page default)", async () => {
    const { ctx, calls } = makeCtx({ "PATCH /api/payroll/statutory-overrides/o1/approve": { success: true } });
    await statutoryOptOutAdapter.decide(ctx, { id: "o1" }, "approve", "ok");
    await statutoryOptOutAdapter.decide(ctx, { id: "o1" }, "reject", "");
    expect(calls[0].body).toEqual({ decision: "approved", note: "ok" });
    expect(calls[1].body).toEqual({ decision: "rejected", note: undefined });
    expect(calls[0].body).not.toHaveProperty("effective_from_month");
  });
});
