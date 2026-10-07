import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCtx } from "./fakeCtx.js";
import { LoopbackError } from "../types.js";

const hasRole = vi.hoisted(() => vi.fn());
vi.mock("../adapters/_roles.js", () => ({ callerHasRole: hasRole, callerRoleKeys: vi.fn() }));

import { exitFfAdapter } from "../adapters/exit-ff.js";

const req = (over: Record<string, unknown> = {}) => ({
  id: "x1", employee_name: "Asha Rao", employee_code: "MAS100", branch_name: "Pune", process_name: "Sales", exit_type: "voluntary",
  exit_sub_type: "resignation", last_working_day_confirmed: "2026-11-15", ff_status: "draft", is_ff_provisional: 0,
  clearance_total: 6, clearance_cleared: 6, ...over,
});
const ff = (over: Record<string, unknown> = {}) => ({
  id: "ff1", exit_request_id: "x1", status: "draft", is_ff_provisional: 0, calculation_date: "2026-11-15", notice_period_days: 30,
  notice_shortfall_days: 5, notice_recovery: 5000, earned_leave_encashment: 12000, gratuity_amount: 0, salary_hold: 8000,
  advances_recovery: 1000, net_payable: 14000, employee_name: "Asha Rao", created_at: "2026-11-16T00:00:00Z", payroll_already_paid: [], ...over,
});

describe("exitFfAdapter", () => {
  beforeEach(() => hasRole.mockResolvedValue(true));

  it("maps the full settlement and deep-links by exit request id", async () => {
    const { ctx, calls } = makeCtx({
      "GET /api/exit/command-center": { data: { requests: [req()] } },
      "GET /api/exit/ff/x1": { data: ff() },
    });
    const [it] = await exitFfAdapter.list(ctx);
    expect(it.uid).toBe("exit_ff:ff1");
    expect(it.id).toBe("ff1");
    expect(it.stage).toBe("Final approval");
    const labels = it.fields.map((f) => f.label);
    for (const l of ["Notice recovery", "Earned leave encashment", "Gratuity", "Salary hold", "Advances recovery", "Net payable", "Clearance tasks", "Last working day"]) expect(labels).toContain(l);
    expect(it.fields.find((f) => f.label === "Net payable")?.value).toBe("₹14,000");
    expect(it.viewPath).toBe("/payroll/full-final?approvalId=x1");
    expect(it.meta).toMatchObject({ exitRequestId: "x1", provisional: false, viewOnly: false, noReject: true });
    expect(calls.filter((c) => c.path.startsWith("/api/exit/ff/"))).toHaveLength(1);
  });

  it("skips settlements with open clearance, wrong status, or already approved", async () => {
    const { ctx, calls } = makeCtx({
      "GET /api/exit/command-center": { data: { requests: [req({ id: "a", clearance_cleared: 3 }), req({ id: "b", ff_status: "approved" }), req({ id: "c", ff_status: null })] } },
    });
    expect(await exitFfAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("lists provisional settlements as view-only verify items", async () => {
    const { ctx } = makeCtx({
      "GET /api/exit/command-center": { data: { requests: [req({ is_ff_provisional: 1 })] } },
      "GET /api/exit/ff/x1": { data: ff({ is_ff_provisional: 1 }) },
    });
    const [it] = await exitFfAdapter.list(ctx);
    expect(it.stage).toMatch(/Verify/);
    expect(it.meta).toMatchObject({ provisional: true, viewOnly: true });
  });

  it("tolerates a 403/404 on one settlement", async () => {
    const { ctx } = makeCtx({
      "GET /api/exit/command-center": { data: { requests: [req({ id: "x1" }), req({ id: "x2" })] } },
      "GET /api/exit/ff/x1": new LoopbackError(403, "out of scope"),
      "GET /api/exit/ff/x2": { data: ff({ id: "ff2", exit_request_id: "x2" }) },
    });
    expect((await exitFfAdapter.list(ctx)).map((i) => i.id)).toEqual(["ff2"]);
  });

  it("shows nothing to a caller with no F&F role", async () => {
    hasRole.mockResolvedValue(false);
    const { ctx, calls } = makeCtx();
    expect(await exitFfAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("approve POSTs the ff id; reject and provisional approve are refused", async () => {
    const { ctx, calls } = makeCtx({ "POST /api/exit/ff/ff1/approve": { success: true } });
    await exitFfAdapter.decide(ctx, { id: "ff1", meta: { provisional: false } }, "approve", "");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/exit/ff/ff1/approve" });
    await expect(exitFfAdapter.decide(ctx, { id: "ff1" }, "reject", "no")).rejects.toThrow(/cannot be declined/);
    await expect(exitFfAdapter.decide(ctx, { id: "ff1", meta: { provisional: true } }, "approve", "")).rejects.toThrow(/provisional/);
    expect(calls).toHaveLength(1);
  });
});
