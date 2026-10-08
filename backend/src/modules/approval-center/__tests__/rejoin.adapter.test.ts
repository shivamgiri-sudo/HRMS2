import { describe, it, expect, vi, beforeEach } from "vitest";
// Branch / approver policy is covered in scope.adapters.test.ts (fake DB); this file tests mapping + decide only.
vi.mock("../adapters/_scope.js", async () => (await import("./_scopePassthrough.js")).passthrough);
import { makeCtx } from "./fakeCtx.js";

const hasRole = vi.hoisted(() => vi.fn());
vi.mock("../adapters/_roles.js", () => ({ callerHasRole: hasRole, callerRoleKeys: vi.fn() }));

import { rejoinAdapter } from "../adapters/rejoin.js";

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1", employee_id: "e1", employee_name: "Asha Rao", employee_code: "MAS100", old_employment_status: "Resigned",
  proposed_joining_date: "2026-11-01", reinstatement_reason: "Returned from higher studies", gap_days: 60, same_cost_centre: 1, ff_already_paid: 0,
  status: "pending", raised_by_role: "hr", eligibility_status: "review", created_at: "2026-10-01T00:00:00Z",
  eligibility_snapshot: { status: "review", reasons: [{ severity: "review", code: "OPEN_CLEARANCE", message: "Exit clearance is still open." }] }, ...over,
});

describe("rejoinAdapter", () => {
  beforeEach(() => hasRole.mockResolvedValue(true));

  it("maps all components incl. eligibility notes", async () => {
    const { ctx } = makeCtx({ "GET /api/employees/reactivation/pending": { data: [row()] } });
    const [it] = await rejoinAdapter.list(ctx);
    expect(it.uid).toBe("rejoin:r1");
    const labels = it.fields.map((f) => f.label);
    for (const l of ["Employee", "Previous status", "Proposed joining date", "Gap since exit (days)", "Reinstatement reason", "Same cost centre", "F&F already paid", "Eligibility", "Eligibility notes"]) expect(labels).toContain(l);
    expect(it.viewPath).toBe("/employees/reactivation/r1/review");
    expect(it.rejectNeedsReason).toBe(true);
    expect(it.meta).toMatchObject({ absconding: false, viewOnly: false });
  });

  it("flags absconders view-only (string snapshot too) and high priority", async () => {
    const snap = JSON.stringify({ status: "review", reasons: [{ severity: "review", code: "ABSCONDING", message: "Left by absconding" }] });
    const { ctx } = makeCtx({ "GET /api/employees/reactivation/pending": { data: [row({ eligibility_snapshot: snap })] } });
    const [it] = await rejoinAdapter.list(ctx);
    expect(it.meta).toMatchObject({ absconding: true, viewOnly: true });
    expect(it.priority).toBe("high");
  });

  it("ignores rows not awaiting the branch head and non-branch-heads", async () => {
    const { ctx } = makeCtx({ "GET /api/employees/reactivation/pending": { data: [row({ status: "approved" })] } });
    expect(await rejoinAdapter.list(ctx)).toEqual([]);
    hasRole.mockResolvedValue(false);
    const none = makeCtx();
    expect(await rejoinAdapter.list(none.ctx)).toEqual([]);
    expect(none.calls).toHaveLength(0);
  });

  it("approve sends action + remarks (default text when blank); reject requires 5+ chars", async () => {
    const { ctx, calls } = makeCtx({ "POST /api/employees/reactivation/r1/branch-action": { success: true } });
    await rejoinAdapter.decide(ctx, { id: "r1", meta: { absconding: false } }, "approve", "");
    await rejoinAdapter.decide(ctx, { id: "r1", meta: {} }, "approve", "Welcome back, verified");
    await rejoinAdapter.decide(ctx, { id: "r1" }, "reject", "Not a fit now");
    expect(calls[0].body).toEqual({ action: "approved", remarks: "Approved via Approval Center" });
    expect(calls[1].body).toEqual({ action: "approved", remarks: "Welcome back, verified" });
    expect(calls[2].body).toEqual({ action: "rejected", remarks: "Not a fit now" });
    await expect(rejoinAdapter.decide(ctx, { id: "r1" }, "reject", "no")).rejects.toThrow(/at least 5/);
  });

  it("never approves an absconder blind", async () => {
    const { ctx, calls } = makeCtx();
    await expect(rejoinAdapter.decide(ctx, { id: "r1", meta: { absconding: true } }, "approve", "long enough remarks here ok")).rejects.toThrow(/absconded/);
    expect(calls).toHaveLength(0);
  });
});
